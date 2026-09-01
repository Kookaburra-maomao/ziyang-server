const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../config/db');
const { requireAuth, requireCompletedProfile } = require('../middleware/auth');
const { extractOnboardingFields } = require('../services/doubao');
const { saveMessage, todayMessages } = require('../services/messages');
const {
  extractIdCard,
  extractStaffCode,
  idCardHash,
  maskName,
  redactSensitiveText,
  staffCodeHash,
  validateIdCard,
} = require('../utils/privacy');
const { publicUser } = require('../utils/public-user');

const router = express.Router();
router.use(requireAuth, requireCompletedProfile);

const identityLabels = { 1: '社区老人', 2: '老人子女', 3: '社区社工' };
const identityPrompt = '您好，为了更好地帮助您，请选择您的身份：社区老人、老人子女或社区社工。';
const detailPrompts = {
  1: '爷爷奶奶您好，您可以告诉我，您叫什么？家住在哪里吗？以及您的身份证号。您可以说：“张xx，金狮苑16幢2单元201室，33011019500101xxxx”。',
  2: '您需要先为家里长辈登记信息，并告诉我老人的姓名、和您的关系、身份证号。您可以说：“张xx，爸爸，33011019500101xxxx”。',
  3: '请登记您的姓名和社区工作人员密钥。您可以说：“张xx, xxxxxxxxxxxxxxxx”。',
};

const roleWelcomes = {
  1: '资料保存成功。我可以帮您：\n1. 记录兴趣爱好\n2. 查询社区周边设施\n3. 了解最新政策和通知\n4. 健康打卡\n5. 健康求助\n6. 寻找相同爱好的老年人。\n您直接跟我说就好。',
  2: '资料保存成功。家属关联经老人本人或社区工作人员确认后，您可以了解老人当天或本周的咨询情况、健康打卡和求助状态。',
  3: '社区工作人员信息登记成功。您可以查看老人健康求助、查看健康打卡、确认家属关联，以及更新社区政策和通知。',
};

function actionsFor(user, pendingRelations = 0) {
  if (!user.identity_type) {
    if (user.pending_identity_type) return [];
    return [
      { id: 'identity-elder', label: '社区老人', type: 'identity', value: 1 },
      { id: 'identity-child', label: '老人子女', type: 'identity', value: 2 },
      { id: 'identity-staff', label: '社区社工', type: 'identity', value: 3 },
    ];
  }
  if (Number(user.identity_type) === 1) return [
    { id: 'interest-save', label: '记录兴趣', type: 'fill', value: '我的爱好是：' },
    { id: 'facilities', label: '周边设施', type: 'send', value: '社区周边有什么配套设施？' },
    { id: 'notices', label: '政策通知', type: 'send', value: '有什么最新社区政策和通知？' },
    { id: 'checkin', label: '健康打卡', type: 'fill', value: '健康打卡：' },
    { id: 'help', label: '健康求助', type: 'fill', value: '我有点不舒服：' },
    { id: 'find-interest', label: '找相同爱好', type: 'fill', value: '有没有喜欢打羽毛球的老人？' },
    ...(pendingRelations ? [{ id: 'relations', label: `家属关联待确认(${pendingRelations})`, type: 'send', value: '查看待确认家属关联' }] : []),
  ];
  if (Number(user.identity_type) === 2) return [
    { id: 'child-today', label: '今天情况', type: 'send', value: '请介绍一下老人今天的情况' },
    { id: 'child-week', label: '本周情况', type: 'send', value: '请介绍一下老人本周的情况' },
  ];
  return [
    { id: 'staff-alerts', label: '健康求助', type: 'send', value: '查看社区老人的健康求助情况' },
    { id: 'staff-checkins', label: '健康打卡', type: 'send', value: '查看社区老人的健康打卡情况' },
    { id: 'staff-relations', label: '家属关联', type: 'send', value: '查看待确认家属关联' },
    { id: 'staff-notice', label: '更新政策通知', type: 'fill', value: '新增政策（通知）：标题；内容：具体内容；截止时间：2026年9月1日' },
  ];
}

async function getUser(userId, executor = db) {
  const [rows] = await executor.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function ensureDailyMessage(user) {
  let kind = null;
  let content = null;
  if (!user.identity_type && !user.pending_identity_type) {
    kind = 'identity_prompt';
    content = identityPrompt;
  } else if (!user.identity_type && user.pending_identity_type) {
    kind = 'identity_details_prompt';
    content = detailPrompts[Number(user.pending_identity_type)];
  } else if (user.identity_type) {
    kind = 'role_welcome';
    content = roleWelcomes[Number(user.identity_type)];
  }
  if (!kind || !content) return;
  const [rows] = await db.execute(
    'SELECT 1 FROM chat_messages WHERE user_id = ? AND message_kind = ? AND created_at >= CURRENT_DATE() LIMIT 1',
    [user.id, kind],
  );
  if (!rows.length) await saveMessage(user.id, 'assistant', content, kind);
}

async function pendingRelationsForElder(userId) {
  const [rows] = await db.execute(
    `SELECT r.id, r.relation_label AS relationLabel, u.username, u.phone, r.created_at AS createdAt
     FROM elder_relations r
     JOIN elder_profiles e ON e.id = r.elder_profile_id
     JOIN users u ON u.id = r.child_user_id
     WHERE e.user_id = ? AND r.status = 'pending'
     ORDER BY r.created_at ASC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    relationLabel: row.relationLabel,
    requesterUsername: row.username || null,
    requesterPhone: row.phone || null,
    createdAt: row.createdAt,
  }));
}

router.get('/bootstrap', async (req, res, next) => {
  try {
    const user = await getUser(req.user.userId);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    await ensureDailyMessage(user);
    const pendingRelations = Number(user.identity_type) === 1 ? await pendingRelationsForElder(user.id) : [];
    const messages = await todayMessages(user.id);
    return res.json({ code: 200, message: 'ok', data: {
      user: publicUser(user),
      messages,
      actions: actionsFor(user, pendingRelations.length),
      pendingRelations,
    } });
  } catch (error) {
    return next(error);
  }
});

router.post('/consent', async (req, res, next) => {
  if (req.body?.accepted !== true) return res.status(400).json({ code: 400, message: '需要您明确同意后才能收集建档信息' });
  try {
    await db.execute('UPDATE users SET sensitive_consent_at = COALESCE(sensitive_consent_at, NOW()) WHERE id = ?', [req.user.userId]);
    const user = await getUser(req.user.userId);
    return res.json({ code: 200, message: '已记录您的同意', data: { user: publicUser(user) } });
  } catch (error) {
    return next(error);
  }
});

router.post('/identity', async (req, res, next) => {
  const type = Number(req.body?.identityType);
  if (![1, 2, 3].includes(type)) return res.status(400).json({ code: 400, message: '请选择正确的身份' });
  try {
    const user = await getUser(req.user.userId);
    if (!user?.sensitive_consent_at) return res.status(409).json({ code: 409, message: '请先阅读并同意敏感信息处理说明', data: { needsConsent: true } });
    if (user.identity_type) return res.status(409).json({ code: 409, message: '身份信息已经登记' });
    await db.execute('UPDATE users SET pending_identity_type = ? WHERE id = ?', [type, user.id]);
    const userMessage = await saveMessage(user.id, 'user', identityLabels[type], 'identity_selection');
    const assistantMessage = await saveMessage(user.id, 'assistant', detailPrompts[type], 'identity_details_prompt');
    const updated = await getUser(user.id);
    return res.json({ code: 200, message: 'ok', data: { user: publicUser(updated), messages: [userMessage, assistantMessage], actions: [] } });
  } catch (error) {
    return next(error);
  }
});

function localParts(text, type) {
  const parts = String(text || '')
    .replace(/\[身份证号\]/g, '')
    .split(/[,，;；\n]/)
    .map((part) => part.trim().replace(/^(我叫|姓名是|家住|住在|地址是)/, ''))
    .filter(Boolean);
  const addressPattern = /(苑|幢|栋|单元|室|号|路|街|巷|小区|社区|弄|楼|家住|住在)/;
  if (type === 1) return {
    realName: parts.find((part) => /^[\u4e00-\u9fa5·]{2,10}$/.test(part)) || '',
    address: parts.find((part) => addressPattern.test(part)) || '',
  };
  const relationshipPattern = /^(?:爸爸|父亲|妈妈|母亲|爷爷|奶奶|外公|外婆|岳父|岳母|公公|婆婆|长辈)$/;
  return {
    elderName: parts.find((part) => /^[\u4e00-\u9fa5·]{2,10}$/.test(part) && !relationshipPattern.test(part)) || '',
    relationship: parts.find((part) => relationshipPattern.test(part)) || '',
  };
}

async function extractedFields(raw, idCard, type) {
  const safeText = redactSensitiveText(raw).replace(/\d{6}\*{8}[\dXx]{4}/, '[身份证号]');
  const local = localParts(safeText, type);
  const enough = type === 1 ? local.realName && local.address : local.elderName && local.relationship;
  if (enough) return local;
  try {
    return { ...local, ...(await extractOnboardingFields(safeText.replace(idCard, '[身份证号]'), type)) };
  } catch (_error) {
    return local;
  }
}

async function respondWithRetry(user, text) {
  const message = await saveMessage(user.id, 'assistant', text, 'identity_details_retry');
  return { code: 400, message: text, data: { message } };
}

router.post('/onboarding', async (req, res, next) => {
  const raw = String(req.body?.message || '').trim().slice(0, 2000);
  if (!raw) return res.status(400).json({ code: 400, message: '请输入登记信息' });
  try {
    const user = await getUser(req.user.userId);
    const type = Number(user?.pending_identity_type);
    if (!type || user.identity_type) return res.status(409).json({ code: 409, message: '当前不在身份登记流程中' });
    await saveMessage(user.id, 'user', raw, 'identity_details');

    if (type === 3) {
      const code = extractStaffCode(raw);
      const realName = raw.replace(code, '').replace(/[。，,;；:\s]/g, '').replace(/^(?:我叫|姓名是)/, '');
      if (!code || !/^[\u4e00-\u9fa5·]{2,10}$/.test(realName)) {
        const payload = await respondWithRetry(user, '格式还不完整，请按“姓名，16位社区工作人员密钥”重新发送。');
        return res.status(400).json(payload);
      }
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [codes] = await connection.execute('SELECT * FROM staff_invite_codes WHERE code_hash = ? FOR UPDATE', [staffCodeHash(code)]);
        if (!codes[0] || codes[0].used_at) {
          await connection.rollback();
          const payload = await respondWithRetry(user, '这个社区工作人员密钥无效或已被使用，请核对后重新发送。');
          return res.status(400).json(payload);
        }
        await connection.execute('UPDATE staff_invite_codes SET used_by_user_id = ?, used_at = NOW() WHERE id = ?', [user.id, codes[0].id]);
        await connection.execute(
          'UPDATE users SET identity_type = 3, pending_identity_type = NULL, real_name = ?, identity_completed_at = NOW() WHERE id = ?',
          [realName, user.id],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else {
      const idCard = extractIdCard(raw);
      if (!validateIdCard(idCard)) {
        const payload = await respondWithRetry(user, `身份证号格式或校验码不正确。${detailPrompts[type]}`);
        return res.status(400).json(payload);
      }
      const fields = await extractedFields(raw, idCard, type);
      const hash = idCardHash(idCard);
      if (type === 1) {
        const realName = String(fields.realName || '').trim();
        const address = String(fields.address || '').trim();
        if (!/^[\u4e00-\u9fa5·]{2,10}$/.test(realName) || address.length < 5) {
          const payload = await respondWithRetry(user, `我还没有准确识别出姓名和完整住址。${detailPrompts[1]}`);
          return res.status(400).json(payload);
        }
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          const [profiles] = await connection.execute('SELECT * FROM elder_profiles WHERE id_card_hmac = ? FOR UPDATE', [hash]);
          if (profiles[0]?.user_id && profiles[0].user_id !== user.id) {
            await connection.rollback();
            const payload = await respondWithRetry(user, '该身份信息已经绑定其他账号，请联系社区工作人员核实。');
            return res.status(409).json(payload);
          }
          if (profiles[0]) {
            await connection.execute(
              "UPDATE elder_profiles SET user_id = ?, real_name = ?, address = ?, status = 'active' WHERE id = ?",
              [user.id, realName, address, profiles[0].id],
            );
          } else {
            await connection.execute(
              `INSERT INTO elder_profiles (id, user_id, real_name, address, id_card_hmac, id_card_last4, status, created_by_user_id)
               VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
              [randomUUID(), user.id, realName, address, hash, idCard.slice(-4), user.id],
            );
          }
          await connection.execute(
            `UPDATE users SET identity_type = 1, pending_identity_type = NULL, real_name = ?, address = ?,
             id_card_hmac = ?, id_card_last4 = ?, identity_completed_at = NOW() WHERE id = ?`,
            [realName, address, hash, idCard.slice(-4), user.id],
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      } else {
        const elderName = String(fields.elderName || '').trim();
        const relationship = String(fields.relationship || '').trim();
        if (!/^[\u4e00-\u9fa5·]{2,10}$/.test(elderName) || !relationship || relationship.length > 20) {
          const payload = await respondWithRetry(user, `我还没有准确识别出老人姓名和与您的关系。${detailPrompts[2]}`);
          return res.status(400).json(payload);
        }
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          const [profiles] = await connection.execute('SELECT * FROM elder_profiles WHERE id_card_hmac = ? FOR UPDATE', [hash]);
          let elder = profiles[0];
          if (!elder) {
            elder = { id: randomUUID(), address: null, status: 'pending' };
            await connection.execute(
              `INSERT INTO elder_profiles (id, real_name, id_card_hmac, id_card_last4, status, created_by_user_id)
               VALUES (?, ?, ?, ?, 'pending', ?)`,
              [elder.id, elderName, hash, idCard.slice(-4), user.id],
            );
          }
          await connection.execute(
            `INSERT INTO elder_relations (id, child_user_id, elder_profile_id, relation_label)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE relation_label = VALUES(relation_label), updated_at = CURRENT_TIMESTAMP`,
            [randomUUID(), user.id, elder.id, relationship],
          );
          await connection.execute(
            'UPDATE users SET identity_type = 2, pending_identity_type = NULL, identity_completed_at = NOW() WHERE id = ?',
            [user.id],
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }
    }

    const updated = await getUser(user.id);
    const assistantMessage = await saveMessage(user.id, 'assistant', roleWelcomes[Number(updated.identity_type)], 'role_welcome');
    return res.json({ code: 200, message: '身份信息保存成功', data: {
      user: publicUser(updated), message: assistantMessage, actions: actionsFor(updated),
    } });
  } catch (error) {
    return next(error);
  }
});

router.post('/relations/:id/respond', async (req, res, next) => {
  const decision = req.body?.decision;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ code: 400, message: '请选择同意或拒绝' });
  try {
    const user = await getUser(req.user.userId);
    if (Number(user?.identity_type) !== 1) return res.status(403).json({ code: 403, message: '只有老人本人可以确认家属关联' });
    const [result] = await db.execute(
      `UPDATE elder_relations r
       JOIN elder_profiles e ON e.id = r.elder_profile_id
       SET r.status = ?, r.confirmed_by_user_id = ?, r.confirmed_at = NOW()
       WHERE r.id = ? AND e.user_id = ? AND r.status = 'pending'`,
      [decision, user.id, req.params.id, user.id],
    );
    if (!result.affectedRows) return res.status(404).json({ code: 404, message: '待确认关联不存在' });
    const text = decision === 'approved' ? '已同意这个家属关联申请。' : '已拒绝这个家属关联申请。';
    const message = await saveMessage(user.id, 'assistant', text, 'relation_confirmation');
    const pendingRelations = await pendingRelationsForElder(user.id);
    return res.json({ code: 200, message: text, data: { message, pendingRelations, actions: actionsFor(user, pendingRelations.length) } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
