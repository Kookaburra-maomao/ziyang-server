const { createHmac } = require('crypto');
require('../config/env');

const idCardPattern = /(?<!\d)(\d{17}[\dXx])(?!\d)/;
const staffCodePattern = /(?<![A-Z0-9])([A-Z0-9]{16})(?![A-Z0-9])/i;

function secret() {
  const value = process.env.SENSITIVE_DATA_HMAC_KEY || process.env.JWT_SECRET;
  if (!value) throw new Error('缺少敏感数据哈希密钥');
  return value;
}

function hmac(value, purpose) {
  return createHmac('sha256', secret()).update(`${purpose}:${String(value)}`).digest('hex');
}

function normalizeIdCard(value) {
  return String(value || '').trim().toUpperCase();
}

function extractIdCard(text) {
  return normalizeIdCard(String(text || '').match(idCardPattern)?.[1] || '');
}

function validateIdCard(value) {
  const id = normalizeIdCard(value);
  if (!/^\d{17}[\dX]$/.test(id)) return false;
  const birth = id.slice(6, 14);
  const year = Number(birth.slice(0, 4));
  const month = Number(birth.slice(4, 6));
  const day = Number(birth.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0);
  return checks[sum % 11] === id[17];
}

function idCardHash(idCard) {
  return hmac(normalizeIdCard(idCard), 'id-card');
}

function staffCodeHash(code) {
  return hmac(String(code || '').trim().toUpperCase(), 'staff-code');
}

function extractStaffCode(text) {
  return String(text || '').match(staffCodePattern)?.[1]?.toUpperCase() || '';
}

function redactSensitiveText(text) {
  return String(text || '')
    .replace(idCardPattern, (id) => `${id.slice(0, 6)}********${id.slice(-4)}`)
    .replace(staffCodePattern, (code) => `************${code.slice(-4)}`);
}

function maskName(name) {
  const value = String(name || '').trim();
  if (!value) return '未知姓名';
  if (value.length === 1) return `${value}**`;
  return `${value[0]}${'*'.repeat(Math.min(value.length - 1, 2))}`;
}

module.exports = {
  extractIdCard,
  extractStaffCode,
  idCardHash,
  maskName,
  normalizeIdCard,
  redactSensitiveText,
  staffCodeHash,
  validateIdCard,
};
