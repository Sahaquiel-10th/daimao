ALTER TABLE projects
  ADD COLUMN cover_url VARCHAR(1000) NULL AFTER goal;

ALTER TABLE official_events
  ADD COLUMN cover_url VARCHAR(1000) NULL AFTER capacity;
