const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');
const db = require('../src/config/db');
const { initializeSchema } = require('../src/db/schema');
const { staffCodeHash } = require('../src/utils/privacy');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  return Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

async function main() {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
  if (!outputArgument) throw new Error('请使用 --output=/secure/path/staff-keys.txt 指定安全输出路径');
  const outputPath = path.resolve(outputArgument.slice('--output='.length));
  await initializeSchema();
  const [[existing]] = await db.query('SELECT COUNT(*) AS count FROM staff_invite_codes');
  if (Number(existing.count) > 0) throw new Error('社工密钥已生成过，为避免重复或覆盖，本次操作已停止');

  const codes = new Set();
  while (codes.size < 20) codes.add(generateCode());
  let index = 0;
  for (const code of codes) {
    index += 1;
    await db.execute(
      'INSERT INTO staff_invite_codes (code_hash, code_last4) VALUES (?, ?)',
      [staffCodeHash(code), code.slice(-4)],
    );
  }
  const content = [
    '紫阳小张—社区工作人员一次性密钥',
    '注意：每个密钥只能绑定一个社工账号，请勿公开或上传GitHub。',
    '',
    ...[...codes].map((code, position) => `${String(position + 1).padStart(2, '0')}. ${code}`),
    '',
  ].join('\n');
  fs.writeFileSync(outputPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(`已生成20个一次性社工密钥，安全文件：${outputPath}`);
  await db.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await db.end().catch(() => {});
  process.exit(1);
});
