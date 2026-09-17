/**
 * Signing in with GitHub.
 *
 * A second door, never the only one. Every user of this product is a
 * developer with a GitHub account, and removing a password from their life is
 * worth a button — but a self-hosted install on a laptop cannot register an
 * OAuth app, so password login has to work with this switched off.
 *
 * Two rules decide everything else here.
 *
 * **It signs people in; it does not let them in.** drymem is invitation-only
 * after the first account. A GitHub identity is matched against a user who
 * already exists, and someone with no account is told to ask for an invitation
 * rather than being given one. Otherwise anybody with a GitHub account could
 * walk into any organisation whose URL they knew.
 *
 * **Only a verified email counts.** GitHub will report an address the account
 * merely *claims*; accepting that would let anyone take over a drymem account
 * by adding its address to their GitHub profile and never confirming it. The
 * primary address, verified, or nothing.
 */

import { env } from "../env.js";

const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

/** Off unless both halves are configured. */
export const githubEnabled = (): boolean =>
  Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

export const callbackUrl = (): string => `${env.PUBLIC_URL.replace(/\/$/, "")}/auth/github/callback`;

export function authorizeUrl(state: string): string {
  const query = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID!,
    redirect_uri: callbackUrl(),
    // The address is the whole point, and it is not in the default scope.
    scope: "read:user user:email",
    state,
    allow_signup: "false",
  });
  return `${AUTHORIZE}?${query}`;
}

export class GithubError extends Error {}

async function call<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "drymem",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new GithubError(`GitHub replied ${response.status}`);
  return (await response.json()) as T;
}

export interface GithubIdentity {
  email: string;
  login: string;
  name: string | null;
}

/** Trade the callback's code for the person's verified primary address. */
export async function identify(code: string): Promise<GithubIdentity> {
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new GithubError(`GitHub replied ${response.status} to the code exchange`);

  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) {
    throw new GithubError(body.error_description || "GitHub did not return an access token.");
  }

  const user = await call<{ login: string; name: string | null }>(`${API}/user`, body.access_token);
  const emails = await call<{ email: string; primary: boolean; verified: boolean }[]>(
    `${API}/user/emails`,
    body.access_token,
  );

  const primary = emails.find((e) => e.primary && e.verified);
  if (!primary) {
    throw new GithubError(
      "Your GitHub account has no verified primary email. Verify one on GitHub, then try again.",
    );
  }
  return { email: primary.email.trim().toLowerCase(), login: user.login, name: user.name };
}
