ALTER TABLE projects
  ADD COLUMN completion_summary TEXT NULL AFTER is_official_recommended,
  ADD COLUMN completed_at DATETIME NULL AFTER completion_summary,
  ADD COLUMN completed_by_user_id BIGINT UNSIGNED NULL AFTER completed_at,
  ADD KEY idx_projects_completed (status, completed_at);
