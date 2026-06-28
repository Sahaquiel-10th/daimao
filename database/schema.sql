SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) NULL,
  display_name VARCHAR(80) NOT NULL DEFAULT '',
  avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  experience_points INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS communities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  badge_name VARCHAR(40) NOT NULL,
  description TEXT NULL,
  logo_url VARCHAR(1000) NOT NULL DEFAULT '',
  personality_tags_json JSON NULL,
  certification_method ENUM('review_meeting','paid_event','admin_invite','manual_review','custom') NOT NULL DEFAULT 'manual_review',
  status ENUM('active','paused','archived') NOT NULL DEFAULT 'active',
  sort_weight INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_communities_status (status, sort_weight)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','active','rejected','revoked') NOT NULL DEFAULT 'pending',
  tags_json JSON NULL,
  certified_by BIGINT UNSIGNED NULL,
  certified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_community_user (community_id, user_id),
  KEY idx_memberships_user (user_id, status),
  CONSTRAINT fk_membership_community FOREIGN KEY (community_id) REFERENCES communities(id),
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS user_experience_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  points INT NOT NULL,
  source_type VARCHAR(80) NOT NULL DEFAULT '',
  source_id BIGINT UNSIGNED NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_experience_user (user_id, created_at),
  CONSTRAINT fk_experience_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  project_type VARCHAR(60) NOT NULL DEFAULT 'other',
  tags_json JSON NULL,
  ideal_participant TEXT NULL,
  not_fit_participant TEXT NULL,
  required_capabilities_json JSON NULL,
  participation_roles_json JSON NULL,
  stage VARCHAR(80) NOT NULL DEFAULT '',
  goal TEXT NULL,
  creator_user_id BIGINT UNSIGNED NOT NULL,
  visibility ENUM('private','public') NOT NULL DEFAULT 'private',
  status ENUM('draft','active','paused','completed','archived') NOT NULL DEFAULT 'draft',
  star_count INT UNSIGNED NOT NULL DEFAULT 0,
  watch_count INT UNSIGNED NOT NULL DEFAULT 0,
  official_sort_weight INT NOT NULL DEFAULT 0,
  is_official_recommended TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_projects_public_sort (visibility, status, is_official_recommended, official_sort_weight, star_count, updated_at),
  KEY idx_projects_creator (creator_user_id),
  CONSTRAINT fk_projects_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  message TEXT NOT NULL,
  can_offer TEXT NULL,
  related_experience TEXT NULL,
  ai_review_status ENUM('pending','pass','revise','reject') NOT NULL DEFAULT 'pending',
  ai_review_summary TEXT NULL,
  status ENUM('draft','pending_secretary_review','pending_owner_review','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending_secretary_review',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_application_user (project_id, user_id),
  KEY idx_project_applications_status (project_id, status, created_at),
  CONSTRAINT fk_project_app_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_app_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rag_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_type ENUM('profile','card','event_record','project_record','project_member_review','feedback','admin_note','admin_evidence','admin_interview','project','event','offline_transcript') NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  community_id BIGINT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL DEFAULT '',
  summary TEXT NULL,
  tags_json JSON NULL,
  visibility ENUM('private','profile_visible','agent_chat','match_only','project_visible','public','admin_only','sealed') NOT NULL DEFAULT 'private',
  source_trust ENUM('self_reported','system_observed','owner_review','admin_note','admin_interview','verified_record','transcript_raw','transcript_verified') NOT NULL DEFAULT 'self_reported',
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

CREATE TABLE IF NOT EXISTS project_watchers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('watching','cancelled') NOT NULL DEFAULT 'watching',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_watchers (project_id, user_id),
  KEY idx_project_watchers_user (user_id, status),
  CONSTRAINT fk_project_watchers_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_watchers_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  creator_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  content TEXT NOT NULL,
  visibility ENUM('public','project_members','admin_only') NOT NULL DEFAULT 'project_members',
  update_type ENUM('progress','milestone','meeting_summary','resource_update','announcement','other') NOT NULL DEFAULT 'progress',
  source_record_id BIGINT UNSIGNED NULL,
  status ENUM('draft','published') NOT NULL DEFAULT 'published',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_updates_view (project_id, visibility, status, created_at),
  CONSTRAINT fk_project_updates_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_updates_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('creator','member','observer','advisor','executor','resource_provider') NOT NULL DEFAULT 'member',
  permission JSON NULL,
  status ENUM('invited','active','rejected','removed','left') NOT NULL DEFAULT 'invited',
  invited_by BIGINT UNSIGNED NULL,
  joined_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_members (project_id, user_id),
  KEY idx_project_members_user (user_id, status),
  CONSTRAINT fk_project_members_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_members_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS official_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  event_type ENUM('offline_meeting','project_review','closed_door_session','workshop','demo_day','networking','other') NOT NULL DEFAULT 'other',
  location VARCHAR(255) NOT NULL DEFAULT '',
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  host_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','published','closed','cancelled','completed') NOT NULL DEFAULT 'draft',
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  official_sort_weight INT NOT NULL DEFAULT 0,
  capacity INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_public_sort (visibility, status, official_sort_weight, start_time),
  CONSTRAINT fk_events_host FOREIGN KEY (host_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_registrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('registered','approved','rejected','cancelled','attended','no_show') NOT NULL DEFAULT 'registered',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_registrations (event_id, user_id),
  CONSTRAINT fk_event_reg_event FOREIGN KEY (event_id) REFERENCES official_events(id),
  CONSTRAINT fk_event_reg_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_agent_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  public_intro TEXT NULL,
  current_role VARCHAR(120) NOT NULL DEFAULT '',
  current_goals_json JSON NULL,
  can_offer_json JSON NULL,
  looking_for_json JSON NULL,
  not_interested_in_json JSON NULL,
  preferred_project_types_json JSON NULL,
  collaboration_style TEXT NULL,
  allow_matchmaking TINYINT(1) NOT NULL DEFAULT 1,
  allow_ai_profile TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_profiles_user (user_id),
  CONSTRAINT fk_agent_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  request_type ENUM('meet_project_owner','join_project','meet_user','join_event_related_meeting','other') NOT NULL,
  message TEXT NOT NULL,
  can_offer TEXT NULL,
  reason TEXT NULL,
  ai_summary TEXT NULL,
  ai_recommendation ENUM('revise','notify','neutral') NULL,
  status ENUM('draft','pending_ai_review','pending_owner_review','notified','accepted','rejected','expired','cancelled') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meeting_requests_target (target_user_id, status, created_at),
  KEY idx_meeting_requests_requester (requester_user_id, status, created_at),
  CONSTRAINT fk_meeting_requester FOREIGN KEY (requester_user_id) REFERENCES users(id),
  CONSTRAINT fk_meeting_target FOREIGN KEY (target_user_id) REFERENCES users(id),
  CONSTRAINT fk_meeting_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_meeting_event FOREIGN KEY (event_id) REFERENCES official_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  type ENUM('project_update','event_recommendation','meeting_request','project_invitation','schedule_reminder','daily_secretary_brief','project_review','system') NOT NULL,
  title VARCHAR(180) NOT NULL,
  content TEXT NOT NULL,
  related_id BIGINT UNSIGNED NULL,
  read_status ENUM('unread','read') NOT NULL DEFAULT 'unread',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, read_status, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploaded_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  uploader_user_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(40) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  storage_key VARCHAR(512) NOT NULL,
  text_extract_status ENUM('not_required','pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_uploaded_files_project (project_id, created_at),
  CONSTRAINT fk_uploaded_files_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_uploaded_files_user FOREIGN KEY (uploader_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  uploader_user_id BIGINT UNSIGNED NOT NULL,
  record_type ENUM('meeting_note','chat_log','event_summary','project_update','manual_note','other') NOT NULL DEFAULT 'manual_note',
  title VARCHAR(180) NOT NULL,
  raw_text MEDIUMTEXT NULL,
  file_id BIGINT UNSIGNED NULL,
  visibility ENUM('project_members','admin_only') NOT NULL DEFAULT 'project_members',
  ai_process_status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_records_project (project_id, created_at),
  CONSTRAINT fk_project_records_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_records_user FOREIGN KEY (uploader_user_id) REFERENCES users(id),
  CONSTRAINT fk_project_records_file FOREIGN KEY (file_id) REFERENCES uploaded_files(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_type ENUM('extract_project_record','generate_project_summary','generate_public_update','extract_user_memory','generate_meeting_request_summary','generate_project_recommendation') NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  source_record_id BIGINT UNSIGNED NULL,
  status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  input_payload JSON NULL,
  output_payload JSON NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_ai_jobs_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reminder_intents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  source_record_id BIGINT UNSIGNED NOT NULL,
  type ENUM('meeting','task_deadline','followup','milestone') NOT NULL,
  title VARCHAR(180) NOT NULL,
  time_text VARCHAR(160) NOT NULL DEFAULT '',
  normalized_time DATETIME NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  participants_json JSON NULL,
  source_quote TEXT NOT NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  status ENUM('pending','confirmed','rejected','edited') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reminder_intents_project (project_id, status, created_at),
  CONSTRAINT fk_reminder_intents_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_reminder_intents_record FOREIGN KEY (source_record_id) REFERENCES project_records(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  location VARCHAR(255) NOT NULL DEFAULT '',
  created_by BIGINT UNSIGNED NOT NULL,
  source_intent_id BIGINT UNSIGNED NULL,
  status ENUM('active','cancelled','completed') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_events_project (project_id, status, start_time),
  CONSTRAINT fk_project_events_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_events_intent FOREIGN KEY (source_intent_id) REFERENCES reminder_intents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_event_participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  attendance_status ENUM('pending','accepted','declined','attended','absent') NOT NULL DEFAULT 'pending',
  reminder_status ENUM('none','requested','authorized','sent','failed') NOT NULL DEFAULT 'none',
  subscribe_status ENUM('none','accepted','rejected','expired') NOT NULL DEFAULT 'none',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_event_participant (event_id, user_id),
  CONSTRAINT fk_project_event_participant_event FOREIGN KEY (event_id) REFERENCES project_events(id),
  CONSTRAINT fk_project_event_participant_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reminder_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reminder_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  subscribe_template_id VARCHAR(128) NOT NULL,
  subscribe_status ENUM('none','accepted','rejected','expired') NOT NULL DEFAULT 'none',
  available_quota INT UNSIGNED NOT NULL DEFAULT 0,
  last_authorized_at DATETIME NULL,
  sent_at DATETIME NULL,
  send_status ENUM('pending','sending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reminder_recipient (event_id, user_id, subscribe_template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  reminder_id BIGINT UNSIGNED NULL,
  channel ENUM('wechat_subscribe','in_app','calendar') NOT NULL,
  template_id VARCHAR(128) NULL,
  payload JSON NULL,
  status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  error_message TEXT NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notification_logs_status (channel, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_agent_memories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  memory_type ENUM('preference','ability_claim','resource_claim','project_interest','collaboration_style','platform_observation','project_experience') NOT NULL,
  source_type VARCHAR(60) NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  evidence_level ENUM('self_claim','conversation_observed','platform_observed','collaboration_verified','admin_verified') NOT NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  visibility ENUM('private','match_only','project_visible','public') NOT NULL DEFAULT 'private',
  status ENUM('candidate','confirmed','rejected') NOT NULL DEFAULT 'candidate',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_memories_user (user_id, status, visibility)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evidence_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  community_id BIGINT UNSIGNED NULL,
  source_type VARCHAR(60) NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  evidence_type ENUM('joined_event','event_speaker','project_creator','project_member','completed_task','missed_task','useful_connection','positive_feedback','negative_feedback','admin_note','admin_interview','admin_evidence','risk_note','owner_review') NOT NULL,
  content TEXT NOT NULL,
  evidence_level ENUM('self_claim','conversation_observed','platform_observed','collaboration_verified','admin_verified') NOT NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  visibility ENUM('private','match_only','project_visible','public','admin_only','sealed') NOT NULL DEFAULT 'private',
  status ENUM('candidate','confirmed','rejected') NOT NULL DEFAULT 'candidate',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_evidence_user (user_id, status, evidence_level),
  KEY idx_evidence_community (community_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendation_candidates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  target_type ENUM('project','event','user') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  reason_summary VARCHAR(500) NOT NULL,
  score DECIMAL(8,4) NOT NULL DEFAULT 0,
  status ENUM('pending','shown','clicked','ignored','saved','expired') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_recommendations_user (user_id, status, score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id BIGINT UNSIGNED NULL,
  detail_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_logs_admin (admin_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
