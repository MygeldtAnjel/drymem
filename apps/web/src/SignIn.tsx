/**
 * The front door: sign in, or — on a server nobody has used yet — create the
 * organisation and become its owner.
 *
 * Which of the two it shows is the server's decision (`/auth/bootstrap`), not
 * the visitor's: once anyone exists, the only way in is an invitation, and the
 * page says so instead of offering a sign-up that would be refused.
 */

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { CatMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { auth, type Bootstrap, type Session } from "@/api";
import { go } from "@/router";

export function SignIn({ onDone }: { onDone: (session: Session) => void }) {
  const [state, setState] = useState<Bootstrap | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth
      .bootstrap()
      .then(setState)
      .catch(() => setState({ needs_setup: false, org_name: null, smtp_enabled: false }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = state?.needs_setup
        ? await auth.signup({ org_name: orgName, email, password, name })
        : await auth.login(email, password);
      onDone(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const creating = state?.needs_setup === true;

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <CatMark className="size-12 text-foreground" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {creating ? "Set up drymem" : state?.org_name || "drymem"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {creating
                ? "Nobody has used this server yet. Create your organisation — you will be its owner."
                : "What your team has learned, in one place."}
            </p>
          </div>
        </div>

        {state === null ? (
          <Skeleton className="h-40" />
        ) : (
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <FieldGroup>
              {creating && (
                <Field>
                  <FieldLabel htmlFor="org">Organisation</FieldLabel>
                  <Input
                    id="org"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Acme"
                    autoFocus
                    required
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="username"
                  autoFocus={!creating}
                  required
                />
              </Field>
              {creating && (
                <Field>
                  <FieldLabel htmlFor="name">Your name</FieldLabel>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Optional"
                    autoComplete="name"
                  />
                </Field>
              )}
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={creating ? "new-password" : "current-password"}
                  aria-invalid={Boolean(error)}
                  required
                />
                {creating && <FieldDescription>At least 10 characters.</FieldDescription>}
                {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
              </Field>
            </FieldGroup>

            <Button type="submit" disabled={busy || !email || !password || (creating && !orgName)}>
              {busy ? "One moment…" : creating ? "Create organisation" : "Sign in"}
              {!busy && <ArrowRight data-icon="inline-end" />}
            </Button>

            {!creating && (
              <button
                type="button"
                className="self-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => go("forgot")}
              >
                Forgotten your password?
              </button>
            )}
          </form>
        )}

        {state && !creating && (
          <p className="mt-8 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">No account yet?</span> Ask an admin of{" "}
            {state.org_name ?? "your organisation"} to invite you — they send you a link and you
            choose a password. There is no self-service sign-up on purpose.
          </p>
        )}
      </div>
    </div>
  );
}
