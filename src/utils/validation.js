const phonePattern = /^1[3-9]\d{9}$/;
const usernamePattern = /^[\p{L}\p{N}_-]{3,32}$/u;

const validatePhone = (phone) => phonePattern.test(String(phone || '').trim());
const validateUsername = (username) => usernamePattern.test(String(username || '').trim());
const validatePassword = (password) => typeof password === 'string' && password.length >= 8 && password.length <= 72;

module.exports = { validatePhone, validateUsername, validatePassword };
