ALTER TABLE project_applications
  ADD COLUMN ai_match_score TINYINT UNSIGNED NULL AFTER ai_review_status,
  ADD COLUMN ai_review_detail_json JSON NULL AFTER ai_review_summary,
  MODIFY status ENUM('draft','pending_secretary_review','pending_owner_review','pending_contact_consent','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending_secretary_review',
  ADD COLUMN contact_consent_status ENUM('not_requested','pending','accepted','rejected') NOT NULL DEFAULT 'not_requested' AFTER status,
  ADD COLUMN contact_consent_at DATETIME NULL AFTER contact_consent_status;

CREATE TABLE IF NOT EXISTS project_application_review_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  decision ENUM('pass','revise','reject','error') NOT NULL,
  score TINYINT UNSIGNED NULL,
  threshold_score TINYINT UNSIGNED NOT NULL DEFAULT 60,
  detail_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_application_review_logs_application (application_id, created_at),
  KEY idx_application_review_logs_decision (decision, score, created_at),
  CONSTRAINT fk_application_review_log_application FOREIGN KEY (application_id) REFERENCES project_applications(id),
  CONSTRAINT fk_application_review_log_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_application_review_log_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
