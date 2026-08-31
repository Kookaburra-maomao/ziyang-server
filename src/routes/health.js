const express = require('express');
const db = require('../config/db');
const router = express.Router();

router.get('/', async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ code: 200, message: 'ok', data: {
    service: 'ziyang-server',
    database: 'connected',
    doubaoChatConfigured: Boolean(process.env.DOUBAO_API_KEY),
    doubaoAsrConfigured: Boolean(process.env.DOUBAO_ASR_APP_ID && process.env.DOUBAO_ASR_ACCESS_TOKEN),
    smsTemplateConfigured: Boolean(process.env.TEMPLATE_CODE && process.env.SIGN_NAME),
  } });
});

module.exports = router;
