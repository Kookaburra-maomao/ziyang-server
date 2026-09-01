require('../config/env');
const Dysmsapi20170525 = require('@alicloud/dysmsapi20170525');
const Credential = require('@alicloud/credentials');
const OpenApi = require('@alicloud/openapi-client');

function createClient() {
  const credential = new Credential.default();
  const config = new OpenApi.Config({ credential });
  config.endpoint = 'dysmsapi.aliyuncs.com';
  return new Dysmsapi20170525.default(config);
}

function configured() {
  return Boolean(process.env.ALERT_SMS_TEMPLATE_CODE && (process.env.ALERT_SMS_SIGN_NAME || process.env.SIGN_NAME));
}

async function sendHealthAlert(phone, { address, name, symptom }) {
  if (!configured()) return { status: 'not_configured' };
  const request = new Dysmsapi20170525.SendSmsRequest({
    phoneNumbers: phone,
    signName: process.env.ALERT_SMS_SIGN_NAME || process.env.SIGN_NAME,
    templateCode: process.env.ALERT_SMS_TEMPLATE_CODE,
    templateParam: JSON.stringify({
      address: String(address || '地址未登记').slice(0, 40),
      name: String(name || '未知老人').slice(0, 20),
      symptom: String(symptom || '健康求助').slice(0, 40),
    }),
  });
  const response = await createClient().sendSms(request);
  const body = response?.body || {};
  if (body.code && body.code !== 'OK') throw new Error(`${body.code}: ${body.message || '短信发送失败'}`);
  return { status: 'sent', requestId: body.requestId || null, bizId: body.bizId || null };
}

module.exports = { configured, sendHealthAlert };
