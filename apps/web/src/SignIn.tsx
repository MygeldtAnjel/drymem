/**
 * The front door.
 *
 * There is no signup, no password and no email here — just the token the CLI
 * already uses. So this page's real job is to say where that token comes from,
 * because someone who does not know is stuck with nowhere to look.
 *
 * The token is verified before it is stored: a bad token kept in the session
 * fails later, deeper in the app, where the cause is much harder to see.
 */

import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { CatMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, setToken } from "@/api";

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
      await api.me();
      onDone();
    } catch (err) {
      setToken(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <CatMark className="size-12 text-foreground" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">drymem</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              What your team has learned, in one place.
            </p>
          </div>
        </div>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="token">Access token</FieldLabel>
            <Input
              id="token"
              value={token}
              onChange={(e) => setValue(e.target.value)}
              placeholder="drymem_…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              autoFocus
              className="font-mono"
            />
            {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
          </Field>

          <Button type="submit" disabled={checking || !token.trim()}>
            {checking ? "Checking…" : "Sign in"}
            {!checking && <ArrowRight data-icon="inline-end" />}
          </Button>
        </form>

        <div className="mt-8 flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Already set up the CLI?</span> Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">drymem token</code> —
            it prints the one this machine is using.
          </p>
          <p>
            <span className="font-medium text-foreground">Nothing set up yet?</span> Whoever runs
            the server issues you one with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              drymem-admin token-create &lt;your-email&gt;
            </code>
            . It is shown once.
          </p>
        </div>
      </div>
    </div>
  );
}
