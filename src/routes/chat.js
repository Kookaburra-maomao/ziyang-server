const express = require('express');
const db = require('../config/db');
const { requireAuth, requireCompletedProfile } = require('../middleware/auth');
const { chatCompletion } = require('../services/doubao');
const { sendHealthAlert } = require('../services/alert-sms');
const { saveMessage, todayMessages, todayModelHistory } = require('../services/messages');
const { maskName, redactSensitiveText } = require('../utils/privacy');

const router = express.Router();
router.use(requireAuth, requireCompletedProfile);

const criticalWords = ['轻生', '自杀', '不想活', '活不下去', '结束生命', '割腕', '跳楼', '吃药寻死'];
const urgentWords = ['不舒服', '头晕', '恶心', '呕吐', '迷糊', '抑郁', '胸痛', '心慌', '呼吸困难', '晕倒', '昏迷', '剧烈疼痛'];
const roleNames = { 1: '社区老人', 2: '老人子女', 3: '社区工作人员' };

async function currentUser(userId) {
  const [rows] = await db.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function elderProfileForUser(userId) {
  const [rows] = await db.execute('SELECT * FROM elder_profiles WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function assistantReply(userId, content, kind = 'chat', extra = {}) {
  const message = await saveMessage(userId, 'assistant', content, kind);
  return { message, ...extra };
}

function dangerSeverity(text) {
  if (criticalWords.some((word) => text.includes(word))) return 'critical';
  if (/(没有|没|并无|无)(任何)?(不舒服|不适|头晕|恶心|症状)/.test(text)) return null;
  if (urgentWords.some((word) => text.includes(word))) return 'urgent';
  return null;
}

function checkinFields(text) {
  const bloodPressure = text.match(/血压\s*[:：是为]?\s*(\d{2,3})\s*[\/／-]\s*(\d{2,3})/);
  const heartRate = text.match(/心率\s*[:：是为]?\s*(\d{2,3})/);
  const glucose = text.match(/血糖\s*[:：是为]?\s*(\d{1,2}(?:\.\d{1,2})?)/);
  const temperature = text.match(/体温\s*[:：是为]?\s*(\d{2}(?:\.\d)?)/);
  const sleep = text.match(/睡眠\s*[:：是为]?\s*(\d{1,2}(?:\.\d)?)\s*小时/);
  const mood = text.match(/心情\s*[:：是为]?\s*([^,，。；;]{1,16})/);
  return {
    systolic: bloodPressure ? Number(bloodPressure[1]) : null,
    diastolic: bloodPressure ? Number(bloodPressure[2]) : null,
    heartRate: heartRate ? Number(heartRate[1]) : null,
    bloodGlucose: glucose ? Number(glucose[1]) : null,
    temperature: temperature ? Number(temperature[1]) : null,
    sleepHours: sleep ? Number(sleep[1]) : null,
    mood: mood?.[1]?.trim() || null,
  };
}

async function saveHealthCheckinAndReward(elder, fields, text) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [checkin] = await connection.execute(
      `INSERT INTO health_checkins
       (elder_profile_id, systolic, diastolic, heart_rate, blood_glucose, temperature, sleep_hours, mood, symptoms, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [elder.id, fields.systolic, fields.diastolic, fields.heartRate, fields.bloodGlucose, fields.temperature, fields.sleepHours, fields.mood, null, redactSensitiveText(text)],
    );
    const [[profile]] = await connection.execute('SELECT egg_balance AS eggBalance FROM elder_profiles WHERE id = ? FOR UPDATE', [elder.id]);
    const [[reward]] = await connection.execute(
      `SELECT id FROM egg_transactions
       WHERE elder_profile_id = ? AND transaction_type = 'checkin_reward' AND reward_date = CURRENT_DATE()
       LIMIT 1 FOR UPDATE`,
      [elder.id],
    );
    let eggBalance = Number(profile.eggBalance);
    const rewarded = !reward;
    if (rewarded) {
      eggBalance += 1;
      await connection.execute('UPDATE elder_profiles SET egg_balance = ? WHERE id = ?', [eggBalance, elder.id]);
      await connection.execute(
        `INSERT INTO egg_transactions
         (elder_profile_id, health_checkin_id, transaction_type, reward_date, amount, balance_after, note)
         VALUES (?, ?, 'checkin_reward', CURRENT_DATE(), 1, ?, '健康打卡奖励')`,
        [elder.id, checkin.insertId, eggBalance],
      );
    }
    await connection.commit();
    return { eggBalance, rewarded };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createHealthAlert(user, elder, text, severity) {
  const safeText = redactSensitiveText(text).slice(0, 500);
  const [result] = await db.execute(
    `INSERT INTO health_alerts (elder_profile_id, severity, symptom_text, notification_status)
     VALUES (?, ?, ?, ?)`,
    [elder.id, severity, safeText, process.env.ALERT_SMS_TEMPLATE_CODE ? 'queued' : 'not_configured'],
  );
  const [targets] = await db.execute('SELECT phone FROM staff_notification_targets WHERE active = 1');
  let finalStatus = process.env.ALERT_SMS_TEMPLATE_CODE ? 'queued' : 'not_configured';
  let errorMessage = null;
  if (process.env.ALERT_SMS_TEMPLATE_CODE) {
    try {
      for (const target of targets) {
        await sendHealthAlert(target.phone, { address: elder.address, name: elder.real_name, symptom: safeText });
      }
      finalStatus = 'sent';
    } catch (error) {
      finalStatus = 'failed';
      errorMessage = String(error.message || error).slice(0, 500);
    }
    await db.execute(
      'UPDATE health_alerts SET notification_status = ?, notification_error = ? WHERE id = ?',
      [finalStatus, errorMessage, result.insertId],
    );
  }
  return { alertId: result.insertId, notificationStatus: finalStatus };
}

async function normalizeInterest(value) {
  const text = String(value || '').toLowerCase().replace(/[\s。，,;；:：？?]/g, '');
  const [aliases] = await db.execute(
    `SELECT a.alias, i.id, i.name FROM interest_aliases a
     JOIN interests i ON i.id = a.interest_id ORDER BY CHAR_LENGTH(a.alias) DESC`,
  );
  const matched = aliases.find((row) => text.includes(String(row.alias).toLowerCase()));
  if (matched) return { id: matched.id, name: matched.name };
  const normalized = text
    .replace(/^.*?(?:爱好是|喜欢|爱好)/, '')
    .replace(/^(?:打|玩|学|做|跳|练)/, '')
    .replace(/(?:的老人|的老年人|的人)$/, '')
    .slice(0, 32);
  if (!normalized) return null;
  await db.execute('INSERT IGNORE INTO interests (name) VALUES (?)', [normalized]);
  const [[interest]] = await db.execute('SELECT id, name FROM interests WHERE name = ? LIMIT 1', [normalized]);
  await db.execute('INSERT IGNORE INTO interest_aliases (alias, interest_id) VALUES (?, ?)', [normalized, interest.id]);
  return interest;
}

async function saveInterests(elder, text) {
  const raw = text.replace(/^.*?(?:我的爱好是|我爱好|我喜欢)\s*[:：]?/, '');
  const parts = raw.split(/[,，、;；和及]/).map((part) => part.trim()).filter(Boolean).slice(0, 10);
  const saved = [];
  for (const part of parts) {
    const interest = await normalizeInterest(part);
    if (!interest) continue;
    await db.execute('INSERT IGNORE INTO elder_interests (elder_profile_id, interest_id) VALUES (?, ?)', [elder.id, interest.id]);
    if (!saved.includes(interest.name)) saved.push(interest.name);
  }
  return saved;
}

async function facilityResponse(text) {
  const categories = [];
  if (/(医院|卫生|看病|药店)/.test(text)) categories.push('medical');
  if (/(超市|买菜|购物)/.test(text)) categories.push('supermarket');
  if (/(饭店|吃饭|小吃|餐馆|面馆)/.test(text)) categories.push('food');
  if (/(理发|剪头发|美发)/.test(text)) categories.push('barber');
  const params = [];
  let where = 'active = 1';
  if (categories.length) {
    where += ` AND category IN (${categories.map(() => '?').join(',')})`;
    params.push(...categories);
  }
  const [rows] = await db.execute(
    `SELECT category, name, address, phone, description, verification_status AS verificationStatus
     FROM community_facilities WHERE ${where}
     ORDER BY FIELD(category, 'medical', 'supermarket', 'food', 'barber'), id LIMIT 12`,
    params,
  );
  if (!rows.length) return '暂时没有找到对应的周边设施资料。';
  const categoryNames = { medical: '医疗', supermarket: '超市', food: '餐饮小吃', barber: '理发', community: '社区服务', other: '其他' };
  return `金狮苑及紫阳街道周边可参考：\n${rows.map((row, index) => {
    const verify = row.verificationStatus === 'needs_verification' ? '（营业状态/门牌待核实）' : '';
    const phone = row.phone ? `，电话 ${row.phone}` : '';
    return `${index + 1}. [${categoryNames[row.category]}] ${row.name}${verify}\n   ${row.address}${phone}`;
  }).join('\n') }\n\n商户营业情况可能变化，出发前建议再电话或地图确认。`;
}

async function noticesResponse() {
  const [rows] = await db.execute(
    `SELECT notice_type AS noticeType, title, content, deadline, published_at AS publishedAt
     FROM community_notices WHERE active = 1 ORDER BY published_at DESC LIMIT 8`,
  );
  if (!rows.length) return '暂时没有可查询的社区政策或通知。';
  return `最新政策和通知：\n${rows.map((row, index) => {
    const deadline = row.deadline ? `\n   截止时间：${String(row.deadline).slice(0, 10)}` : '';
    return `${index + 1}. ${row.title}\n   ${row.content}${deadline}`;
  }).join('\n')}`;
}

async function findInterestPeers(elder, text) {
  const interest = await normalizeInterest(text);
  if (!interest) return '您想找哪种兴趣爱好的朋友？例如：“有没有喜欢打羽毛球的？”';
  const [rows] = await db.execute(
    `SELECT e.real_name AS realName FROM elder_interests ei
     JOIN elder_profiles e ON e.id = ei.elder_profile_id
     WHERE ei.interest_id = ? AND ei.elder_profile_id <> ? AND e.status = 'active'
     ORDER BY e.created_at ASC LIMIT 20`,
    [interest.id, elder.id],
  );
  if (!rows.length) return `目前还没有其他老人登记“${interest.name}”这项爱好。`;
  return `目前有${rows.length}位老人也喜欢${interest.name}：${rows.map((row) => maskName(row.realName)).join('、')}。为了保护隐私，这里不展示住址和联系方式。`;
}

async function childSummary(userId, weekly) {
  const [relations] = await db.execute(
    `SELECT e.* FROM elder_relations r JOIN elder_profiles e ON e.id = r.elder_profile_id
     WHERE r.child_user_id = ? AND r.status = 'approved' ORDER BY r.created_at ASC`,
    [userId],
  );
  if (!relations.length) return '目前还没有已确认的老人关联。需要由老人本人或社区工作人员确认后才能查看摘要。';
  const start = weekly ? 'DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY)' : 'CURRENT_DATE()';
  const sections = [];
  for (const elder of relations) {
    const [messages] = elder.user_id ? await db.query(
      `SELECT content FROM chat_messages
       WHERE user_id = ? AND role = 'user' AND message_kind = 'chat' AND created_at >= ${start}
       ORDER BY created_at ASC LIMIT 100`,
      [elder.user_id],
    ) : [[]];
    const [[checkins]] = await db.query(
      `SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM health_checkins
       WHERE elder_profile_id = ? AND created_at >= ${start}`,
      [elder.id],
    );
    const [[alerts]] = await db.query(
      `SELECT COUNT(*) AS count, SUM(status = 'open') AS openCount FROM health_alerts
       WHERE elder_profile_id = ? AND created_at >= ${start}`,
      [elder.id],
    );
    let topics = '暂无咨询记录';
    if (messages.length) {
      try {
        const result = await chatCompletion(
          '请把老人的咨询记录归纳成2至5个简短主题，不引用原话，不输出隐私信息，只输出用顿号分隔的主题。',
          [{ role: 'user', content: messages.map((row) => row.content).join('\n').slice(0, 20_000) }],
        );
        topics = result.content;
      } catch (_error) {
        topics = `共咨询${messages.length}次`;
      }
    }
    sections.push(`${elder.real_name}（${elder.address || '住址待补充'}）\n- 咨询主题：${topics}\n- 健康打卡：${checkins.count}次\n- 健康求助：${alerts.count}次，其中待处理${Number(alerts.openCount || 0)}次`);
  }
  return `${weekly ? '本周' : '今天'}老人情况摘要：\n\n${sections.join('\n\n')}`;
}

async function staffAlertsResponse() {
  const [rows] = await db.execute(
    `SELECT a.id, a.severity, a.symptom_text AS symptomText, a.status, a.created_at AS createdAt,
            e.real_name AS realName, e.address
     FROM health_alerts a JOIN elder_profiles e ON e.id = a.elder_profile_id
     ORDER BY FIELD(a.status, 'open', 'acknowledged', 'resolved'), FIELD(a.severity, 'critical', 'urgent', 'normal'), a.created_at DESC
     LIMIT 50`,
  );
  if (!rows.length) return '目前没有老人健康求助记录。';
  const severityNames = { critical: '紧急', urgent: '需关注', normal: '一般' };
  return `老人健康求助：\n${rows.map((row, index) => `${index + 1}. [${severityNames[row.severity]}/${row.status}] ${row.realName}，${row.address || '住址未登记'}\n   ${row.symptomText}\n   ${new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`).join('\n')}`;
}

async function staffCheckinsResponse() {
  const [rows] = await db.execute(
    `SELECT h.*, e.real_name AS realName, e.address FROM health_checkins h
     JOIN elder_profiles e ON e.id = h.elder_profile_id
     WHERE h.created_at >= CURRENT_DATE() ORDER BY h.created_at DESC LIMIT 100`,
  );
  if (!rows.length) return '今天还没有老人完成健康打卡。';
  return `今日健康打卡：\n${rows.map((row, index) => {
    const metrics = [
      row.systolic ? `血压${row.systolic}/${row.diastolic}` : null,
      row.heart_rate ? `心率${row.heart_rate}` : null,
      row.blood_glucose ? `血糖${row.blood_glucose}` : null,
      row.temperature ? `体温${row.temperature}` : null,
      row.sleep_hours ? `睡眠${row.sleep_hours}小时` : null,
      row.mood ? `心情${row.mood}` : null,
    ].filter(Boolean).join('、') || row.note;
    return `${index + 1}. ${row.realName}（${row.address || '住址未登记'}）：${metrics}`;
  }).join('\n')}`;
}

async function staffRelationsResponse() {
  const [rows] = await db.execute(
    `SELECT r.id, r.relation_label AS relationLabel, e.real_name AS elderName,
            u.username, u.phone, r.created_at AS createdAt
     FROM elder_relations r JOIN elder_profiles e ON e.id = r.elder_profile_id
     JOIN users u ON u.id = r.child_user_id
     WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 50`,
  );
  if (!rows.length) return { content: '目前没有待确认的家属关联。', actions: [] };
  return {
    content: `待确认家属关联：\n${rows.map((row, index) => `${index + 1}. ${maskName(row.elderName)} 的“${row.relationLabel}”，申请人 ${row.username || `${String(row.phone).slice(0, 3)}****${String(row.phone).slice(-4)}`}`).join('\n')}\n\n请点击下方按钮确认或拒绝。`,
    dynamicActions: rows.flatMap((row, index) => [
      { id: `approve-${row.id}`, label: `同意 #${index + 1}`, type: 'send', value: `同意关联 ${row.id}` },
      { id: `reject-${row.id}`, label: `拒绝 #${index + 1}`, type: 'send', value: `拒绝关联 ${row.id}` },
    ]),
  };
}

function parseChineseDate(value) {
  const match = String(value || '').trim().match(/(20\d{2})[\u5e74\/-](\d{1,2})[\u6708\/-](\d{1,2})日?/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

async function addNotice(user, text) {
  const match = text.match(/^新增政策（通知）：\s*(.+?)[;；]\s*内容[:：]\s*(.+?)[;；]\s*截止时间[:：]\s*(.+)$/);
  if (!match) return '格式不完整。请按以下格式输入：\n新增政策（通知）：标题；内容：具体内容；截止时间：2026年9月1日';
  const title = match[1].trim().slice(0, 200);
  const content = match[2].trim().slice(0, 5000);
  const deadline = parseChineseDate(match[3]);
  if (!deadline) return '截止时间无法识别，请使用“2026年9月1日”这样的格式。';
  await db.execute(
    `INSERT INTO community_notices (notice_type, title, content, deadline, created_by_user_id)
     VALUES ('notice', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content), deadline = VALUES(deadline),
       created_by_user_id = VALUES(created_by_user_id), active = 1, published_at = NOW()`,
    [title, content, deadline, user.id],
  );
  return `政策（通知）已保存：${title}，截止时间 ${deadline}。`;
}

async function respondByRole(user, text) {
  const type = Number(user.identity_type);
  if (type === 1) {
    const elder = await elderProfileForUser(user.id);
    if (!elder) return { content: '老人档案缺失，请联系社区工作人员处理。' };
    const severity = dangerSeverity(text);
    if (severity) {
      const alert = await createHealthAlert(user, elder, text, severity);
      if (severity === 'critical') return {
        content: `我很在意您现在的安全，您不需要一个人承受。\n\n请现在就做这几件事：\n1. 立即联系您信任的家人、邻居或社区工作人员，请他们来陪您。\n2. 如果您可能伤害自己，请立即拨打 110 或 120。\n3. 您也可以拨打全国心理援助热线 12356。\n\n您的紧急求助已记录${alert.notificationStatus === 'sent' ? '并已短信通知社区工作人员' : '，社区工作人员可在系统中看到'}。请回复我：“我已经联系到人陪我”。`,
      };
      return { content: `您的健康求助已记录${alert.notificationStatus === 'sent' ? '，已短信通知社区工作人员' : '，社区工作人员可以在系统中查看'}。如果症状突然加重、胸痛、呼吸困难或即将晕倒，请立即拨打120。` };
    }
    if (/(我的爱好是|我爱好|我喜欢)/.test(text) && !/(有没有|找|哪些人|其他人)/.test(text)) {
      const saved = await saveInterests(elder, text);
      return { content: saved.length ? `已为您记录爱好：${saved.join('、')}。` : '我还没有识别出具体爱好，可以说：“我的爱好是：羽毛球、书法”。' };
    }
    if (/(有没有|找|寻找).*(喜欢|爱好)|(相同爱好|同好)/.test(text)) return { content: await findInterestPeers(elder, text) };
    if (/(周边|配套|设施|医院|超市|饭店|小吃|理发|剪头发)/.test(text)) return { content: await facilityResponse(text) };
    if (/(政策|通知|补贴|社区消息)/.test(text)) return { content: await noticesResponse() };
    if (/兑换鸡蛋/.test(text)) return { content: '该功能很快就支持啦，再稍等等' };
    if (/(查看|查询|多少|余额|账户).{0,6}鸡蛋|鸡蛋.{0,6}(多少|余额)/.test(text)) {
      return { content: `您现在的鸡蛋有「${Number(elder.egg_balance || 0)}枚」。` };
    }
    if (/(健康打卡|打卡|血压|心率|血糖|体温|睡眠\s*\d|心情)/.test(text)) {
      const fields = checkinFields(text);
      const reward = await saveHealthCheckinAndReward(elder, fields, text);
      const recorded = [
        fields.systolic ? `血压 ${fields.systolic}/${fields.diastolic}` : null,
        fields.heartRate ? `心率 ${fields.heartRate}` : null,
        fields.bloodGlucose ? `血糖 ${fields.bloodGlucose}` : null,
        fields.temperature ? `体温 ${fields.temperature}℃` : null,
        fields.sleepHours ? `睡眠 ${fields.sleepHours}小时` : null,
        fields.mood ? `心情 ${fields.mood}` : null,
      ].filter(Boolean);
      if (!reward.rewarded) return {
        content: `健康打卡已保存。您今天已经领取过鸡蛋啦，每位老人每天只能领取1枚，您现在的鸡蛋有「${reward.eggBalance}枚」。`,
      };
      return {
        content: `恭喜您打卡成功，您现在的鸡蛋有「${reward.eggBalance}枚」。${recorded.length ? `本次记录：${recorded.join('、')}。` : ''}`,
      };
    }
    if (/查看待确认家属关联/.test(text)) {
      const [rows] = await db.execute(
        `SELECT r.id, r.relation_label AS relationLabel, u.username, u.phone, r.created_at AS createdAt
         FROM elder_relations r JOIN elder_profiles e ON e.id = r.elder_profile_id
         JOIN users u ON u.id = r.child_user_id
         WHERE e.user_id = ? AND r.status = 'pending'`,
        [user.id],
      );
      if (!rows.length) return { content: '目前没有待确认的家属关联。' };
      return {
        content: `有${rows.length}个家属关联申请，请核对后选择：`,
        relationActions: rows.map((row) => ({
          id: row.id,
          requesterUsername: row.username || null,
          requesterPhone: row.phone || null,
          relationLabel: row.relationLabel,
          createdAt: row.createdAt,
        })),
      };
    }
  }

  if (type === 2 && /(老人情况|今天|当天|本周|一周|打卡|咨询了什么)/.test(text)) {
    return { content: await childSummary(user.id, /(本周|一周)/.test(text)) };
  }

  if (type === 3) {
    if (/^新增政策（通知）：/.test(text)) return { content: await addNotice(user, text) };
    if (/(健康求助|求助情况|危险告警)/.test(text)) return { content: await staffAlertsResponse() };
    if (/(健康打卡|打卡情况)/.test(text)) return { content: await staffCheckinsResponse() };
    if (/(待确认|家属关联)/.test(text) && !/^(同意|拒绝)关联/.test(text)) return staffRelationsResponse();
    const relationDecision = text.match(/^(同意|拒绝)关联\s+([a-f0-9-]{36})$/i);
    if (relationDecision) {
      const status = relationDecision[1] === '同意' ? 'approved' : 'rejected';
      const [result] = await db.execute(
        `UPDATE elder_relations SET status = ?, confirmed_by_user_id = ?, confirmed_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [status, user.id, relationDecision[2]],
      );
      return { content: result.affectedRows ? `已${relationDecision[1]}这个家属关联申请。` : '该申请不存在或已经处理。' };
    }
  }

  return null;
}

router.get('/history', async (req, res, next) => {
  try {
    return res.json({ code: 200, message: 'ok', data: { messages: await todayMessages(req.user.userId) } });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res) => {
  const legacyMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const legacyLast = [...legacyMessages].reverse().find((item) => item?.role === 'user');
  const text = String(req.body?.message || legacyLast?.content || '').trim().slice(0, 8000);
  if (!text) return res.status(400).json({ code: 400, message: '请输入想说的内容' });
  let userMessageSaved = false;
  try {
    const user = await currentUser(req.user.userId);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (!user.identity_type) return res.status(409).json({ code: 409, message: '请先完成身份登记', data: { needsIdentitySetup: true } });
    await saveMessage(user.id, 'user', text, 'chat');
    userMessageSaved = true;
    const roleResult = await respondByRole(user, text);
    if (roleResult) {
      const data = await assistantReply(user.id, roleResult.content, 'chat', roleResult);
      return res.json({ code: 200, message: 'ok', data });
    }

    const history = await todayModelHistory(user.id);
    const systemPrompt = `你是“紫阳小张”，服务于杭州上城区紫阳街道居民。当前用户身份：${roleNames[Number(user.identity_type)]}。
请用友好、简洁、适老的中文回复。不要编造社区电话、地址、政策或用户信息。
医疗、法律、紧急情况不做确定性诊断，提醒联系专业机构或社区工作人员。
不请求用户在普通对话中重复提供身份证号、社工密钥等敏感信息。`;
    const completion = await chatCompletion(systemPrompt, history);
    const data = await assistantReply(user.id, completion.content, 'chat', { usage: completion.usage });
    return res.json({ code: 200, message: 'ok', data });
  } catch (error) {
    console.error('[chat]', error);
    if (userMessageSaved) {
      try {
        await saveMessage(req.user.userId, 'assistant', '对话服务暂时不可用，请稍后重试。', 'chat_error');
      } catch (_saveError) { /* keep original error */ }
    }
    return res.status(502).json({ code: 502, message: '对话服务暂时不可用，请稍后重试' });
  }
});

module.exports = router;
