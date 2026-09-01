const db = require('../config/db');

const tableStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(64) NULL,
    phone VARCHAR(20) NULL,
    password_hash VARCHAR(255) NULL,
    profile_completed TINYINT(1) NOT NULL DEFAULT 0,
    identity_type TINYINT UNSIGNED NULL COMMENT '1 elder, 2 child, 3 community worker',
    pending_identity_type TINYINT UNSIGNED NULL,
    real_name VARCHAR(64) NULL,
    address VARCHAR(255) NULL,
    id_card_hmac CHAR(64) NULL,
    id_card_last4 CHAR(4) NULL,
    sensitive_consent_at DATETIME NULL,
    identity_completed_at DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_users_username (username),
    UNIQUE KEY uk_users_phone (phone),
    UNIQUE KEY uk_users_id_card_hmac (id_card_hmac)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content MEDIUMTEXT NOT NULL,
    message_kind VARCHAR(40) NOT NULL DEFAULT 'chat',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_chat_messages_user_created (user_id, created_at),
    KEY idx_chat_messages_user_kind (user_id, message_kind),
    CONSTRAINT fk_chat_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS elder_profiles (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NULL,
    real_name VARCHAR(64) NOT NULL,
    address VARCHAR(255) NULL,
    id_card_hmac CHAR(64) NOT NULL,
    id_card_last4 CHAR(4) NOT NULL,
    status ENUM('pending', 'active') NOT NULL DEFAULT 'pending',
    created_by_user_id CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_elder_profiles_user (user_id),
    UNIQUE KEY uk_elder_profiles_id_card (id_card_hmac),
    KEY idx_elder_profiles_status (status),
    CONSTRAINT fk_elder_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_elder_profiles_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS elder_relations (
    id CHAR(36) NOT NULL PRIMARY KEY,
    child_user_id CHAR(36) NOT NULL,
    elder_profile_id CHAR(36) NOT NULL,
    relation_label VARCHAR(32) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    confirmed_by_user_id CHAR(36) NULL,
    confirmed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_elder_relation_pair (child_user_id, elder_profile_id),
    KEY idx_elder_relations_elder_status (elder_profile_id, status),
    CONSTRAINT fk_elder_relations_child FOREIGN KEY (child_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_elder_relations_elder FOREIGN KEY (elder_profile_id) REFERENCES elder_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_elder_relations_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS staff_invite_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code_hash CHAR(64) NOT NULL,
    code_last4 CHAR(4) NOT NULL,
    used_by_user_id CHAR(36) NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_staff_invite_code_hash (code_hash),
    CONSTRAINT fk_staff_code_user FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS interests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_interests_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS interest_aliases (
    alias VARCHAR(64) NOT NULL PRIMARY KEY,
    interest_id BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_interest_alias_interest FOREIGN KEY (interest_id) REFERENCES interests(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS elder_interests (
    elder_profile_id CHAR(36) NOT NULL,
    interest_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (elder_profile_id, interest_id),
    CONSTRAINT fk_elder_interest_elder FOREIGN KEY (elder_profile_id) REFERENCES elder_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_elder_interest_interest FOREIGN KEY (interest_id) REFERENCES interests(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS health_checkins (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    elder_profile_id CHAR(36) NOT NULL,
    systolic SMALLINT UNSIGNED NULL,
    diastolic SMALLINT UNSIGNED NULL,
    heart_rate SMALLINT UNSIGNED NULL,
    blood_glucose DECIMAL(5,2) NULL,
    temperature DECIMAL(4,1) NULL,
    sleep_hours DECIMAL(3,1) NULL,
    mood VARCHAR(32) NULL,
    symptoms VARCHAR(255) NULL,
    note TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_health_checkins_elder_created (elder_profile_id, created_at),
    CONSTRAINT fk_health_checkin_elder FOREIGN KEY (elder_profile_id) REFERENCES elder_profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS health_alerts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    elder_profile_id CHAR(36) NOT NULL,
    severity ENUM('normal', 'urgent', 'critical') NOT NULL DEFAULT 'normal',
    symptom_text VARCHAR(500) NOT NULL,
    status ENUM('open', 'acknowledged', 'resolved') NOT NULL DEFAULT 'open',
    notification_status ENUM('not_configured', 'queued', 'sent', 'failed') NOT NULL DEFAULT 'not_configured',
    notification_error VARCHAR(500) NULL,
    acknowledged_by_user_id CHAR(36) NULL,
    acknowledged_at DATETIME NULL,
    resolved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_health_alerts_status_created (status, created_at),
    KEY idx_health_alerts_elder_created (elder_profile_id, created_at),
    CONSTRAINT fk_health_alert_elder FOREIGN KEY (elder_profile_id) REFERENCES elder_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_health_alert_ack_user FOREIGN KEY (acknowledged_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS community_facilities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    category ENUM('medical', 'supermarket', 'food', 'barber', 'community', 'other') NOT NULL,
    name VARCHAR(120) NOT NULL,
    address VARCHAR(255) NOT NULL,
    phone VARCHAR(40) NULL,
    description VARCHAR(500) NULL,
    source_url VARCHAR(1000) NULL,
    verification_status ENUM('verified', 'needs_verification') NOT NULL DEFAULT 'verified',
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_community_facility (name, address),
    KEY idx_community_facilities_category_active (category, active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS community_notices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    notice_type ENUM('policy', 'notice') NOT NULL DEFAULT 'notice',
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    deadline DATE NULL,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_url VARCHAR(1000) NULL,
    created_by_user_id CHAR(36) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_community_notice_title (title),
    KEY idx_community_notices_active_published (active, published_at),
    CONSTRAINT fk_community_notice_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS staff_notification_targets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_staff_notification_phone (phone)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
];

const userColumns = [
  ['identity_type', "ADD COLUMN identity_type TINYINT UNSIGNED NULL COMMENT '1 elder, 2 child, 3 community worker' AFTER profile_completed"],
  ['pending_identity_type', 'ADD COLUMN pending_identity_type TINYINT UNSIGNED NULL AFTER identity_type'],
  ['real_name', 'ADD COLUMN real_name VARCHAR(64) NULL AFTER pending_identity_type'],
  ['address', 'ADD COLUMN address VARCHAR(255) NULL AFTER real_name'],
  ['id_card_hmac', 'ADD COLUMN id_card_hmac CHAR(64) NULL AFTER address'],
  ['id_card_last4', 'ADD COLUMN id_card_last4 CHAR(4) NULL AFTER id_card_hmac'],
  ['sensitive_consent_at', 'ADD COLUMN sensitive_consent_at DATETIME NULL AFTER id_card_last4'],
  ['identity_completed_at', 'ADD COLUMN identity_completed_at DATETIME NULL AFTER sensitive_consent_at'],
];

async function ensureColumn(table, column, definition) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  if (!rows.length) await db.query(`ALTER TABLE \`${table}\` ${definition}`);
}

async function ensureIndex(table, indexName, definition) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName],
  );
  if (!rows.length) await db.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
}

const interestSeeds = [
  ['羽毛球', ['羽毛球', '打羽毛球', '羽球']],
  ['乒乓球', ['乒乓球', '打乒乓球', '乒乓']],
  ['广场舞', ['广场舞', '跳广场舞']],
  ['唱歌', ['唱歌', 'K歌', '卡拉OK']],
  ['书法', ['书法', '写毛笔字', '毛笔字']],
  ['象棋', ['象棋', '下象棋']],
  ['围棋', ['围棋', '下围棋']],
  ['散步', ['散步', '走路', '健步走']],
  ['太极拳', ['太极拳', '打太极', '太极']],
  ['园艺', ['园艺', '种花', '养花']],
];

const facilitySeeds = [
  ['medical', '上羊市街社区卫生服务站', '杭州市上城区中河南路76号', null, '金狮苑所属社区的基层卫生服务站。', 'https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web1855/site/attach/41/140925125152028.pdf', 'verified'],
  ['medical', '紫阳街道社区卫生服务中心', '杭州市上城区中山南路303号', '0571-86077940', '提供基本医疗和公共卫生服务。', 'https://www.amap.com/place/B023B07LOG', 'verified'],
  ['medical', '杭州市第一人民医院吴山院区（杭州市肿瘤医院）', '杭州市上城区中山南路严官巷34号', '0571-56006000', '三级肿瘤专科医院，亦设内科、保健门诊等。', 'https://wushan.hz-hospital.com/contact', 'verified'],
  ['supermarket', '世纪联华超市（江城店）', '杭州市上城区江城路558号', '0571-86078881', '靠近望江路的综合超市。', 'https://ditu.amap.com/place/B023B13PZN', 'verified'],
  ['supermarket', '优品购超市（金狮苑店）', '杭州市上城区望江路121-2号', null, '金狮苑附近便利超市，营业状态建议出行前再确认。', 'https://51sjxx.com/wen/3131.html', 'needs_verification'],
  ['food', '东东面馆（金钗袋巷店）', '杭州市上城区金钗袋巷96号', '13858007211', '老杭州小吃，有臭豆腐、葱包桧、油墩儿等。', 'https://mdaily.hangzhou.com.cn/mrsb/2026/07/16/article_detail_3_20260716A098.html', 'verified'],
  ['food', '卫忠烤饼', '杭州市上城区金钗袋巷93号', null, '兰溪风味早餐和烤饼，营业状态建议出行前再确认。', 'https://hznews.hangzhou.com.cn/jingji/content/2020-11/08/content_7849042.htm', 'needs_verification'],
  ['barber', '抚宁巷老牌理发店', '杭州市上城区抚宁巷沿街（门牌待核实）', null, '公开报道提及该店在2023年已经营26年，店名和当前营业状态待社区线下确认。', 'https://hznews.hangzhou.com.cn/chengshi/content/2023-09/02/content_8611887.htm', 'needs_verification'],
];

const noticeSeeds = [
  ['policy', '浙江扩大中度以上失能老年人养老服务消费补贴范围', '符合条件的中度以上失能老年人，可按政策申领能力评估及居家养老服务消费补贴。具体资格和申领流程请以当地民政部门公布为准。', '2026-12-31', '2026-07-01 09:00:00', 'https://www.cncaprc.gov.cn/xwllxw/772038.jhtml'],
  ['policy', '关于推进互助性养老服务发展的意见', '国家推动社区支持、老年人自愿、社会参与的互助性养老服务，鼓励邻里互助、兴趣活动与志愿服务。', null, '2026-04-29 09:00:00', 'https://sousuo.www.gov.cn/zcwjk/policyDocumentLibrary?q=%E5%85%BB%E8%80%81&t=zhengcelibrary_bm'],
  ['policy', '促进普惠养老服务高质量发展的若干措施', '政策鼓励养老机构的康复护理、老年食堂和活动场地向社区开放，为老年人提供助餐、助浴、助洁、日间照料和康复护理等服务。', null, '2026-02-09 09:00:00', 'https://www.cncaprc.gov.cn/xxzcfg/770263.jhtml'],
];

async function seedReferenceData() {
  for (const [name, aliases] of interestSeeds) {
    await db.execute('INSERT IGNORE INTO interests (name) VALUES (?)', [name]);
    const [[interest]] = await db.execute('SELECT id FROM interests WHERE name = ? LIMIT 1', [name]);
    for (const alias of aliases) {
      await db.execute('INSERT IGNORE INTO interest_aliases (alias, interest_id) VALUES (?, ?)', [alias.toLowerCase(), interest.id]);
    }
  }

  for (const row of facilitySeeds) {
    await db.execute(
      `INSERT IGNORE INTO community_facilities
       (category, name, address, phone, description, source_url, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row,
    );
  }

  for (const row of noticeSeeds) {
    await db.execute(
      `INSERT IGNORE INTO community_notices
       (notice_type, title, content, deadline, published_at, source_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row,
    );
  }

  await db.execute(
    `INSERT INTO staff_notification_targets (name, phone, active)
     VALUES ('测试社区社工', '18610995540', 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), active = 1`,
  );
}

async function initializeSchema() {
  for (const statement of tableStatements.slice(0, 2)) await db.query(statement);
  for (const [column, definition] of userColumns) await ensureColumn('users', column, definition);
  await ensureColumn('chat_messages', 'message_kind', "ADD COLUMN message_kind VARCHAR(40) NOT NULL DEFAULT 'chat' AFTER content");
  await ensureIndex('users', 'uk_users_id_card_hmac', 'UNIQUE KEY uk_users_id_card_hmac (id_card_hmac)');
  await ensureIndex('chat_messages', 'idx_chat_messages_user_kind', 'KEY idx_chat_messages_user_kind (user_id, message_kind)');
  for (const statement of tableStatements.slice(2)) await db.query(statement);
  await seedReferenceData();
}

module.exports = { initializeSchema };
