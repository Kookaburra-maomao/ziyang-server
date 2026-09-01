require('./config/env');
const app = require('./app');
const db = require('./config/db');
const { initializeSchema } = require('./db/schema');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

async function start() {
  if (!process.env.JWT_SECRET) throw new Error('缺少必需环境变量: JWT_SECRET');
  await db.query('SELECT 1');
  await initializeSchema();
  app.listen(port, host, () => console.log(`ziyang-server listening on http://${host}:${port}`));
}

start().catch((error) => {
  console.error('[startup failed]', error);
  process.exit(1);
});
