CREATE TABLE IF NOT EXISTS user_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  source_appid VARCHAR(80) NOT NULL,
  openid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) NOT NULL DEFAULT '',
  community_id BIGINT UNSIGNED NULL,
  identity_type ENUM('wechat_miniprogram','admin_import','external_api') NOT NULL DEFAULT 'wechat_miniprogram',
  status ENUM('active','merged','disabled') NOT NULL DEFAULT 'active',
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_identity_app_openid (source_appid, openid),
  KEY idx_identity_user (user_id, status),
  KEY idx_identity_unionid (unionid),
  KEY idx_identity_community (community_id, status),
  CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_identity_community FOREIGN KEY (community_id) REFERENCES communities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_clients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  appid VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  company_name VARCHAR(160) NOT NULL DEFAULT '',
  community_id BIGINT UNSIGNED NULL,
  client_type ENUM('wechat_miniprogram','web','server') NOT NULL DEFAULT 'wechat_miniprogram',
  status ENUM('active','paused','disabled') NOT NULL DEFAULT 'active',
  config_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_app_clients_appid (appid),
  KEY idx_app_clients_community (community_id, status),
  CONSTRAINT fk_app_clients_community FOREIGN KEY (community_id) REFERENCES communities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
