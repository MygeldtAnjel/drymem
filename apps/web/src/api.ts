/**
 * The one path to the server. Same origin — FastAPI serves this bundle — so
 * there is no CORS, no base URL, and nothing to configure but the token.
 */

const PROJECT_KEY = "drymem.project";

/** Marks a request as ours. With SameSite=Lax this is what stops a cross-site
 * form from posting into the API with the visitor's cookie. */
const CLIENT_HEADER = { "X-Drymem-Client": "web" };

/** The last project you were looking at. A convenience, never a source of truth. */
export function rememberedProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

export function rememberProject(key: string): void {
  try {
    localStorage.setItem(PROJECT_KEY, key);
  } catch {
    /* private browsing: the choice simply will not persist */
  }
}

export interface Project {
  id: string;
  project_key: string;
  display_name: string | null;
  capture_mode: string;
  your_role: string;
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

export interface AgentSession {
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

export interface Finding {
  rule: string;
  severity: "reject" | "review";
  detail: string;
  line?: number;
}

/** A catalogue entry: what the organisation has, whatever its source. */
export interface CatalogueSkill {
  id: string;
  name: string;
  topic: string;
  description: string | null;
  author: string | null;
  scope: string;
  source: string;
  state: string;
  origin: string | null;
  latest_version: number;
  uses: number;
  enabled_here: boolean;
  updated_at: string | null;
}

/** One the project has turned on, pinned to a version. */
export interface Skill extends CatalogueSkill {
  content: string;
  files: Record<string, string>;
  model: string | null;
  memory_count: number;
  version: number;
  sha256: string;
  outdated: boolean;
  findings: Finding[];
}

export interface SkillVersion {
  version: number;
  sha256: string;
  content: string;
  model: string | null;
  memory_count: number;
  findings: Finding[];
  note: string | null;
  author: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  email: string;
  name: string | null;
  role: string;
  org_id: string;
  org_name: string;
}

export interface Bootstrap {
  needs_setup: boolean;
  org_name: string | null;
  smtp_enabled: boolean;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  project_key: string | null;
  invited_by: string | null;
  expires_at: string;
  invite_url?: string | null;
  /** Whether the server actually managed to email it. Never assumed. */
  emailed?: boolean;
  email_error?: string | null;
}

export interface InvitePublic {
  email: string;
  org_name: string;
  project_key: string | null;
  invited_by: string | null;
}

export interface WebSession {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  current: boolean;
}

export interface ApiToken {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  token?: string | null;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  org_id: string;
  created_at: string | null;
}

export interface Overview {
  project_key: string;
  memories: number;
  shared: number;
  sessions: number;
  members: number;
  skills: number;
  positive: number;
  negative: number;
  by_type: Record<string, number>;
}

export interface Health {
  status: string;
  postgres: boolean;
  neo4j: boolean;
  extractor: string;
}

export interface MemorySchema {
  types: Array<{ name: string; description: string }>;
  sections: string[];
  template: string;
}

export interface GraphNode {
  id: string;
  kind: "memory" | "entity";
  label: string;
  type: string;
  author: string;
  scope: string;
  created_at: string | null;
  mentions: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "mentions" | "fact";
  label: string;
  superseded: boolean;
}

export interface Graph {
  project_key: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  total_memories: number;
}

export interface AskSource {
  index: number;
  uuid: string;
  title: string;
  author: string;
  created_at: string | null;
  type: string;
  scope: string;
}

export interface AskResult {
  question: string;
  answer: string;
  model: string;
  sources: AskSource[];
  grounded: boolean;
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


async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...CLIENT_HEADER,
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
      throw new ApiError("Your session has ended. Sign in again.", 401);
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const auth = {
  bootstrap: () => request<Bootstrap>("/auth/bootstrap"),
  session: () => request<Session>("/auth/session"),
  signup: (body: { org_name: string; email: string; password: string; name: string }) =>
    request<Session>("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  login: (email: string, password: string) =>
    request<Session>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  forgot: (email: string) =>
    request<{ detail: string; email_configured: boolean }>("/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetInfo: (token: string) => request<{ email: string }>(`/auth/reset/${token}`),
  reset: (token: string, password: string) =>
    request<Session>(`/auth/reset/${token}`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  changePassword: (current: string, next: string) =>
    request<void>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ current, new: next }),
    }),

  invite: (body: { email: string; role: string; project_key?: string | null }) =>
    request<Invite>("/auth/invites", { method: "POST", body: JSON.stringify(body) }),
  invites: () => request<Invite[]>("/auth/invites"),
  revokeInvite: (id: string) => request<void>(`/auth/invites/${id}`, { method: "DELETE" }),
  invitePublic: (token: string) => request<InvitePublic>(`/auth/invites/${token}/public`),
  accept: (token: string, password: string, name: string) =>
    request<Session>(`/auth/invites/${token}/accept`, {
      method: "POST",
      body: JSON.stringify({ password, name }),
    }),

  sessions: () => request<WebSession[]>("/auth/sessions"),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
  tokens: () => request<ApiToken[]>("/auth/tokens"),
  createToken: (label: string) =>
    request<ApiToken>("/auth/tokens", { method: "POST", body: JSON.stringify({ label }) }),
  revokeToken: (id: string) => request<void>(`/auth/tokens/${id}`, { method: "DELETE" }),

  approveDevice: (userCode: string) =>
    request<void>("/auth/device/approve", {
      method: "POST",
      body: JSON.stringify({ user_code: userCode }),
    }),
};

export const api = {
  health: () => request<Health>("/healthz"),

  me: () => request<Me>("/v1/me"),

  renameMe: (name: string) =>
    request<Me>("/v1/me", { method: "PATCH", body: JSON.stringify({ name }) }),

  schema: () => request<MemorySchema>("/v1/memories/schema"),

  overview: (projectKey: string) => {
    const q = new URLSearchParams({ project_key: projectKey });
    return request<Overview>(`/v1/overview?${q}`);
  },

  projects: async (): Promise<Project[]> => {
    const data = await request<{ projects: Partial<Project>[] }>("/v1/projects");
    return data.projects.map((p) => ({
      id: p.id ?? "",
      project_key: p.project_key ?? "",
      display_name: p.display_name ?? null,
      capture_mode: p.capture_mode ?? "automatic",
      your_role: p.your_role ?? "member",
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

  sessions: async (projectKey: string): Promise<AgentSession[]> => {
    const q = new URLSearchParams({ project_key: projectKey });
    return (await request<{ sessions: AgentSession[] }>(`/v1/sessions?${q}`)).sessions;
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

  renameProject: (projectKey: string, displayName: string) =>
    request<Project>(`/v1/projects/${projectKey}`, {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName }),
    }),

  setCaptureMode: (projectKey: string, mode: string) =>
    request<Project>(`/v1/projects/${projectKey}`, {
      method: "PATCH",
      body: JSON.stringify({ capture_mode: mode }),
    }),

  setMemberRole: async (projectKey: string, email: string, role: string): Promise<Member[]> => {
    const data = await request<{ members: Member[] }>(
      `/v1/projects/${projectKey}/members/${encodeURIComponent(email)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
    return data.members;
  },

  removeMember: async (projectKey: string, email: string): Promise<Member[]> => {
    const data = await request<{ members: Member[] }>(
      `/v1/projects/${projectKey}/members/${encodeURIComponent(email)}`,
      { method: "DELETE" },
    );
    return data.members;
  },

  skills: async (projectKey: string): Promise<Skill[]> => {
    const q = new URLSearchParams({ project_key: projectKey });
    return (await request<{ skills: Skill[] }>(`/v1/skills?${q}`)).skills;
  },

  catalogue: async (projectKey: string): Promise<CatalogueSkill[]> => {
    const q = new URLSearchParams({ project_key: projectKey });
    return (await request<{ skills: CatalogueSkill[] }>(`/v1/skills/catalogue?${q}`)).skills;
  },

  skillVersions: async (name: string): Promise<SkillVersion[]> => {
    const data = await request<{ versions: SkillVersion[] }>(
      `/v1/skills/${encodeURIComponent(name)}/versions`,
    );
    return data.versions;
  },

  publishSkill: (body: {
    name: string;
    topic?: string;
    description?: string;
    content: string;
    model?: string | null;
    memory_count?: number;
    source?: string;
    project_key?: string;
  }) =>
    request<{
      name: string;
      version: number;
      state: string;
      findings: Finding[];
      detail?: string;
      unchanged?: boolean;
    }>("/v1/skills", { method: "POST", body: JSON.stringify(body) }),

  enableSkill: (name: string, projectKey: string, version?: number) =>
    request<{ name: string; version: number }>(
      `/v1/skills/${encodeURIComponent(name)}/enable`,
      { method: "POST", body: JSON.stringify({ project_key: projectKey, version }) },
    ),

  disableSkill: (name: string, projectKey: string) => {
    const q = new URLSearchParams({ project_key: projectKey });
    return request(`/v1/skills/${encodeURIComponent(name)}/enable?${q}`, { method: "DELETE" });
  },

  approveSkill: (name: string) =>
    request<{ name: string; state: string }>(
      `/v1/skills/${encodeURIComponent(name)}/approve`,
      { method: "POST", body: "{}" },
    ),

  deprecateSkill: (name: string) =>
    request<{ name: string; state: string; still_enabled_in: number }>(
      `/v1/skills/${encodeURIComponent(name)}/deprecate`,
      { method: "POST", body: "{}" },
    ),

  graph: (
    projectKey: string,
    opts: { limit?: number; kinds?: string[]; author?: string; minMentions?: number } = {},
  ) => {
    const q = new URLSearchParams({ project_key: projectKey });
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.author) q.set("author", opts.author);
    if (opts.minMentions) q.set("min_mentions", String(opts.minMentions));
    for (const kind of opts.kinds ?? []) q.append("kind", kind);
    return request<Graph>(`/v1/graph?${q}`);
  },

  /** A grounded answer, or an honest "nothing here mentions that". */
  ask: (projectKey: string, question: string) =>
    request<AskResult>("/v1/ask", {
      method: "POST",
      body: JSON.stringify({ project_key: projectKey, question }),
    }),

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
