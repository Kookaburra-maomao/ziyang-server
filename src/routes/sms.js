const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendSmsCode } = require('../services/sms');
const { validatePhone } = require('../utils/validation');
const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
});

async function send(req, res) {
  const phone = String(req.body?.phone || req.query?.phone || '').trim();
  if (!validatePhone(phone)) return res.status(400).json({ code: 400, message: '请输入正确的11位手机号' });
  try {
    await sendSmsCode(phone);
    return res.json({ code: 200, message: '验证码已发送', data: { phone } });
  } catch (error) {
    console.error('[sms/send]', error.message);
    return res.status(502).json({ code: 502, message: '验证码发送失败，请检查短信服务配置' });
  }
}

router.get('/send', limiter, send);
router.post('/send', limiter, send);
module.exports = router;
