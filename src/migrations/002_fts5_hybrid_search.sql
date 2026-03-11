-- migrations/002_fts5_hybrid_search.sql
-- Migration for FTS5 sync fix and hybrid search support
-- This migration ensures FTS5 is properly configured and synchronized

-- Drop and recreate FTS5 table to ensure clean state
DROP TABLE IF EXISTS memories_fts;

CREATE VIRTUAL TABLE memories_fts 
USING fts5(topic_key, query_input, proposed_code, content, content='memories', content_rowid='id', tokenize='porter');

-- Recreate the FTS5 index for existing data
INSERT INTO memories_fts(rowid, topic_key, query_input, proposed_code, content)
SELECT id, topic_key, query_input, proposed_code, content
FROM memories
WHERE deleted_at IS NULL;
