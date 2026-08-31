require('../config/env');
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ code: 401, message: '请先登录' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (_error) {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
  }
}

function requireCompletedProfile(req, res, next) {
  if (!req.user?.profileCompleted) {
    return res.status(403).json({ code: 403, message: '请先设置用户名和密码', data: { needsProfileSetup: true } });
  }
  return next();
}

module.exports = { requireAuth, requireCompletedProfile };
