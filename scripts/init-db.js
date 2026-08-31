require('../src/config/env');
const db = require('../src/config/db');
const { initializeSchema } = require('../src/db/schema');

initializeSchema()
  .then(() => console.log('数据库表结构初始化完成'))
  .finally(() => db.end());
