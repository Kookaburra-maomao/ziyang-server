require('../config/env');
const Dypnsapi20170525 = require('@alicloud/dypnsapi20170525');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');
const OpenApi = require('@alicloud/openapi-client');

function createClient() {
  const credential = new Credential.default();
  const config = new OpenApi.Config({ credential });
  config.endpoint = 'dypnsapi.aliyuncs.com';
  return new Dypnsapi20170525.default(config);
}

async function sendSmsCode(phone) {
  if (!process.env.TEMPLATE_CODE || !process.env.SIGN_NAME) throw new Error('缺少短信模板配置');
  const request = new Dypnsapi20170525.SendSmsVerifyCodeRequest({
    signName: process.env.SIGN_NAME,
    phoneNumber: phone,
    templateCode: process.env.TEMPLATE_CODE,
    templateParam: '{"code":"##code##","min":"5"}',
  });
  return createClient().sendSmsVerifyCodeWithOptions(request, new Util.RuntimeOptions({}));
}

async function verifySmsCode(phone, code) {
  const request = new Dypnsapi20170525.CheckSmsVerifyCodeRequest({ phoneNumber: phone, verifyCode: code });
  return createClient().checkSmsVerifyCodeWithOptions(request, new Util.RuntimeOptions({}));
}

module.exports = { sendSmsCode, verifySmsCode };
