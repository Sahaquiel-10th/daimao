CREATE TABLE IF NOT EXISTS user_rag_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'reai_vdb',
  project_tag_id VARCHAR(80) NOT NULL DEFAULT '',
  user_tag_id VARCHAR(80) NOT NULL DEFAULT '',
  tag_name VARCHAR(120) NOT NULL DEFAULT '',
  status ENUM('pending','active','inactive','failed') NOT NULL DEFAULT 'pending',
  created_reason VARCHAR(60) NOT NULL DEFAULT '',
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_rag_provider (user_id, provider),
  KEY idx_user_rag_tag (provider, user_tag_id),
  KEY idx_user_rag_status (provider, status),
  CONSTRAINT fk_user_rag_tags_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
