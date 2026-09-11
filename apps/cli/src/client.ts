/**
 * HTTP client for the drymem server.
 *
 * The whole client is this file plus identity: no Graphiti, no Neo4j, no
 * Python. That is what makes `npx drymem` an install rather than a project.
 */

import type { Config } from "./config.js";

export interface SaveResult {
  id: string;
  episode_uuid: string;
  name: string;
  project_key: string;
  author: string;
  entity_count: number;
  relationship_count: number;
  scrubbed: string;
  degraded: string | null;
}

export interface Fact {
  name: string;
  fact: string;
  created_at: string | null;
  superseded: boolean;
}

export interface EpisodeOut {
  uuid: string;
  name: string;
  content: string;
  created_at: string | null;
  author: string | null;
  scope: string;
}

export interface ProjectOut {
  id: string;
  project_key: string;
  display_name: string | null;
  memory_count: number;
  positive: number;
  negative: number;
}

export class DrymemError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DrymemError";
  }
}

export class DrymemClient {
  private readonly base: string;

  constructor(private readonly config: Config) {
    this.base = config.serverUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (cause) {
      // A connection error is the common case for a self-hosted server, so name
      // the address rather than leaving "fetch failed".
      throw new DrymemError(`Cannot reach the drymem server at ${this.base}: ${cause}`, 0);
    }

    if (!response.ok) {
      throw new DrymemError(await describe(response), response.status);
    }
    return (await response.json()) as T;
  }

  private query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    return search.toString();
  }

  save(body: {
    project_key: string;
    summary: string;
    topic_key?: string;
    tool?: string;
  }): Promise<SaveResult> {
    return this.request<SaveResult>("/v1/memories", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  update(
    topicKey: string,
    body: { project_key: string; update_summary: string; replace?: boolean; tool?: string },
  ): Promise<SaveResult> {
    return this.request<SaveResult>(`/v1/memories/${topicKey}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async search(projectKey: string, q: string, limit = 10): Promise<Fact[]> {
    const data = await this.request<{ results: Fact[] }>(
      `/v1/memories/search?${this.query({ project_key: projectKey, q, limit })}`,
    );
    return data.results;
  }

  async context(projectKey: string, limit = 10): Promise<EpisodeOut[]> {
    const data = await this.request<{ episodes: EpisodeOut[] }>(
      `/v1/memories/context?${this.query({ project_key: projectKey, limit })}`,
    );
    return data.episodes;
  }

  /** Topic keys already stored — what makes `drymem import` idempotent. */
  async topicKeys(projectKey: string): Promise<string[]> {
    const data = await this.request<{ topic_keys: string[] }>(
      `/v1/memories/topics?${this.query({ project_key: projectKey })}`,
    );
    return data.topic_keys;
  }

  async delete(episodeUuid: string): Promise<boolean> {
    const data = await this.request<{ deleted: boolean }>(`/v1/memories/${episodeUuid}`, {
      method: "DELETE",
    });
    return data.deleted;
  }

  /** Share a memory with the project's members. A copy — the original stays private. */
  async promote(episodeUuid: string): Promise<{ scope: string }> {
    return this.request<{ scope: string }>(`/v1/memories/${episodeUuid}/promote`, {
      method: "POST",
    });
  }

  /** Record whether a retrieved memory was useful. `query` is what surfaced it. */
  async rate(episodeUuid: string, rating: 1 | -1, query = ""): Promise<void> {
    await this.request(`/v1/memories/${episodeUuid}/feedback`, {
      method: "POST",
      body: JSON.stringify({ rating, query }),
    });
  }

  async projects(): Promise<ProjectOut[]> {
    const data = await this.request<{ projects: Partial<ProjectOut>[] }>("/v1/projects");
    // Normalise at the boundary: a server older than this client omits fields,
    // and an absent number quietly becomes NaN everywhere downstream.
    return data.projects.map((p) => ({
      id: p.id ?? "",
      project_key: p.project_key ?? "",
      display_name: p.display_name ?? null,
      memory_count: p.memory_count ?? 0,
      positive: p.positive ?? 0,
      negative: p.negative ?? 0,
    }));
  }

  async health(): Promise<{ status: string; postgres: boolean; neo4j: boolean }> {
    const response = await fetch(`${this.base}/healthz`);
    if (!response.ok) throw new DrymemError(`Health check failed`, response.status);
    return (await response.json()) as { status: string; postgres: boolean; neo4j: boolean };
  }
}

async function describe(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { detail?: unknown };
    detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? "");
  } catch {
    detail = response.statusText;
  }

  if (response.status === 401) {
    return "Not authorised. Your token is missing, revoked, or wrong — run `npx drymem setup`.";
  }
  if (response.status === 404) return detail || "Not found.";
  if (response.status === 422 && detail.startsWith("[")) {
    // FastAPI returns a list of field errors; the raw JSON is unreadable.
    try {
      const problems = JSON.parse(detail) as Array<{ loc?: unknown[]; msg?: string }>;
      return problems
        .map((p) => `${(p.loc ?? []).slice(1).join(".") || "request"}: ${p.msg ?? "invalid"}`)
        .join("; ");
    } catch {
      /* fall through to the raw detail */
    }
  }
  return detail || `Request failed with ${response.status}`;
}
