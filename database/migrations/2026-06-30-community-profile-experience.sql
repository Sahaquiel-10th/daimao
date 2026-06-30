ALTER TABLE communities
  ADD COLUMN logo_url VARCHAR(1000) NOT NULL DEFAULT '' AFTER description;

ALTER TABLE user_profiles
  ADD COLUMN admin_note TEXT NULL AFTER intro;

CREATE TABLE IF NOT EXISTS experience_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_key VARCHAR(80) NOT NULL,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  points INT NOT NULL DEFAULT 0,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_experience_rules_key (rule_key),
  KEY idx_experience_rules_status (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO experience_rules (rule_key, label, description, points, status, sort_order)
VALUES
  ('register_profile', '注册并保存名片', '首次完成名片资料。', 10, 'active', 10),
  ('card_viewed_by_other', '有人碰你的名片', '别人通过 NFC 或分享打开并保存你的名片。', 2, 'active', 20),
  ('view_other_card', '你碰别人的名片', '你主动打开并保存别人的名片。', 1, 'active', 30),
  ('share_card', '分享自己的名片', '分享呆猫名片。', 1, 'active', 40),
  ('watch_project', '围观项目', '首次围观一个项目。', 1, 'active', 50),
  ('apply_project', '提交项目申请', '提交一次有效项目申请。', 3, 'active', 60),
  ('join_project', '被项目接受参与', '项目主理人接受申请。', 20, 'active', 70),
  ('complete_project_task', '完成一次项目任务', '项目主理人确认任务完成。', 15, 'active', 80),
  ('project_completed_member', '参与项目顺利完成', '作为成员参与并完成项目。', 50, 'active', 90),
  ('project_completed_lead', '主理项目顺利完成', '作为主理人完成项目。', 120, 'active', 100),
  ('attend_event', '参加一次活动', '活动签到或管理员确认。', 8, 'active', 110),
  ('pass_review', '通过社区认证', '获得任一社区认证徽章。', 30, 'active', 120),
  ('host_event', '协助组织活动', '管理员确认协助组织活动。', 40, 'active', 130),
  ('positive_feedback', '获得正向协作反馈', '来自项目主理人或管理员的正向反馈。', 10, 'active', 140)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  status = VALUES(status),
  sort_order = VALUES(sort_order);
