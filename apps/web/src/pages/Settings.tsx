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
  api,
  auth,
  isAdmin,
  type ApiToken,
  type Health,
  type Me,
  type MemorySchema,
  type Project,
  type Session,
  type Usage,
  type WebSession,
  type ServerSettings,
  type ServerSettingsPatch,
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
        {/* The server card is admin-only on the API, so offering it to a
            member is offering a tab that can only fail. */}
        {isAdmin(me) && <TabsTrigger value="server">Server</TabsTrigger>}
      </TabsList>

      <TabsContent value="profile" className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>
              Your name appears next to every memory you write. Your email is your identity and
              is set by whoever created your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="max-w-2xl">
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

      <TabsContent value="project" className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>This project</CardTitle>
            <CardDescription>
              Only the name is yours to change. The key is the repository’s git remote, and it is
              what makes two people working on the same repo share one memory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="max-w-2xl">
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

      <TabsContent value="memory" className="flex flex-col gap-4">
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

      <TabsContent value="server" className="flex flex-col gap-4">
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
              Where the data lives is set in the server’s environment on purpose — a wrong value
              typed here would take away the screen you would fix it with.
            </p>
          </CardFooter>
        </Card>

        <ServerSettingsCard />
        <UsageCard />
      </TabsContent>
    </Tabs>
  );
}

/**
 * What this organisation is using.
 *
 * Loads itself, like the sessions and tokens cards, because it is admin-only
 * and every other screen would be paying a 403 for it. A member simply does not
 * see the card.
 */
function UsageCard() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    api
      .usage()
      .then(setUsage)
      .catch(() => setRefused(true));
  }, []);

  if (refused || !usage) return null;
  // Formatted in UTC because the counter is: the month boundary is midnight
  // UTC, and a local rendering called it "August" for anyone west of it.
  const month = new Date(usage.month_started).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>What you are using</CardTitle>
        <CardDescription>
          On the {usage.subscription.plan} plan.{" "}
          {usage.subscription.metered
            ? `Renews ${when(usage.subscription.current_period_end)}.`
            : "Nothing here is charged for yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Line label="People signed in" value={String(usage.seats_used)} />
        {usage.pending_invites > 0 && (
          <Line label="Invitations not accepted" value={String(usage.pending_invites)} />
        )}
        <Line label="Projects" value={String(usage.projects)} />
        <Line
          label="Memories"
          value={`${usage.memories.total} · ${usage.memories.this_month} in ${month} · ${usage.memories.shared} shared`}
        />
        <Line
          label="Skills"
          value={`${usage.skills.catalogue} in the catalogue · ${usage.skills.versions} versions · ${usage.skills.reads} reads`}
        />
      </CardContent>
    </Card>
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
          <FieldGroup className="max-w-2xl">
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


/**
 * The settings that can be changed from here, which is deliberately a short list.
 *
 * Everything is optional. drymem works with none of it: without an email key
 * invitation and reset links are handed to the admin who made them, and without
 * a model key it uses whatever local model the server was pointed at. Nothing
 * here is required to turn anything on — it is here so that changing your mind
 * does not mean a shell and a restart.
 *
 * A key is written and never read back. The field shows the last four
 * characters of the one in force so you can tell whether it is the one you
 * meant, and typing a new one replaces it.
 */
function ServerSettingsCard() {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [key, setKey] = useState("");
  const [from, setFrom] = useState("");
  const [model, setModel] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const next = await api.serverSettings();
      setSettings(next);
      setFrom(next.email.from_address);
      setModel(next.model.local_llm_model ?? "");
    } catch {
      // A member reaching this screen gets a 403; there is nothing to show and
      // nothing to say about it.
      setSettings(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!settings) return null;

  const save = async (changes: ServerSettingsPatch) => {
    setBusy(true);
    try {
      await api.saveServerSettings(changes);
      setKey("");
      setAnthropicKey("");
      await load();
      toast.success("Saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email and model</CardTitle>
        <CardDescription>
          Optional, both of them. Without an email key, invitations and reset links are handed
          to whoever created them instead of being sent. Without a model key, extraction uses
          the local model this server was pointed at.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="max-w-2xl">
          <Field>
            <FieldLabel htmlFor="resend-key">
              Resend API key
              {settings.email.configured && (
                <Badge className="ml-2 bg-success/15 text-success">
                  {settings.email.from_environment ? "From the environment" : "Set"}
                </Badge>
              )}
            </FieldLabel>
            <Input
              id="resend-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={settings.email.api_key_hint ?? "Not set — email is not sent"}
              autoComplete="off"
            />
            <FieldDescription>
              {settings.email.from_environment
                ? "Set in the server’s environment. Anything you save here takes precedence."
                : "Written, never shown again. Leave it empty to keep the one in use."}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="email-from">From address</FieldLabel>
            <Input
              id="email-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="drymem <hello@your-company.com>"
            />
            <FieldDescription>
              Resend’s shared test address only delivers to the account that owns it. Verify a
              domain before inviting anybody.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="llm-model">Model for memory and chat</FieldLabel>
            <Input
              id="llm-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={settings.model.local_llm_model ?? "qwen3.6:35b-a3b"}
            />
            <FieldDescription>
              Currently extracting with{" "}
              <code className="font-mono text-xs">{settings.model.extractor}</code>. The
              embedding model is not here: changing it would make every memory already stored
              unsearchable.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="anthropic-key">
              Anthropic API key
              {settings.model.anthropic_key_configured && (
                <Badge className="ml-2 bg-success/15 text-success">Set</Badge>
              )}
            </FieldLabel>
            <Input
              id="anthropic-key"
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={settings.model.anthropic_key_hint ?? "Not set — the local model is used"}
              autoComplete="off"
            />
            <FieldDescription>
              Only needed to run extraction on Anthropic instead of locally. A memory is a
              summary your agent wrote, not your code — but it would leave the network.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-between">
        <p className="text-xs text-muted-foreground">
          {settings.updated_at ? `Last changed ${when(settings.updated_at)}.` : "Never changed here."}
        </p>
        <Button
          disabled={busy}
          onClick={() =>
            save({
              ...(key ? { resend_api_key: key } : {}),
              ...(anthropicKey ? { anthropic_api_key: anthropicKey } : {}),
              ...(from !== settings.email.from_address ? { email_from: from || null } : {}),
              ...(model !== (settings.model.local_llm_model ?? "")
                ? { local_llm_model: model || null }
                : {}),
            })
          }
        >
          <Save data-icon="inline-start" /> Save
        </Button>
      </CardFooter>
    </Card>
  );
}
