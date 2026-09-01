const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('./config/env');
const { notFound, errorHandler } = require('./middleware/error-handler');

const app = express();
const publicPath = path.resolve(__dirname, '../public');
const indexPath = path.join(publicPath, 'index.html');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) {
  if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('不允许的跨域请求'));
} }));
app.use(express.json({ limit: '14mb' }));

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/community', require('./routes/community'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/asr', require('./routes/asr'));
app.use(express.static(publicPath, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return notFound(req, res);
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return next();
});
app.use(notFound);
app.use(errorHandler);
module.exports = app;
