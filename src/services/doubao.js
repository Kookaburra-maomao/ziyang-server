const OpenAI = require('openai');
require('../config/env');

function getClient() {
  if (!process.env.DOUBAO_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.DOUBAO_API_KEY, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
}

async function chatCompletion(systemPrompt, messages) {
  const client = getClient();
  if (!client) throw new Error('服务器尚未配置豆包文本模型');
  const completion = await client.chat.completions.create({
    model: process.env.DOUBAO_CHAT_MODEL || 'doubao-seed-2-0-lite-260215',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    thinking: { type: 'disabled' },
  });
  const content = completion.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('模型未返回有效内容');
  return { content, usage: completion.usage || null };
}

function parseJson(content) {
  const cleaned = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型未返回JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function extractOnboardingFields(text, type) {
  const requirements = type === 1
    ? '提取 realName（老人姓名）和 address（完整住址）'
    : '提取 elderName（老人姓名）和 relationship（用户与老人的关系，如爸爸/妈妈/爷爷）';
  const prompt = `你是中文信息提取器。${requirements}。
输入中的[身份证号]是已在本地安全提取的占位符。
忽略“我叫”“家住”等口语，不要猜测缺失信息。
只返回JSON对象，字段值缺失时为空字符串。`;
  const result = await chatCompletion(prompt, [{ role: 'user', content: String(text || '').slice(0, 1000) }]);
  return parseJson(result.content);
}

module.exports = { chatCompletion, extractOnboardingFields, getClient };
