-- migrations/003_fts5_standalone.sql
-- Switch FTS5 from content table to standalone mode.
-- Direct DELETE on a content FTS5 table is invalid and causes "database disk image is malformed".
-- Standalone mode allows the DELETE + INSERT pattern used in memory-repository.

DROP TABLE IF EXISTS memories_fts;

CREATE VIRTUAL TABLE memories_fts
USING fts5(topic_key, query_input, proposed_code, content, tokenize='porter');

-- Rebuild index from current data
INSERT INTO memories_fts(rowid, topic_key, query_input, proposed_code, content)
SELECT id, topic_key, query_input, proposed_code, content
FROM memories
WHERE deleted_at IS NULL;
