const express = require('express');
const OpenAI = require('openai');
const db = require('../config/db');
const { requireAuth, requireCompletedProfile } = require('../middleware/auth');
const router = express.Router();

const systemPrompt = `你是“紫阳社区 AI 助手”，为社区居民提供友好、简洁、可执行的中文帮助。
你可以协助处理社区生活咨询、通知解读、事务指引、文字整理和日常问答。
涉及医疗、法律、紧急事件或政府政策时，明确提醒用户向专业机构或社区工作人员核实。
不要编造社区电话、地址、政策或用户隐私信息。`;

function getClient() {
  if (!process.env.DOUBAO_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.DOUBAO_API_KEY, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
}

router.use(requireAuth, requireCompletedProfile);

router.get('/history', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const [rows] = await db.execute(
      `SELECT id, role, content, created_at AS createdAt
       FROM (SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) recent
       ORDER BY id ASC`,
      [req.user.userId, limit],
    );
    return res.json({ code: 200, message: 'ok', data: { messages: rows } });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const normalized = messages
    .filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string')
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 8000) }))
    .filter((item) => item.content)
    .slice(-20);
  if (!normalized.length || normalized.at(-1).role !== 'user') {
    return res.status(400).json({ code: 400, message: '请输入想说的内容' });
  }

  const client = getClient();
  if (!client) return res.status(503).json({ code: 503, message: '服务器尚未配置豆包文本模型' });
  try {
    const completion = await client.chat.completions.create({
      model: process.env.DOUBAO_CHAT_MODEL || 'doubao-seed-2-0-lite-260215',
      messages: [{ role: 'system', content: systemPrompt }, ...normalized],
      thinking: { type: 'disabled' },
    });
    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('模型未返回有效内容');
    await db.execute(
      'INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?), (?, ?, ?)',
      [req.user.userId, 'user', normalized.at(-1).content, req.user.userId, 'assistant', content],
    );
    return res.json({ code: 200, message: 'ok', data: { message: { role: 'assistant', content }, usage: completion.usage || null } });
  } catch (error) {
    console.error('[chat]', error);
    return res.status(502).json({ code: 502, message: '对话服务暂时不可用，请稍后重试' });
  }
});

module.exports = router;
