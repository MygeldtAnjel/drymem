/**
 * The two pages a person reaches from a link rather than the rail.
 *
 * `AcceptInvite` is where an invited teammate chooses a password. `ApproveDevice`
 * is where a signed-in person confirms the short code `drymem login` printed in
 * their terminal, and where a signed-out one is sent to sign in first without
 * losing the code.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Mail, TerminalSquare } from "lucide-react";

import { CatMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { auth, type InvitePublic, type Session } from "@/api";
import { go } from "@/router";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <CatMark className="size-10 text-foreground" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function AcceptInvite({
  token,
  onDone,
}: {
  token: string;
  onDone: (session: Session) => void;
}) {
  const [invite, setInvite] = useState<InvitePublic | null | "invalid">(null);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth
      .invitePublic(token)
      .then(setInvite)
      .catch(() => setInvite("invalid"));
  }, [token]);

  if (invite === null) {
    return (
      <Frame>
        <Skeleton className="h-64" />
      </Frame>
    );
  }

  if (invite === "invalid") {
    return (
      <Frame>
        <Card>
          <CardHeader>
            <CardTitle>This invitation is no longer valid</CardTitle>
            <CardDescription>
              It may have been used already, or it expired. Ask whoever invited you for a new
              link.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => go("signin")}>
              Go to sign in
            </Button>
          </CardFooter>
        </Card>
      </Frame>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await auth.accept(token, password, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <Card>
        <CardHeader>
          <CardTitle>Join {invite.org_name}</CardTitle>
          <CardDescription>
            {invite.invited_by ? `${invite.invited_by} invited ` : "You were invited as "}
            <span className="font-medium text-foreground">{invite.email}</span>
            {invite.project_key && (
              <>
                {" "}
                to the project <span className="font-mono text-xs">{invite.project_key}</span>
              </>
            )}
            . Choose a password to finish.
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional"
                  autoComplete="name"
                  autoFocus
                />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={Boolean(error)}
                  required
                />
                <FieldDescription>At least 10 characters.</FieldDescription>
                {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={busy || password.length < 10}>
              <KeyRound data-icon="inline-start" />
              {busy ? "Joining…" : "Set password and join"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </Frame>
  );
}

export function ApproveDevice({
  code,
  session,
}: {
  code: string;
  session: Session | null;
}) {
  const [value, setValue] = useState(code);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Not signed in: remember where we were headed, then come back.
  useEffect(() => {
    if (session === null) {
      try {
        sessionStorage.setItem("drymem.after", `device/${code}`);
      } catch {
        /* the code is also in the terminal; they can retype it */
      }
      go("signin");
    }
  }, [session, code]);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.approveDevice(value);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare className="size-5 text-muted-foreground" />
            {done ? "Signed in on that machine" : "Confirm your terminal"}
          </CardTitle>
          <CardDescription>
            {done
              ? "You can close this tab. drymem on that machine now has its own token, listed under Settings → API tokens."
              : `drymem login on another machine is asking to act as ${session?.email ?? "you"}. Confirm only if this code matches the one in your terminal.`}
          </CardDescription>
        </CardHeader>
        {!done && (
          <>
            <CardContent>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="code">Code from the terminal</FieldLabel>
                <Input
                  id="code"
                  value={value}
                  onChange={(e) => setValue(e.target.value.toUpperCase())}
                  className="font-mono text-lg tracking-widest"
                  autoFocus
                />
                {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
              </Field>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => go("overview")}>
                Not me
              </Button>
              <Button onClick={approve} disabled={busy || value.replace("-", "").length < 8}>
                <CheckCircle2 data-icon="inline-start" />
                {busy ? "Confirming…" : "Yes, sign that machine in"}
              </Button>
            </CardFooter>
          </>
        )}
        {done && (
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={() => go("overview")}>
              Back to drymem
            </Button>
          </CardFooter>
        )}
      </Card>
    </Frame>
  );
}

/**
 * Forgot password.
 *
 * The answer is the same whether or not the address exists, and the copy says
 * so plainly rather than promising an email we may not have sent. Telling a
 * stranger "no account here" would turn this page into a staff directory.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await auth.forgot(email.trim());
      setSent(result.detail);
      setConfigured(result.email_configured);
    } catch (err) {
      // Even a failure here must not reveal whether the address is real.
      setSent("If that address has an account, a reset link is on its way.");
      void err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            {sent
              ? sent
              : "Type the address you sign in with and we will send you a link to choose a new password."}
          </CardDescription>
        </CardHeader>
        {sent ? (
          <>
            {!configured && (
              <CardContent>
                <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
                  This server has no email provider configured, so the link was written to its
                  log instead. Whoever runs it can read it out to you.
                </p>
              </CardContent>
            )}
            <CardFooter className="justify-end">
              <Button variant="outline" onClick={() => go("signin")}>
                Back to sign in
              </Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <CardContent>
              <Field>
                <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </Field>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="ghost" onClick={() => go("signin")}>
                Back
              </Button>
              <Button type="submit" disabled={busy || !email.trim()}>
                <Mail data-icon="inline-start" />
                {busy ? "Sending…" : "Send the link"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </Frame>
  );
}

/** Choose a new password from a reset link. */
export function ResetPassword({
  token,
  onDone,
}: {
  token: string;
  onDone: (session: Session) => void;
}) {
  const [email, setEmail] = useState<string | null | "invalid">(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth
      .resetInfo(token)
      .then((r) => setEmail(r.email))
      .catch(() => setEmail("invalid"));
  }, [token]);

  if (email === null) {
    return (
      <Frame>
        <Skeleton className="h-56" />
      </Frame>
    );
  }

  if (email === "invalid") {
    return (
      <Frame>
        <Card>
          <CardHeader>
            <CardTitle>This link is no longer valid</CardTitle>
            <CardDescription>
              Reset links work once and expire after an hour. Ask for a new one.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={() => go("forgot")}>
              Send a new link
            </Button>
          </CardFooter>
        </Card>
      </Frame>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await auth.reset(token, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            For <span className="font-medium text-foreground">{email}</span>. Everywhere else you
            are signed in will be signed out.
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(error)}
                autoFocus
                required
              />
              <FieldDescription>At least 10 characters.</FieldDescription>
              {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={busy || password.length < 10}>
              <KeyRound data-icon="inline-start" />
              {busy ? "Saving…" : "Set password and sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </Frame>
  );
}
