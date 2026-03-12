import { createHash } from "crypto";
import { db } from "./db-connector.js";

const DEDUP_WINDOW_MIN = 15;

export const OBSERVATION_TYPES = [
  "manual", "decision", "architecture", "bugfix", "pattern",
  "config", "discovery", "learning", "session_summary", "passive",
] as const;

export type ObservationType = typeof OBSERVATION_TYPES[number];

export interface ObservationRecord {
  session_id?:  string;
  type:         string;
  title:        string;
  content:      string;
  tool_name?:   string;
  project_path: string;
  scope?:       string;
  topic_key?:   string;
}

export type SaveResult =
  | { success: true;  id: number; action: "inserted" | "updated" | "deduplicated" }
  | { success: false; error: string };

function normalizedHash(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeScope(scope?: string): string {
  return scope === "personal" ? "personal" : "project";
}

function normalizeTopicKey(key?: string): string {
  if (!key) return "";
  return key.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 120);
}

// Infer engram-style topic family from type or content keywords
function inferFamily(type: string, title: string, content: string): string {
  const t = type.toLowerCase();
  if (/architecture|design|adr|refactor/.test(t)) return "architecture";
  if (/bug|bugfix|fix|incident|hotfix/.test(t)) return "bug";
  if (/decision/.test(t)) return "decision";
  if (/pattern|convention|guideline/.test(t)) return "pattern";
  if (/config|setup|infra|ci/.test(t)) return "config";
  if (/discovery|investigation/.test(t)) return "discovery";
  if (/learning|learn/.test(t)) return "learning";
  if (/session/.test(t)) return "session";

  const text = (title + " " + content).toLowerCase();
  if (/\b(bug|fix|panic|error|crash)\b/.test(text)) return "bug";
  if (/\b(architecture|design|adr)\b/.test(text)) return "architecture";
  if (/\b(decision|tradeoff|choose)\b/.test(text)) return "decision";
  if (/\b(config|setup|install)\b/.test(text)) return "config";
  return "topic";
}

export class MemoryRepository {

  // ── Save / upsert ──────────────────────────────────────────────────────────

  static save(data: ObservationRecord): SaveResult {
    try {
      const scope     = normalizeScope(data.scope);
      const topic_key = normalizeTopicKey(data.topic_key);
      const hash      = normalizedHash(data.content);
      const session_id = data.session_id  ?? "";
      const tool_name  = data.tool_name   ?? "";

      // 1. Topic key upsert — same key+project+scope → UPDATE
      if (topic_key) {
        const existing = db.prepare(`
          SELECT id FROM observations
          WHERE topic_key = ? AND project_path = ? AND scope = ? AND deleted_at IS NULL
          ORDER BY updated_at DESC LIMIT 1
        `).get(topic_key, data.project_path, scope) as { id: number } | undefined;

        if (existing) {
          db.prepare(`
            UPDATE observations SET
              title           = ?,
              content         = ?,
              normalized_hash = ?,
              revision_count  = revision_count + 1,
              last_seen_at    = datetime('now', 'localtime'),
              updated_at      = datetime('now', 'localtime')
            WHERE id = ?
          `).run(data.title, data.content, hash, existing.id);
          return { success: true, id: existing.id, action: "updated" };
        }
      }

      // 2. Dedup window — same hash+project+scope+type+title within N minutes → increment
      const dedup = db.prepare(`
        SELECT id FROM observations
        WHERE normalized_hash = ?
          AND project_path = ? AND scope = ? AND type = ? AND title = ?
          AND deleted_at IS NULL
          AND created_at >= datetime('now', 'localtime', '-${DEDUP_WINDOW_MIN} minutes')
        LIMIT 1
      `).get(hash, data.project_path, scope, data.type, data.title) as { id: number } | undefined;

      if (dedup) {
        db.prepare(`
          UPDATE observations SET
            duplicate_count = duplicate_count + 1,
            last_seen_at    = datetime('now', 'localtime')
          WHERE id = ?
        `).run(dedup.id);
        return { success: true, id: dedup.id, action: "deduplicated" };
      }

      // 3. Insert new
      const result = db.prepare(`
        INSERT INTO observations
          (session_id, type, title, content, tool_name, project_path, scope, topic_key, normalized_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session_id, data.type, data.title, data.content, tool_name,
             data.project_path, scope, topic_key, hash);

      return { success: true, id: result.lastInsertRowid as number, action: "inserted" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  static search(
    keyword: string,
    project_path: string,
    options: { type?: string; scope?: string; limit?: number } = {}
  ): any[] {
    const limit = Math.min(options.limit ?? 10, 20);
    const sanitized = keyword.trim().split(/\s+/).map(w => `"${w}"`).join(" ");

    try {
      const conditions: string[] = ["o.deleted_at IS NULL", "o.project_path = ?"];
      const params: any[] = [sanitized, project_path];
      if (options.type)  { conditions.push("o.type = ?");  params.push(options.type); }
      if (options.scope) { conditions.push("o.scope = ?"); params.push(options.scope); }
      params.push(limit);

      const rows = db.prepare(`
        SELECT o.id, o.topic_key, o.type, o.title, o.content, o.scope, o.project_path,
               o.revision_count, o.duplicate_count, o.last_seen_at, o.created_at, o.updated_at
        FROM observations_fts fts
        JOIN observations o ON o.id = fts.rowid
        WHERE observations_fts MATCH ? AND ${conditions.join(" AND ")}
        ORDER BY fts.rank LIMIT ?
      `).all(...params);

      if (rows.length) return rows;
    } catch { /* fall through to LIKE */ }

    // LIKE fallback
    const likeParams: any[] = [`%${keyword}%`, `%${keyword}%`, project_path];
    let sql = `
      SELECT id, topic_key, type, title, content, scope, project_path,
             revision_count, duplicate_count, last_seen_at, created_at, updated_at
      FROM observations
      WHERE (title LIKE ? OR content LIKE ?) AND deleted_at IS NULL AND project_path = ?
    `;
    if (options.type)  { sql += " AND type = ?";  likeParams.push(options.type); }
    if (options.scope) { sql += " AND scope = ?"; likeParams.push(options.scope); }
    sql += ` ORDER BY updated_at DESC LIMIT ${limit}`;

    return db.prepare(sql).all(...likeParams);
  }

  // ── Context ────────────────────────────────────────────────────────────────

  static getContext(project_path: string, limit = 20): string {
    const sessions = db.prepare(`
      SELECT s.id, s.project_path, s.started_at, s.ended_at, s.summary,
             COUNT(o.id) as observation_count
      FROM sessions s
      LEFT JOIN observations o ON o.session_id = s.id AND o.deleted_at IS NULL
      WHERE s.project_path = ?
      GROUP BY s.id
      ORDER BY s.started_at DESC LIMIT 5
    `).all(project_path) as any[];

    const observations = db.prepare(`
      SELECT id, topic_key, type, title, content, scope, created_at
      FROM observations
      WHERE project_path = ? AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT ?
    `).all(project_path, limit) as any[];

    const lines: string[] = [];

    if (sessions.length) {
      lines.push("### Recent Sessions");
      for (const s of sessions) {
        const summary = s.summary ? ` — ${String(s.summary).slice(0, 100)}` : "";
        lines.push(`- **${s.project_path}** (${s.started_at})${summary} [${s.observation_count} observations]`);
      }
      lines.push("");
    }

    if (observations.length) {
      lines.push("### Recent Observations");
      for (const o of observations) {
        const tag = o.topic_key ? ` \`${o.topic_key}\`` : "";
        lines.push(`- [${o.type}]${tag} **${o.title}**: ${String(o.content).slice(0, 300)}`);
      }
    }

    return lines.join("\n") || "No context yet.";
  }

  // ── Delete (soft) ──────────────────────────────────────────────────────────

  static delete(id: number, project_path: string): boolean {
    const result = db.prepare(`
      UPDATE observations SET deleted_at = datetime('now', 'localtime')
      WHERE id = ? AND project_path = ?
    `).run(id, project_path);
    return result.changes > 0;
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  static createSession(id: string, project_path: string, directory: string = ""): void {
    db.prepare(`
      INSERT INTO sessions (id, project_path, directory) VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, project_path, directory);
  }

  static endSession(id: string, summary: string = ""): void {
    db.prepare(`
      UPDATE sessions SET ended_at = datetime('now', 'localtime'), summary = ?
      WHERE id = ?
    `).run(summary, id);
  }

  // ── Topic key suggestion ───────────────────────────────────────────────────

  static suggestTopicKey(type: string, title: string, content: string = ""): string {
    const family = inferFamily(type, title, content);
    const source = title.trim() || content.slice(0, 80);
    const segment = source
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60)
      .replace(/^-|-$/g, "");
    const cleanSegment = segment.startsWith(`${family}-`) ? segment.slice(family.length + 1) : segment;
    return `${family}/${cleanSegment || "general"}`;
  }
}
