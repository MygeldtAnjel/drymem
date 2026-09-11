/**
 * The frontispiece.
 *
 * There is no signup, no password, no email — just the token the CLI already
 * uses. So this page's only real job is to say where that token comes from,
 * because a developer who does not know is stuck with nowhere to look.
 *
 * The token is verified before it is stored: a stored token that does not work
 * fails later, inside the app, where the cause is much harder to see.
 */

import { useState } from "react";

import { api, setToken } from "./api";

export function SignIn({ onDone }: { onDone: () => void }) {
  const [token, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setChecking(true);
    setError(null);
    setToken(trimmed);
    try {
      await api.projects();
      onDone();
    } catch (err) {
      setToken(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="front">
      <div className="front__plate">
        <h1 className="front__word">drymem</h1>
        <p className="front__rule" aria-hidden />
        <p className="front__sub">
          What this team has learned, and whether it still stands.
        </p>

        <form className="front__form" onSubmit={submit}>
          <label className="legend" htmlFor="token">
            Access token
          </label>
          <input
            id="token"
            value={token}
            onChange={(e) => setValue(e.target.value)}
            placeholder="drymem_…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button className="btn btn--gilt" type="submit" disabled={checking || !token.trim()}>
            {checking ? "Checking…" : "Open the volume"}
          </button>
          {error && <p className="front__error">{error}</p>}
        </form>

        <p className="front__help">
          Don’t have one? Whoever runs the server issues it with
          <code> drymem-admin token-create &lt;your-email&gt;</code>. It is shown once.
        </p>
      </div>
    </main>
  );
}
