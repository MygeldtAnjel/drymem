/**
 * Settings: your profile, this project, how memories should be written, and
 * where the data lives.
 *
 * Everything here is real and editable except the things that genuinely are
 * not — the server address, the extractor, the project key. Those are shown
 * because "why can I not change this?" is a better question to answer once, in
 * place, than to leave someone hunting for a control that does not exist.
 */

import { useEffect, useState } from "react";
import { Copy, KeyRound, LogOut, Plus, Save, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { TypeChip } from "@/components/Bits";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  auth,
  type ApiToken,
  type Health,
  type Me,
  type MemorySchema,
  type Project,
  type Session,
  type WebSession,
} from "@/api";
import { MEMORY_TYPES } from "@/memory";
import { relative, when } from "@/format";

export function SettingsPage({
  me,
  session,
  health,
  schema,
  project,
  busy,
  onRenameMe,
  onRenameProject,
  onCaptureMode,
  onSignOut,
  onCopy,
}: {
  me: Me | null;
  session: Session;
  health: Health | null;
  schema: MemorySchema | null;
  project?: Project;
  busy: boolean;
  onRenameMe: (name: string) => void;
  onRenameProject: (key: string, name: string) => void;
  onCaptureMode: (key: string, mode: string) => void;
  onSignOut: () => void;
  onCopy: (text: string, what: string) => void;
}) {
  const [name, setName] = useState(me?.name ?? "");
  const [projectName, setProjectName] = useState(project?.display_name ?? "");

  // The fields follow whatever the server last told us, so a rename made from
  // another screen does not leave a stale value sitting in the input.
  useEffect(() => setName(me?.name ?? ""), [me?.name]);
  useEffect(() => setProjectName(project?.display_name ?? ""), [project?.display_name]);

  return (
    <Tabs defaultValue="profile" className="gap-6">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="project">Project</TabsTrigger>
        <TabsTrigger value="memory">How memories are written</TabsTrigger>
        <TabsTrigger value="server">Server</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>
              Your name appears next to every memory you write. Your email is your identity and
              is set by whoever created your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="role">Role</FieldLabel>
                <Input id="role" value={session.role} readOnly disabled className="capitalize" />
                <FieldDescription>
                  {session.role === "owner"
                    ? "You created this organisation. Owners cannot be removed."
                    : session.role === "admin"
                      ? "You can invite people and manage every project."
                      : "You can read and write in the projects you are on. An admin can change this."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input
                  id="display-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={me?.email ?? "Your name"}
                />
                <FieldDescription>
                  Leave it empty to be shown by your email address.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" value={me?.email ?? ""} readOnly disabled />
                <FieldDescription>
                  Changed with <code className="font-mono text-xs">drymem-admin</code> on the
                  server. Joined {when(me?.created_at ?? null)}.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={() => onRenameMe(name)} disabled={busy || name === (me?.name ?? "")}>
              <Save data-icon="inline-start" /> Save
            </Button>
          </CardFooter>
        </Card>

        <PasswordCard />
        <SessionsCard onSignOut={onSignOut} />
        <TokensCard onCopy={onCopy} />
      </TabsContent>

      <TabsContent value="project" className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>This project</CardTitle>
            <CardDescription>
              Only the name is yours to change. The key is the repository’s git remote, and it is
              what makes two people working on the same repo share one memory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-name">Display name</FieldLabel>
                <Input
                  id="project-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={project?.project_key.split("/").pop() ?? "Project"}
                  disabled={!project}
                />
                <FieldDescription>Shown in the project switcher and on every list.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="project-key">Key</FieldLabel>
                <Input
                  id="project-key"
                  value={project?.project_key ?? ""}
                  readOnly
                  disabled
                  className="font-mono text-xs"
                />
                <FieldDescription>
                  Derived from the git remote, with SSH host aliases resolved so a teammate who
                  clones differently still lands here.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              disabled={busy || !project || projectName === (project?.display_name ?? "")}
              onClick={() => project && onRenameProject(project.project_key, projectName)}
            >
              <Save data-icon="inline-start" /> Save
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What gets saved</CardTitle>
            <CardDescription>
              Only what someone decides to keep, and never a transcript. On top of that, this
              chooses what happens when an agent finishes a session here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[
              {
                value: "automatic",
                title: "Automatic",
                blurb:
                  "The agent writes a private summary when it finishes. Nobody else sees a word until the author shares it.",
              },
              {
                value: "ask",
                title: "Ask first",
                blurb:
                  "The agent proposes a summary and waits. You confirm, edit, or throw it away.",
              },
              {
                value: "manual",
                title: "Manual only",
                blurb:
                  "Nothing is saved unless someone runs drymem save-session.",
              },
            ].map((option) => {
              const active = (project?.capture_mode ?? "automatic") === option.value;
              return (
                <button
                  key={option.value}
                  disabled={busy || !project}
                  onClick={() => project && onCaptureMode(project.project_key, option.value)}
                  className={
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors " +
                    (active
                      ? "border-primary/50 bg-primary/5"
                      : "hover:bg-muted/40 disabled:opacity-50")
                  }
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {option.title}
                    {active && (
                      <Badge className="bg-primary/15 text-primary">Current</Badge>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">{option.blurb}</span>
                </button>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Automatic is the default because a tool that asks permission at the end of every
              session gets “no” out of fatigue, and an empty memory helps nobody. Private-by-default
              already means nothing is visible without your decision.
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="memory" className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Kinds of memory</CardTitle>
            <CardDescription>
              Agents pick one when they save. An unrecognised value becomes “note” rather than
              failing the save — a label is never worth losing a memory over.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Object.entries(MEMORY_TYPES).map(([type, description]) => (
              <div key={type} className="flex flex-wrap items-center gap-3">
                <TypeChip type={type} />
                <span className="text-sm text-muted-foreground">{description}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>The shape of a memory</CardTitle>
            <CardDescription>
              Agents are asked for these headings. Prose without them still saves and still
              reads — the headings are what make a memory scannable here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {(schema?.sections ?? []).map((section) => (
                <Badge key={section} variant="outline">
                  {section}
                </Badge>
              ))}
            </div>
            {schema && (
              <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
                {schema.template}
              </pre>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!schema}
              onClick={() => schema && onCopy(schema.template, "template")}
            >
              <Copy data-icon="inline-start" /> Copy template
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="server" className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Where your memory lives</CardTitle>
            <CardDescription>
              drymem runs on your own infrastructure. Nothing here leaves the network it is
              installed on.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Line label="Index" value="Postgres" ok={health?.postgres} />
            <Line label="Knowledge graph" value="Neo4j" ok={health?.neo4j} />
            <Line label="Extraction model" value={health?.extractor ?? "—"} />
            <Line label="Served from" value={window.location.origin} />
          </CardContent>
          <CardFooter>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Server className="size-3.5" />
              These are set in the server’s environment, not from the browser.
            </p>
          </CardFooter>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function Line({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs">{value}</span>
        {ok !== undefined && (
          <Badge variant="outline" className={ok ? "text-success" : "text-destructive"}>
            {ok ? "Connected" : "Unreachable"}
          </Badge>
        )}
      </span>
    </div>
  );
}


function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      toast.success("Password changed");
      setCurrent("");
      setNext("");
    } catch (err) {
      toast.error("Could not change the password", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            If your account was created before drymem had passwords, leave the current one empty.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current">Current password</FieldLabel>
              <Input
                id="current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="next">New password</FieldLabel>
              <Input
                id="next"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
              <FieldDescription>At least 10 characters.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={busy || next.length < 10}>
            <KeyRound data-icon="inline-start" /> Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function SessionsCard({ onSignOut }: { onSignOut: () => void }) {
  const [sessions, setSessions] = useState<WebSession[]>([]);
  const refresh = () => auth.sessions().then(setSessions).catch(() => setSessions([]));
  useEffect(() => {
    void refresh();
  }, []);

  const revoke = async (s: WebSession) => {
    try {
      await auth.revokeSession(s.id);
      if (s.current) {
        onSignOut();
        return;
      }
      toast.success("Signed that browser out");
      void refresh();
    } catch (err) {
      toast.error("Could not sign it out", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Where you are signed in</CardTitle>
        <CardDescription>Every browser with an open session. Sign any of them out.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {s.user_agent ? shortAgent(s.user_agent) : "Unknown browser"}
                  {s.current && (
                    <Badge className="ml-2 bg-primary/15 text-primary">This one</Badge>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  signed in {relative(s.created_at)}
                  {s.last_seen_at && ` · last seen ${relative(s.last_seen_at)}`}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => revoke(s)}>
                <LogOut data-icon="inline-start" /> {s.current ? "Sign out" : "Sign out there"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** "Chrome on Linux", not the 120-character user-agent string. */
function shortAgent(ua: string): string {
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

function TokensCard({ onCopy }: { onCopy: (text: string, what: string) => void }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<ApiToken | null>(null);
  const refresh = () => auth.tokens().then(setTokens).catch(() => setTokens([]));
  useEffect(() => {
    void refresh();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await auth.createToken(label.trim());
      setFresh(created);
      setLabel("");
      void refresh();
    } catch (err) {
      toast.error("Could not create a token", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const revoke = async (t: ApiToken) => {
    try {
      await auth.revokeToken(t.id);
      toast.success(`Revoked ${t.label ?? "token"}`);
      if (fresh?.id === t.id) setFresh(null);
      void refresh();
    } catch (err) {
      toast.error("Could not revoke", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          What the CLI, the hooks and the MCP proxy use. <code className="font-mono text-xs">drymem login</code>{" "}
          makes one per machine automatically; create one here for CI or a server.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form className="flex flex-wrap items-center gap-2" onSubmit={create}>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is this for? e.g. ci-github-actions"
            className="min-w-56 flex-1"
            aria-label="Token label"
          />
          <Button type="submit" variant="outline">
            <Plus data-icon="inline-start" /> New token
          </Button>
        </form>

        {fresh?.token && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm">
              Copy it now — it is shown once.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={fresh.token} className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => onCopy(fresh.token!, "token")}>
                <Copy data-icon="inline-start" /> Copy
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {tokens.length === 0 && (
            <li className="px-5 py-3 text-sm text-muted-foreground">No tokens yet.</li>
          )}
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.label ?? "Unlabelled"}</span>
                <span className="block text-xs text-muted-foreground">
                  created {relative(t.created_at)}
                  {t.last_used_at ? ` · last used ${relative(t.last_used_at)}` : " · never used"}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke ${t.label ?? "token"}`}
                onClick={() => revoke(t)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
