/**
 * Where the server URL and token live: ~/.drymem/config.json, mode 0600.
 *
 * A token in a repo-local file gets committed eventually, so it goes in the
 * home directory. Env vars override the file, which is what CI and the hooks use.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Config {
  serverUrl: string;
  token: string;
}

export const CONFIG_PATH = join(homedir(), ".drymem", "config.json");
export const DEFAULT_SERVER = "http://localhost:8080";

export function loadConfig(): Config | null {
  const fromEnv = {
    serverUrl: process.env.DRYMEM_SERVER_URL,
    token: process.env.DRYMEM_TOKEN,
  };
  if (fromEnv.serverUrl && fromEnv.token) {
    return { serverUrl: fromEnv.serverUrl, token: fromEnv.token };
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
    const serverUrl = fromEnv.serverUrl ?? raw.serverUrl;
    const token = fromEnv.token ?? raw.token;
    if (!serverUrl || !token) return null;
    return { serverUrl, token };
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  // Written mode only applies on create; enforce it for an existing file too.
  chmodSync(CONFIG_PATH, 0o600);
}

export function requireConfig(): Config {
  const config = loadConfig();
  if (!config) {
    throw new Error(
      "drymem is not configured. Run `npx drymem setup`, or set DRYMEM_SERVER_URL and DRYMEM_TOKEN.",
    );
  }
  return config;
}
