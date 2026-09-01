const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { verifySmsCode } = require('../services/sms');
const { createToken } = require('../services/token');
const { validatePhone, validateUsername, validatePassword } = require('../utils/validation');
const { publicUser } = require('../utils/public-user');
const router = express.Router();

function authResponse(user, message = '登录成功') {
  return { code: 200, message, data: { token: createToken(user), user: publicUser(user) } };
}

function duplicateMessage(error) {
  if (error.code !== 'ER_DUP_ENTRY') return null;
  return String(error.message).includes('uk_users_phone') ? '手机号已被使用' : '用户名已存在';
}

function validateCredentials(username, password, confirmPassword) {
  if (!validateUsername(username)) return '用户名需3-32位，可使用中英文、数字、下划线或短横线';
  if (!validatePassword(password)) return '密码需8-72位';
  if (password !== confirmPassword) return '两次输入的密码不一致';
  return null;
}

router.post('/register', async (req, res, next) => {
  const username = String(req.body?.username || '').trim();
  const { password, confirmPassword } = req.body || {};
  const validationError = validateCredentials(username, password, confirmPassword);
  if (validationError) return res.status(400).json({ code: 400, message: validationError });

  try {
    const user = {
      id: randomUUID(), username, phone: null,
      password_hash: await bcrypt.hash(password, 12),
      profile_completed: 1, created_at: new Date(),
    };
    await db.execute('INSERT INTO users (id, username, password_hash, profile_completed, last_login_at) VALUES (?, ?, ?, 1, NOW())', [user.id, user.username, user.password_hash]);
    return res.status(201).json(authResponse(user, '注册成功'));
  } catch (error) {
    const message = duplicateMessage(error);
    if (message) return res.status(409).json({ code: 409, message });
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  if (!username || !password) return res.status(400).json({ code: 400, message: '请输入用户名和密码' });
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    await db.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    return res.json(authResponse(user));
  } catch (error) {
    return next(error);
  }
});

router.post('/sms/login', async (req, res, next) => {
  const phone = String(req.body?.phone || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!validatePhone(phone) || !/^\d{4,6}$/.test(code)) return res.status(400).json({ code: 400, message: '手机号或验证码格式不正确' });
  try {
    await verifySmsCode(phone, code);
  } catch (error) {
    console.error('[auth/sms/login] verify failed:', error.message);
    return res.status(400).json({ code: 400, message: '验证码错误或已过期' });
  }

  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
    let user = rows[0];
    if (!user) {
      user = { id: randomUUID(), username: null, phone, password_hash: null, profile_completed: 0, created_at: new Date() };
      await db.execute('INSERT INTO users (id, phone, profile_completed, last_login_at) VALUES (?, ?, 0, NOW())', [user.id, phone]);
    } else {
      await db.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    }
    return res.json(authResponse(user));
  } catch (error) {
    return next(error);
  }
});

router.post('/complete-profile', requireAuth, async (req, res, next) => {
  const username = String(req.body?.username || '').trim();
  const { password, confirmPassword } = req.body || {};
  const validationError = validateCredentials(username, password, confirmPassword);
  if (validationError) return res.status(400).json({ code: 400, message: validationError });
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (user.profile_completed) return res.status(409).json({ code: 409, message: '账号资料已设置' });
    const passwordHash = await bcrypt.hash(password, 12);
    await db.execute('UPDATE users SET username = ?, password_hash = ?, profile_completed = 1 WHERE id = ?', [username, passwordHash, user.id]);
    return res.json(authResponse({ ...user, username, password_hash: passwordHash, profile_completed: 1 }, '账号设置成功'));
  } catch (error) {
    const message = duplicateMessage(error);
    if (message) return res.status(409).json({ code: 409, message });
    return next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.userId]);
    if (!rows[0]) return res.status(404).json({ code: 404, message: '用户不存在' });
    return res.json({ code: 200, message: 'ok', data: { user: publicUser(rows[0]) } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
