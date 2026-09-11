/**
 * The one path to the server. Same origin — FastAPI serves this bundle — so
 * there is no CORS, no base URL, and nothing to configure but the token.
 */

const TOKEN_KEY = "drymem.token";

export interface Project {
  id: string;
  project_key: string;
  display_name: string | null;
  memory_count: number;
  positive: number;
  negative: number;
}

export interface Episode {
  uuid: string;
  name: string;
  content: string;
  created_at: string | null;
  author: string | null;
  scope: string;
  title: string;
  type: string;
  session_id: string;
  topic_key: string;
  promoted_at: string | null;
  rating: number | null;
}

export interface Session {
  session_id: string;
  author: string;
  memory_count: number;
  shared: number;
  started_at: string;
  ended_at: string;
  titles: string[];
  synthetic: boolean;
}

export interface Person {
  id: string;
  email: string;
  name: string | null;
  memory_count: number;
  project_count: number;
  created_at: string | null;
}

export interface Member {
  user_id: string;
  email: string;
  role: string;
}

export interface Skill {
  id: string;
  name: string;
  topic: string;
  content: string;
  author: string;
  model: string | null;
  memory_count: number;
  updated_at: string | null;
}

export interface Cluster {
  topic: string;
  memory_count: number;
  facts: string[];
}

export interface Fact {
  name: string;
  fact: string;
  created_at: string | null;
  superseded: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing: the session simply will not persist */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the status text */
    }
    if (response.status === 401) {
      throw new ApiError("That token was not accepted.", 401);
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () =>
    request<{ status: string; postgres: boolean; neo4j: boolean; extractor: string }>(
      "/healthz",
    ),

  projects: async (): Promise<Project[]> => {
    const data = await request<{ projects: Partial<Project>[] }>("/v1/projects");
    return data.projects.map((p) => ({
      id: p.id ?? "",
      project_key: p.project_key ?? "",
      display_name: p.display_name ?? null,
      memory_count: p.memory_count ?? 0,
      positive: p.positive ?? 0,
      negative: p.negative ?? 0,
    }));
  },

  context: async (projectKey: string, limit = 100): Promise<Episode[]> => {
    const q = new URLSearchParams({ project_key: projectKey, limit: String(limit) });
    return (await request<{ episodes: Episode[] }>(`/v1/memories/context?${q}`)).episodes;
  },

  search: async (projectKey: string, query: string, limit = 25): Promise<Fact[]> => {
    const q = new URLSearchParams({ project_key: projectKey, q: query, limit: String(limit) });
    return (await request<{ results: Fact[] }>(`/v1/memories/search?${q}`)).results;
  },

  rate: (uuid: string, rating: 1 | -1, query: string) =>
    request(`/v1/memories/${uuid}/feedback`, {
      method: "POST",
      body: JSON.stringify({ rating, query }),
    }),

  promote: (uuid: string) =>
    request<{ scope: string }>(`/v1/memories/${uuid}/promote`, { method: "POST" }),

  remove: (uuid: string) => request(`/v1/memories/${uuid}`, { method: "DELETE" }),

  sessions: async (projectKey: string): Promise<Session[]> => {
    const q = new URLSearchParams({ project_key: projectKey });
    return (await request<{ sessions: Session[] }>(`/v1/sessions?${q}`)).sessions;
  },

  people: async (): Promise<Person[]> => (await request<{ users: Person[] }>("/v1/users")).users,

  members: async (projectKey: string): Promise<Member[]> => {
    const data = await request<{ members: Member[] }>(
      `/v1/projects/${projectKey}/members`,
    );
    return data.members;
  },

  addMember: async (projectKey: string, email: string): Promise<Member[]> => {
    const data = await request<{ members: Member[] }>(`/v1/projects/${projectKey}/members`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    return data.members;
  },

  skills: async (projectKey: string): Promise<Skill[]> => {
    const q = new URLSearchParams({ project_key: projectKey });
    return (await request<{ skills: Skill[] }>(`/v1/skills?${q}`)).skills;
  },

  publishSkill: (body: {
    project_key: string;
    name: string;
    topic: string;
    content: string;
    model?: string | null;
    memory_count?: number;
  }) => request<Skill>("/v1/skills", { method: "POST", body: JSON.stringify(body) }),

  removeSkill: (projectKey: string, name: string) => {
    const q = new URLSearchParams({ project_key: projectKey });
    return request(`/v1/skills/${encodeURIComponent(name)}?${q}`, { method: "DELETE" });
  },

  /** Subjects the project's memories keep returning to. */
  discover: async (projectKey: string, minMemories = 2): Promise<Cluster[]> => {
    const q = new URLSearchParams({
      project_key: projectKey,
      min_memories: String(minMemories),
    });
    return (await request<{ clusters: Cluster[] }>(`/v1/skills/discover?${q}`)).clusters;
  },

  /** Draft a SKILL.md from the memories about a subject. Always a draft. */
  distill: (projectKey: string, topic: string) =>
    request<{ topic: string; name: string; content: string; model: string; memory_count: number }>(
      "/v1/skills/distill",
      { method: "POST", body: JSON.stringify({ project_key: projectKey, topic }) },
    ),
};
