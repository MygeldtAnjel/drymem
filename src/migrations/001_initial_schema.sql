-- migrations/001_initial_schema.sql

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_key TEXT NOT NULL,
  project_path TEXT DEFAULT 'global',
  scope TEXT DEFAULT 'project',
  query_input TEXT,
  proposed_code TEXT,
  content TEXT NOT NULL,
  attachments TEXT DEFAULT '[]',
  status TEXT DEFAULT 'ACCEPTED',
  revision_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_topic_project 
ON memories(topic_key, project_path, scope);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
USING fts5(topic_key, query_input, proposed_code, content, content='memories', content_rowid='id');
