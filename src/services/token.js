require('../config/env');
const jwt = require('jsonwebtoken');

function createToken(user) {
  return jwt.sign({
    userId: user.id,
    username: user.username || null,
    phone: user.phone || null,
    profileCompleted: Boolean(user.profile_completed),
  }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

module.exports = { createToken };
