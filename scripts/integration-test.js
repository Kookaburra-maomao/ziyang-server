require('../src/config/env');

const { randomUUID } = require('crypto');
const db = require('../src/config/db');
const { staffCodeHash } = require('../src/utils/privacy');

const baseUrl = process.env.INTEGRATION_BASE_URL || 'http://127.0.0.1:3001';
const suffix = `${Date.now()}`.slice(-10);
const password = 'CodexTest2026!';
const staffCode = 'TESTSTAFFKEY2026';
const state = { userIds: [], elderProfileIds: [], staffCodeHash: staffCodeHash(staffCode) };

function createTestIdCard() {
  const sequence = String(Number(suffix.slice(-3)) || 1).padStart(3, '0');
  const base = `11010519500101${sequence}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = [...base].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return `${base}${checks[sum % 11]}`;
}

const idCard = createTestIdCard();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.message || 'unknown error'}`);
  return payload.data;
}

async function register(prefix) {
  const data = await request('/api/auth/register', {
    body: { username: `${prefix}_${suffix}`, password, confirmPassword: password },
  });
  state.userIds.push(data.user.id);
  return data;
}

async function setupIdentity(account, identityType, message) {
  await request('/api/community/consent', { token: account.token, body: { accepted: true } });
  await request('/api/community/identity', { token: account.token, body: { identityType } });
  return request('/api/community/onboarding', { token: account.token, body: { message } });
}

async function chat(token, message) {
  return request('/api/chat', { token, body: { message } });
}

async function createPeer() {
  const peerId = randomUUID();
  state.elderProfileIds.push(peerId);
  await db.execute(
    `INSERT INTO elder_profiles (id, real_name, address, id_card_hmac, id_card_last4, status)
     VALUES (?, '李奶奶', '集成测试临时地址', ?, '0000', 'active')`,
    [peerId, `integration-peer-${suffix}`],
  );
  const [[interest]] = await db.execute("SELECT id FROM interests WHERE name = '羽毛球' LIMIT 1");
  await db.execute('INSERT INTO elder_interests (elder_profile_id, interest_id) VALUES (?, ?)', [peerId, interest.id]);
}

async function cleanup() {
  try {
    if (state.userIds.length) {
      const placeholders = state.userIds.map(() => '?').join(',');
      const [profiles] = await db.execute(`SELECT id FROM elder_profiles WHERE user_id IN (${placeholders}) OR created_by_user_id IN (${placeholders})`, [...state.userIds, ...state.userIds]);
      state.elderProfileIds.push(...profiles.map((row) => row.id));
    }
    const profileIds = [...new Set(state.elderProfileIds)];
    if (profileIds.length) {
      const placeholders = profileIds.map(() => '?').join(',');
      await db.execute(`DELETE FROM elder_relations WHERE elder_profile_id IN (${placeholders})`, profileIds);
      await db.execute(`DELETE FROM elder_profiles WHERE id IN (${placeholders})`, profileIds);
    }
    await db.execute('DELETE FROM staff_invite_codes WHERE code_hash = ?', [state.staffCodeHash]);
    if (state.userIds.length) {
      const placeholders = state.userIds.map(() => '?').join(',');
      await db.execute(`DELETE FROM users WHERE id IN (${placeholders})`, state.userIds);
    }
  } finally {
    await db.end();
  }
}

async function main() {
  const results = [];
  try {
    const elder = await register('codex_elder');
    const bootstrap = await request('/api/community/bootstrap', { token: elder.token });
    assert(bootstrap.actions.some((item) => item.value === 1), 'new-user identity actions missing');
    results.push('new-user bootstrap');

    const elderSetup = await setupIdentity(elder, 1, `${idCard}，家住金狮苑16幢2单元201室，我叫张爷爷`);
    assert(elderSetup.user.identityType === 1, 'elder identity was not saved');
    assert(!JSON.stringify(elderSetup).includes(idCard), 'raw ID card leaked in elder response');
    results.push('elder onboarding + ID redaction');

    await chat(elder.token, '我的爱好是：打羽毛球、写毛笔字');
    const facilities = await chat(elder.token, '社区周边有什么医院和超市？');
    assert(/卫生服务|医院/.test(facilities.message.content), 'facility lookup failed');
    const notices = await chat(elder.token, '有什么最新社区政策和通知？');
    assert(/养老/.test(notices.message.content), 'policy lookup failed');
    await chat(elder.token, '健康打卡：血压128/78，心率72，睡眠7小时，心情很好');
    const alert = await chat(elder.token, '我今天有点头晕和恶心');
    assert(/健康求助已记录/.test(alert.message.content), 'health alert was not recorded');
    results.push('elder interests/facilities/policies/check-in/alert');

    await createPeer();
    const peers = await chat(elder.token, '有没有喜欢打羽毛球的老人？');
    assert(/有\d+位老人/.test(peers.message.content) && /李\*\*/.test(peers.message.content), 'peer matching or name masking failed');
    assert(!/集成测试临时地址/.test(peers.message.content), 'peer address leaked');
    results.push('privacy-safe interest matching');

    const child = await register('codex_child');
    const childSetup = await setupIdentity(child, 2, `张爷爷，爸爸，${idCard}`);
    assert(childSetup.user.identityType === 2, 'child identity was not saved');
    const pending = await request('/api/community/bootstrap', { token: elder.token });
    assert(pending.pendingRelations.length === 1, 'elder relation confirmation was not created');
    assert(pending.pendingRelations[0].requesterUsername === child.user.username, 'elder cannot see the full requester account');
    await request(`/api/community/relations/${pending.pendingRelations[0].id}/respond`, {
      token: elder.token,
      body: { decision: 'approved' },
    });
    const summary = await chat(child.token, '请介绍一下老人今天的情况');
    assert(/健康打卡：1次/.test(summary.message.content) && /健康求助：1次/.test(summary.message.content), 'child summary counts are incorrect');
    results.push('child relationship confirmation + daily summary');

    await db.execute(
      'INSERT INTO staff_invite_codes (code_hash, code_last4) VALUES (?, ?)',
      [state.staffCodeHash, staffCode.slice(-4)],
    );
    const staff = await register('codex_staff');
    const staffSetup = await setupIdentity(staff, 3, `王社工，${staffCode}`);
    assert(staffSetup.user.identityType === 3, 'staff identity was not saved');
    assert(!JSON.stringify(staffSetup).includes(staffCode), 'raw staff code leaked in response');
    const alerts = await chat(staff.token, '查看社区老人的健康求助情况');
    assert(/张爷爷/.test(alerts.message.content), 'staff alert lookup failed');
    const checkins = await chat(staff.token, '查看健康打卡情况');
    assert(/张爷爷/.test(checkins.message.content), 'staff check-in lookup failed');
    results.push('staff key onboarding + workbench queries');

    const [rawLeaks] = await db.execute(
      `SELECT COUNT(*) AS count FROM chat_messages
       WHERE user_id IN (${state.userIds.map(() => '?').join(',')}) AND content LIKE ?`,
      [...state.userIds, `%${idCard}%`],
    );
    assert(Number(rawLeaks[0].count) === 0, 'raw ID card leaked into chat history');
    results.push('server-side history privacy check');

    process.stdout.write(`integration ok: ${results.join(' | ')}\n`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`integration failed: ${error.message}\n`);
  process.exitCode = 1;
});
