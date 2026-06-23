DELETE FROM rag_index_jobs
WHERE source_id IN (
  SELECT id FROM rag_sources WHERE source_type = 'project_application'
);

DELETE FROM rag_chunks
WHERE source_id IN (
  SELECT id FROM rag_sources WHERE source_type = 'project_application'
);

DELETE FROM rag_sources
WHERE source_type = 'project_application';

ALTER TABLE rag_sources
  MODIFY source_type ENUM(
    'profile',
    'card',
    'event_record',
    'project_record',
    'feedback',
    'admin_note',
    'project',
    'event',
    'offline_transcript'
  ) NOT NULL;
