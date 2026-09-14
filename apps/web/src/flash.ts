/**
 * A message handed over in the URL, read exactly once.
 *
 * GitHub sign-in fails by redirecting back with `?error=…` in the hash — there
 * is no promise to catch on a browser redirect, so the sentence has to travel
 * in the address bar.
 *
 * Read at module load rather than in an effect. The hash is the router's
 * territory and it normalises what it finds there, so by the time a component
 * mounts the query is already gone. Taking it synchronously, before anything
 * else imports, is the only point at which it is reliably still there — and
 * clearing it immediately means a refresh does not re-show an old failure.
 */

function take(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const at = hash.indexOf("?");
  if (at === -1) return null;

  const message = new URLSearchParams(hash.slice(at + 1)).get("error");
  if (!message) return null;

  history.replaceState(null, "", hash.slice(0, at) || "#/");
  return message.slice(0, 300);
}

export const flashError: string | null = take();
