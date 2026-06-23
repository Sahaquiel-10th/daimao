CREATE TABLE IF NOT EXISTS user_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  source_profile_id VARCHAR(128) NOT NULL DEFAULT '',
  name VARCHAR(80) NOT NULL DEFAULT '',
  job VARCHAR(120) NOT NULL DEFAULT '',
  wechat VARCHAR(120) NOT NULL DEFAULT '',
  avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  intro VARCHAR(500) NOT NULL DEFAULT '',
  answers_json JSON NULL,
  tags_json JSON NULL,
  sticker_code VARCHAR(80) NOT NULL DEFAULT '',
  agreement_version VARCHAR(80) NOT NULL DEFAULT '',
  profile_status ENUM('draft','complete','hidden') NOT NULL DEFAULT 'complete',
  saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_profiles_user (user_id),
  KEY idx_user_profiles_wechat (wechat),
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_connections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  friend_user_id BIGINT UNSIGNED NOT NULL,
  source ENUM('nfc','share_card','manual','migration','other') NOT NULL DEFAULT 'other',
  first_met_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_met_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visit_count INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('active','hidden','blocked') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_connection_pair (user_id, friend_user_id),
  KEY idx_user_connections_user (user_id, status, last_met_at),
  CONSTRAINT fk_user_connections_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_connections_friend FOREIGN KEY (friend_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
