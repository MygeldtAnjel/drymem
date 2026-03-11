import { db } from "./db-connector.js";

export interface MemoryRecord {
  topic_key: string;
  project_path: string;
  scope: string;
  query_input: string;
  proposed_code: string;
  content: string;
  status: string;
}

export class MemoryRepository {
  static save(data: MemoryRecord): { success: true; id: number } | { success: false; error: string } {
    try {
      const stmt = db.prepare(`
        INSERT INTO memories (topic_key, project_path, scope, query_input, proposed_code, content, status)
        VALUES (@topic_key, @project_path, @scope, @query_input, @proposed_code, @content, @status)
        ON CONFLICT(topic_key, project_path, scope)
        DO UPDATE SET
          query_input = @query_input, proposed_code = @proposed_code, content = @content, status = @status,
          revision_count = revision_count + 1, updated_at = datetime('now', 'localtime'), deleted_at = NULL
      `);
      
      stmt.run(data);
      
      const row = db.prepare(`SELECT id FROM memories WHERE topic_key = ? AND project_path = ? AND scope = ?`).get(
        data.topic_key,
        data.project_path,
        data.scope
      ) as { id: number } | undefined;

      if (row) {
        db.prepare(`DELETE FROM memories_fts WHERE rowid = ?`).run(row.id);
        db.prepare(`INSERT INTO memories_fts(rowid, topic_key, query_input, proposed_code, content) VALUES (?, ?, ?, ?, ?)`)
          .run(row.id, data.topic_key, data.query_input, data.proposed_code, data.content);
      }
      
      return { success: true, id: row!.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  static search(keyword: string, project_path: string): any[] {
    try {
      const ftsResults = db.prepare(`
        SELECT m.id, m.topic_key, m.scope, m.content, m.status, m.revision_count, m.updated_at, 0 as search_type
        FROM memories m
        WHERE m.project_path = ?
        AND m.id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?)
        AND m.deleted_at IS NULL
        LIMIT 10
      `).all(project_path, keyword);

      if (ftsResults.length > 0) {
        return ftsResults;
      }

      const likeResults = db.prepare(`
        SELECT m.id, m.topic_key, m.scope, m.content, m.status, m.revision_count, m.updated_at, 1 as search_type
        FROM memories m
        WHERE (m.topic_key LIKE ? OR m.content LIKE ?)
        AND m.deleted_at IS NULL
        AND m.project_path = ?
        ORDER BY m.updated_at DESC
        LIMIT 10
      `).all(`%${keyword}%`, `%${keyword}%`, project_path);

      return likeResults;
    } catch (error) {
      return [];
    }
  }

  static getContext(project_path: string): any[] {
    try {
      return db.prepare(`
        SELECT topic_key, content, status, updated_at
        FROM memories
        WHERE project_path = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 5
      `).all(project_path);
    } catch (error) {
      return [];
    }
  }

  static delete(topic_key: string, project_path: string): boolean {
    try {
      const result = db.prepare(`
        UPDATE memories
        SET deleted_at = datetime('now', 'localtime')
        WHERE topic_key = ? AND project_path = ?
      `).run(topic_key, project_path);
      return result.changes > 0;
    } catch (error) {
      return false;
    }
  }
}
