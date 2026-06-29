ALTER TABLE users
  ADD COLUMN public_user_code VARCHAR(32) NULL AFTER id,
  ADD UNIQUE KEY uk_users_public_code (public_user_code);

UPDATE users
SET public_user_code = LPAD(id, 3, '0')
WHERE public_user_code IS NULL OR public_user_code = '';

CREATE TABLE IF NOT EXISTS user_referrals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referred_user_id BIGINT UNSIGNED NOT NULL,
  referrer_user_id BIGINT UNSIGNED NOT NULL,
  community_id BIGINT UNSIGNED NULL,
  source ENUM('admin','community_admin','system','migration') NOT NULL DEFAULT 'admin',
  status ENUM('active','replaced','revoked') NOT NULL DEFAULT 'active',
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by_admin_account_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_referrals_referred (referred_user_id, status),
  KEY idx_referrals_referrer (referrer_user_id, status),
  KEY idx_referrals_community (community_id, status),
  CONSTRAINT fk_referrals_referred FOREIGN KEY (referred_user_id) REFERENCES users(id),
  CONSTRAINT fk_referrals_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  CONSTRAINT fk_referrals_community FOREIGN KEY (community_id) REFERENCES communities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
