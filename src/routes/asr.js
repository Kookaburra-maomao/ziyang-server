const express = require('express');
const { randomUUID } = require('crypto');
const { requireAuth, requireCompletedProfile } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth, requireCompletedProfile);

router.post('/doubao', async (req, res) => {
  if (!process.env.DOUBAO_ASR_APP_ID || !process.env.DOUBAO_ASR_ACCESS_TOKEN) {
    return res.status(503).json({ code: 503, message: '语音识别尚未配置', data: { requiredEnv: ['DOUBAO_ASR_APP_ID', 'DOUBAO_ASR_ACCESS_TOKEN'] } });
  }
  const rawData = String(req.body?.file_data || req.body?.audioBase64 || '');
  const fileData = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData;
  if (!fileData) return res.status(400).json({ code: 400, message: '请提供录音数据' });
  if (Buffer.byteLength(fileData, 'base64') > 10 * 1024 * 1024) return res.status(413).json({ code: 413, message: '录音不能超过10MB' });

  const requestId = randomUUID();
  const body = {
    user: { uid: req.user.userId },
    audio: { data: fileData },
    request: { model_name: 'bigmodel' },
  };
  if (req.body?.hotwords) {
    const values = Array.isArray(req.body.hotwords) ? req.body.hotwords : [req.body.hotwords];
    body.context = JSON.stringify({ hotwords: values.map((word) => ({ word: String(word) })) });
  }

  try {
    const response = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Key': process.env.DOUBAO_ASR_APP_ID,
        'X-Api-Access-Key': process.env.DOUBAO_ASR_ACCESS_TOKEN,
        'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json().catch(() => ({}));
    const statusCode = response.headers.get('x-api-status-code');
    const message = response.headers.get('x-api-message');
    const logId = response.headers.get('x-tt-logid');
    if (statusCode !== '20000000') {
      const clientError = ['20000003', '45000001', '45000002', '45000151'].includes(statusCode);
      return res.status(clientError ? 400 : 502).json({ code: clientError ? 400 : 502, message: message || '语音识别失败', data: { statusCode, logId } });
    }
    return res.json({ code: 200, message: '语音识别成功', data: {
      text: result.result?.text || '',
      duration: result.audio_info?.duration || 0,
      utterances: result.result?.utterances || [],
      requestId,
      logId,
    } });
  } catch (error) {
    console.error('[asr/doubao]', error);
    return res.status(502).json({ code: 502, message: '语音识别服务请求失败' });
  }
});

module.exports = router;
