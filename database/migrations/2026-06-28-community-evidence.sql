ALTER TABLE evidence_records
  ADD COLUMN community_id BIGINT UNSIGNED NULL AFTER event_id;

ALTER TABLE evidence_records
  ADD KEY idx_evidence_community (community_id, status, created_at);
