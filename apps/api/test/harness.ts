/**
 * A whole server, on a database that did not exist a second ago.
 *
 * Each file gets its own scratch Postgres, migrated by Alembic — the single
 * schema authority — so the tests run against the real schema rather than a
 * hand-maintained copy of it that would drift within a week.
 *
 * Nothing here talks to the memory engine: everything the control plane owns is
 * reachable without it, and the one route that is not (`/v1/…` forwarding) is
 * tested by asserting the failure it gives when the engine is absent.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

import postgres from "postgres";
import { vi } from "vitest";

const run = promisify(execFile);

const ADMIN_URL = "postgres://drymem:drymem_pass@localhost:5432/postgres";
const SERVER_DIR = new URL("../../server", import.meta.url).pathname;

export interface Scratch {
  url: string;
  drop: () => Promise<void>;
}

export async function scratchDatabase(): Promise<Scratch> {
  const name = `drymem_api_${randomBytes(5).toString("hex")}`;
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = `postgres://drymem:drymem_pass@localhost:5432/${name}`;
  await run(`${SERVER_DIR}/.venv/bin/alembic`, ["upgrade", "head"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: `postgresql+asyncpg://drymem:drymem_pass@localhost:5432/${name}`,
    },
  });

  return {
    url,
    drop: async () => {
      const cleanup = postgres(ADMIN_URL, { max: 1 });
      await cleanup.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
      );
      await cleanup.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await cleanup.end();
    },
  };
}

/**
 * A client that keeps cookies, because that is what a browser does and the
 * session is the thing under test.
 */
export class Client {
  private cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { web?: boolean; bearer?: string } = {},
  ): Promise<{ status: number; body: any }> {
    const web = opts.web ?? true;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (web) headers["X-Drymem-Client"] = "web";
    if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
    const cookie = this.cookieHeader;
    if (cookie && !opts.bearer) headers["Cookie"] = cookie;

    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const at = pair!.indexOf("=");
      const key = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      if (value === "") this.cookies.delete(key);
      else this.cookies.set(key, value);
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as any };
  }

  get = (p: string, o?: { web?: boolean; bearer?: string }) =>
    this.request("GET", p, undefined, o);
  post = (p: string, b?: unknown, o?: { web?: boolean; bearer?: string }) =>
    this.request("POST", p, b, o);
  patch = (p: string, b?: unknown, o?: { web?: boolean; bearer?: string }) =>
    this.request("PATCH", p, b, o);
  del = (p: string, o?: { web?: boolean; bearer?: string }) =>
    this.request("DELETE", p, undefined, o);
}

export interface Harness {
  client: Client;
  base: string;
  stop: () => Promise<void>;
  /** The reset and invite links the server printed, newest last. */
  logged: string[];
}

export async function startServer(databaseUrl: string): Promise<Harness> {
  // The app reads its configuration once, at import. Each scratch server needs
  // its own, so the module registry is reset between them.
  process.env.DATABASE_URL = databaseUrl;
  process.env.SERVICE_SECRET = "test-secret-at-least-sixteen";
  process.env.PORT = "0";
  process.env.BIND = "127.0.0.1";
  process.env.PUBLIC_URL = "http://127.0.0.1";
  process.env.MEMORY_URL = "http://127.0.0.1:9";
  delete process.env.RESEND_API_KEY;
  delete process.env.WEB_DIR;

  // The app reads env and opens its pool at import, so each scratch server
  // needs a fresh module graph.
  vi.resetModules();
  const { createApp } = await import("../src/index.js");

  const logged: string[] = [];
  const info = console.info;
  console.info = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  return {
    client: new Client(base),
    base,
    logged,
    stop: async () => {
      console.info = info;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
