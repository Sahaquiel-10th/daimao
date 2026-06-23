SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE projects
  ADD COLUMN ideal_participant TEXT NULL AFTER tags_json,
  ADD COLUMN not_fit_participant TEXT NULL AFTER ideal_participant,
  ADD COLUMN required_capabilities_json JSON NULL AFTER not_fit_participant,
  ADD COLUMN participation_roles_json JSON NULL AFTER required_capabilities_json;

CREATE TABLE IF NOT EXISTS rag_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_type ENUM('profile','card','event_record','project_record','project_application','feedback','admin_note','project','event') NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  community_id BIGINT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL DEFAULT '',
  summary TEXT NULL,
  tags_json JSON NULL,
  visibility ENUM('private','match_only','project_visible','public','admin_only') NOT NULL DEFAULT 'private',
  status ENUM('pending','indexing','indexed','failed','stale','archived') NOT NULL DEFAULT 'pending',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  text_hash CHAR(64) NOT NULL DEFAULT '',
  metadata_json JSON NULL,
  last_indexed_at DATETIME NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rag_source_version (source_type, source_id, version),
  KEY idx_rag_sources_owner (owner_user_id, status, visibility),
  KEY idx_rag_sources_project (project_id, status, visibility),
  KEY idx_rag_sources_status (status, updated_at),
  CONSTRAINT fk_rag_sources_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_rag_sources_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rag_chunks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  content_summary VARCHAR(500) NOT NULL DEFAULT '',
  vector_doc_id VARCHAR(160) NOT NULL DEFAULT '',
  evidence_polarity ENUM('positive','neutral','negative','preference') NOT NULL DEFAULT 'neutral',
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
  status ENUM('pending','indexed','failed','archived') NOT NULL DEFAULT 'pending',
  indexed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rag_chunk_source (source_id, chunk_index),
  KEY idx_rag_chunks_vector_doc (vector_doc_id),
  KEY idx_rag_chunks_status (status, updated_at),
  CONSTRAINT fk_rag_chunks_source FOREIGN KEY (source_id) REFERENCES rag_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rag_index_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  job_type ENUM('upsert','delete','reindex') NOT NULL DEFAULT 'upsert',
  status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_rag_jobs_status (status, created_at),
  CONSTRAINT fk_rag_jobs_source FOREIGN KEY (source_id) REFERENCES rag_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
