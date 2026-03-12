-- 001_initial_schema.sql — drymem schema v2 (based on engram)

CREATE TABLE IF NOT EXISTS sessions (
  id        TEXT PRIMARY KEY,
  project_path TEXT NOT NULL DEFAULT '',
  directory    TEXT DEFAULT '',
  started_at   DATETIME DEFAULT (datetime('now', 'localtime')),
  ended_at     DATETIME DEFAULT NULL,
  summary      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS observations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    DEFAULT '',
  type             TEXT    NOT NULL DEFAULT 'manual',
  title            TEXT    NOT NULL DEFAULT '',
  content          TEXT    NOT NULL DEFAULT '',
  tool_name        TEXT    DEFAULT '',
  project_path     TEXT    NOT NULL DEFAULT '',
  scope            TEXT    NOT NULL DEFAULT 'project',
  topic_key        TEXT    NOT NULL DEFAULT '',
  normalized_hash  TEXT    NOT NULL DEFAULT '',
  revision_count   INTEGER NOT NULL DEFAULT 1,
  duplicate_count  INTEGER NOT NULL DEFAULT 1,
  last_seen_at     DATETIME DEFAULT (datetime('now', 'localtime')),
  created_at       DATETIME DEFAULT (datetime('now', 'localtime')),
  updated_at       DATETIME DEFAULT (datetime('now', 'localtime')),
  deleted_at       DATETIME DEFAULT NULL
);

-- For topic_key upsert queries
CREATE INDEX IF NOT EXISTS idx_obs_topic
ON observations(topic_key, project_path, scope);

-- For dedup window lookups
CREATE INDEX IF NOT EXISTS idx_obs_dedup
ON observations(normalized_hash, project_path, scope, type, title);

-- For context / recent queries
CREATE INDEX IF NOT EXISTS idx_obs_project_time
ON observations(project_path, created_at DESC);

-- FTS5: title weighted A, content B, rest C
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts
USING fts5(
  title,
  content,
  tool_name,
  type,
  project_path,
  content='observations',
  content_rowid='id'
);

-- Keep FTS in sync automatically
CREATE TRIGGER IF NOT EXISTS obs_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, content, tool_name, type, project_path)
  VALUES (new.id, new.title, new.content, new.tool_name, new.type, new.project_path);
END;

CREATE TRIGGER IF NOT EXISTS obs_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, content, tool_name, type, project_path)
  VALUES ('delete', old.id, old.title, old.content, old.tool_name, old.type, old.project_path);
END;

CREATE TRIGGER IF NOT EXISTS obs_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, content, tool_name, type, project_path)
  VALUES ('delete', old.id, old.title, old.content, old.tool_name, old.type, old.project_path);
  INSERT INTO observations_fts(rowid, title, content, tool_name, type, project_path)
  VALUES (new.id, new.title, new.content, new.tool_name, new.type, new.project_path);
END;
