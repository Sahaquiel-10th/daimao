ALTER TABLE rag_sources
  MODIFY source_type ENUM(
    'profile',
    'card',
    'event_record',
    'project_record',
    'project_member_review',
    'feedback',
    'admin_note',
    'admin_evidence',
    'admin_interview',
    'project',
    'event',
    'offline_transcript'
  ) NOT NULL;

ALTER TABLE rag_sources
  MODIFY visibility ENUM(
    'private',
    'profile_visible',
    'agent_chat',
    'match_only',
    'project_visible',
    'public',
    'admin_only',
    'sealed'
  ) NOT NULL DEFAULT 'private';

ALTER TABLE rag_sources
  ADD COLUMN source_trust ENUM(
    'self_reported',
    'system_observed',
    'owner_review',
    'admin_note',
    'admin_interview',
    'verified_record',
    'transcript_raw',
    'transcript_verified'
  ) NOT NULL DEFAULT 'self_reported' AFTER visibility;

CREATE TABLE IF NOT EXISTS project_member_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  reviewed_user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(80) NOT NULL DEFAULT '',
  contribution_text TEXT NOT NULL,
  outcome_text TEXT NULL,
  risk_text TEXT NULL,
  reliability_score TINYINT UNSIGNED NULL,
  collaboration_score TINYINT UNSIGNED NULL,
  delivery_score TINYINT UNSIGNED NULL,
  source_file_id BIGINT UNSIGNED NULL,
  visibility ENUM('admin_only','sealed','match_only') NOT NULL DEFAULT 'sealed',
  status ENUM('draft','confirmed','archived') NOT NULL DEFAULT 'confirmed',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_member_review (project_id, reviewer_user_id, reviewed_user_id),
  KEY idx_project_member_reviews_user (reviewed_user_id, status, updated_at),
  KEY idx_project_member_reviews_project (project_id, status),
  CONSTRAINT fk_pmr_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_pmr_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id),
  CONSTRAINT fk_pmr_reviewed FOREIGN KEY (reviewed_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE evidence_records
  MODIFY evidence_type ENUM(
    'joined_event',
    'event_speaker',
    'project_creator',
    'project_member',
    'completed_task',
    'missed_task',
    'useful_connection',
    'positive_feedback',
    'negative_feedback',
    'admin_note',
    'admin_interview',
    'admin_evidence',
    'risk_note',
    'owner_review'
  ) NOT NULL;

ALTER TABLE evidence_records
  MODIFY visibility ENUM(
    'private',
    'match_only',
    'project_visible',
    'public',
    'admin_only',
    'sealed'
  ) NOT NULL DEFAULT 'private';
