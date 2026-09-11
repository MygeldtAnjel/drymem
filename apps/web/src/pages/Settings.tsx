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
import { Copy, KeyRound, Save, Server } from "lucide-react";

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
import type { Health, Me, MemorySchema, Project } from "@/api";
import { MEMORY_TYPES } from "@/memory";
import { when } from "@/format";

export function SettingsPage({
  me,
  health,
  schema,
  project,
  busy,
  onRenameMe,
  onRenameProject,
  onSignOut,
  onCopy,
}: {
  me: Me | null;
  health: Health | null;
  schema: MemorySchema | null;
  project?: Project;
  busy: boolean;
  onRenameMe: (name: string) => void;
  onRenameProject: (key: string, name: string) => void;
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

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>
              This browser holds your token for the session only — closing the tab signs you out.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Lost your token? Run <code className="font-mono text-xs">drymem token</code> on a
              machine where the CLI is set up — it prints the one already in use. With nothing
              set up, whoever runs the server issues one with{" "}
              <code className="font-mono text-xs">drymem-admin token-create &lt;email&gt;</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy("drymem token", "command")}
              >
                <Copy data-icon="inline-start" /> Copy command
              </Button>
              <Button variant="destructive" size="sm" onClick={onSignOut}>
                <KeyRound data-icon="inline-start" /> Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
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
