const db = require('../config/db');
const { redactSensitiveText } = require('../utils/privacy');

async function saveMessage(userId, role, content, messageKind = 'chat', executor = db) {
  const safeContent = redactSensitiveText(String(content || '').trim()).slice(0, 20_000);
  const [result] = await executor.execute(
    'INSERT INTO chat_messages (user_id, role, content, message_kind) VALUES (?, ?, ?, ?)',
    [userId, role, safeContent, messageKind],
  );
  return { id: result.insertId, role, content: safeContent, messageKind, createdAt: new Date() };
}

async function todayMessages(userId, limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const [rows] = await db.execute(
    `SELECT id, role, content, message_kind AS messageKind, created_at AS createdAt
     FROM (SELECT id, role, content, message_kind, created_at
           FROM chat_messages
           WHERE user_id = ? AND created_at >= CURRENT_DATE()
           ORDER BY id DESC LIMIT ?) recent
     ORDER BY id ASC`,
    [userId, safeLimit],
  );
  return rows;
}

async function todayModelHistory(userId) {
  const rows = await todayMessages(userId, 300);
  let characters = 0;
  const selected = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const size = row.content.length;
    if (selected.length && characters + size > 60_000) break;
    selected.unshift({ role: row.role, content: row.content });
    characters += size;
  }
  return selected;
}

module.exports = { saveMessage, todayMessages, todayModelHistory };
