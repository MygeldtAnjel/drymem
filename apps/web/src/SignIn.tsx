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

import { CatMark, GithubMark } from "@/components/Logo";
import { flashError } from "@/flash";
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
  /*
   * A failed GitHub callback redirects here with the reason in the URL, read at
   * import because the router clears the query before anything mounts.
   *
   * Kept apart from `error`, which belongs to the form: putting "no drymem
   * account for you@example.com" under the password field turns a GitHub
   * problem into what looks like a wrong password.
   */
  const [banner, setBanner] = useState<string | null>(flashError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth
      .bootstrap()
      .then(setState)
      .catch(() =>
        setState({
          needs_setup: false,
          org_name: null,
          smtp_enabled: false,
          github_enabled: false,
        }),
      );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBanner(null);
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
            {banner && (
              <p
                role="alert"
                className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
              >
                {banner}
              </p>
            )}
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
                className="text-muted-foreground hover:text-foreground self-center text-sm underline-offset-4 hover:underline"
                onClick={() => go("forgot")}
              >
                Forgotten your password?
              </button>
            )}

            {/* A second door, never the only one. Absent entirely unless
                the server has an OAuth app — a laptop install cannot register
                one, and an inert button is worse than no button. */}
            {!creating && state?.github_enabled && (
              <>
                <div className="flex items-center gap-3">
                  <span className="bg-border h-px flex-1" />
                  <span className="text-muted-foreground text-xs">or</span>
                  <span className="bg-border h-px flex-1" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/auth/github";
                  }}
                >
                  <GithubMark /> Continue with GitHub
                </Button>
              </>
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
