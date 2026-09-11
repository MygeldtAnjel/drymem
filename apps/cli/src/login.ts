/**
 * `drymem login` — the browser hand-off.
 *
 * The CLI asks the server for a device code, opens the sign-in page with the
 * short user code in the URL, and polls until the person approves it there.
 * The token the CLI receives is scoped to this machine and labelled with its
 * hostname, so it shows up by name under Settings → API tokens and can be
 * revoked on its own. Nobody types a token.
 */

import { exec } from "node:child_process";
import { hostname } from "node:os";

import { DrymemError } from "./client.js";
import { DEFAULT_SERVER, loadConfig, saveConfig, type Config } from "./config.js";

interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

interface DevicePoll {
  status: "pending" | "approved" | "collected" | "expired" | string;
  token: string | null;
}

async function post<T>(base: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? detail;
    } catch {
      /* keep the status text */
    }
    throw new DrymemError(detail, response.status);
  }
  return (await response.json()) as T;
}

/** Best effort. A terminal over SSH has no browser; the URL is printed regardless. */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLogin(options: { serverUrl?: string } = {}): Promise<number> {
  const current = loadConfig();
  const serverUrl = (options.serverUrl ?? current?.serverUrl ?? DEFAULT_SERVER).replace(
    /\/+$/,
    "",
  );

  let start: DeviceStart;
  try {
    start = await post<DeviceStart>(serverUrl, "/auth/device", {
      label: `drymem login @ ${hostname()}`,
    });
  } catch (error) {
    console.error(`Cannot reach ${serverUrl}: ${error instanceof Error ? error.message : error}`);
    console.error("Is the server running? Pass the URL with --server if it is somewhere else.");
    return 1;
  }

  console.log(`\nOpen this page and confirm the code:\n`);
  console.log(`  ${start.verification_url}`);
  console.log(`\n  code: ${start.user_code}\n`);
  openBrowser(start.verification_url);

  const deadline = Date.now() + start.expires_in * 1000;
  const interval = Math.max(2, start.interval) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await post<DevicePoll>(serverUrl, "/auth/device/token", {
      device_code: start.device_code,
    });
    if (poll.status === "approved" && poll.token) {
      const config: Config = { serverUrl, token: poll.token };
      saveConfig(config);
      console.log("Signed in. Token stored in ~/.drymem/config.json (0600).");
      return 0;
    }
    if (poll.status === "expired" || poll.status === "denied") {
      console.error("That code expired before it was confirmed. Run `drymem login` again.");
      return 1;
    }
  }
  console.error("Timed out waiting for the browser. Run `drymem login` again.");
  return 1;
}
