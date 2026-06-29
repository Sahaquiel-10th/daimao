ALTER TABLE projects
  ADD COLUMN community_id BIGINT UNSIGNED NULL AFTER creator_user_id,
  ADD KEY idx_projects_community (community_id, status, updated_at);

ALTER TABLE official_events
  ADD COLUMN community_id BIGINT UNSIGNED NULL AFTER host_user_id,
  ADD KEY idx_events_community (community_id, status, start_time);
