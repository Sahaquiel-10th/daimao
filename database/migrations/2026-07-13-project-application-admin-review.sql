-- 先执行 2026-07-13-project-application-screening-hardening.sql。
-- AI 未直接通过的申请进入 72 小时超管复核队列。

ALTER TABLE project_applications
  MODIFY status ENUM(
    'draft','pending_secretary_review','pending_admin_review','pending_owner_review',
    'pending_contact_consent','accepted','rejected','cancelled'
  ) NOT NULL DEFAULT 'pending_secretary_review',
  ADD COLUMN admin_review_deadline_at DATETIME NULL AFTER ai_review_detail_json,
  ADD COLUMN admin_feedback TEXT NULL AFTER admin_review_deadline_at,
  ADD COLUMN admin_decision_by BIGINT UNSIGNED NULL AFTER admin_feedback,
  ADD COLUMN admin_decision_at DATETIME NULL AFTER admin_decision_by,
  ADD KEY idx_project_applications_admin_queue (status, admin_review_deadline_at, updated_at);
