/**
 * Skills — three panels, in the order somebody actually moves through them.
 *
 * **On this project** is what is installed on everyone's machine right now, so
 * it comes first: a lead opening this screen is usually checking or removing
 * something, not shopping.
 *
 * **Catalogue** is what the organisation has and this project could turn on.
 *
 * **Suggested** is the loop nobody else has — subjects the project's own
 * memories keep returning to, drafted into a skill and published after a human
 * reads it.
 *
 * Everything destructive or organisation-wide is behind a role check on the
 * server; the buttons are hidden here as a courtesy, never as the control.
 */

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { Blank } from "@/components/Bits";
import { Markdown } from "@/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CatalogueSkill, Cluster, Finding, Skill, SkillVersion } from "@/api";
import { frontmatter } from "@/memory";
import { count, relative } from "@/format";
import { go } from "@/router";

export type Draft = { name: string; content: string; model: string; memory_count: number };

/** Where a skill came from. Worth showing: imported and distilled earn different trust. */
export function SourceChip({ source }: { source: string }) {
  const label: Record<string, string> = {
    base: "Built in",
    distilled: "From memory",
    imported: "Imported",
    authored: "Written",
  };
  return <Badge variant="outline">{label[source] ?? source}</Badge>;
}

export function StateChip({ state }: { state: string }) {
  if (state === "pending") {
    return (
      <Badge variant="outline" className="text-primary">
        <Clock /> Waiting for review
      </Badge>
    );
  }
  if (state === "deprecated") {
    return (
      <Badge variant="outline" className="text-destructive">
        <Ban /> Deprecated
      </Badge>
    );
  }
  return null;
}

export function Findings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
      {findings.map((finding, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          {finding.severity === "reject" ? (
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
          )}
          <span>
            <span className="font-mono">{finding.rule}</span>
            {finding.line ? <span className="text-muted-foreground"> · line {finding.line}</span> : null}
            <br />
            <span className="text-muted-foreground">{finding.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SkillsPage({
  skills,
  catalogue,
  clusters,
  drafts,
  drafting,
  busy,
  isAdmin,
  onDraft,
  onPublish,
  onEnable,
  onDisable,
  onApprove,
  onDeprecate,
  onVersions,
}: {
  skills: Skill[];
  catalogue: CatalogueSkill[];
  clusters: Cluster[];
  drafts: Record<string, Draft>;
  drafting: string | null;
  busy: boolean;
  isAdmin: boolean;
  onDraft: (topic: string) => void;
  onPublish: (topic: string) => void;
  onEnable: (name: string, version?: number) => void;
  onDisable: (name: string) => void;
  onApprove: (name: string) => void;
  onDeprecate: (name: string) => void;
  onVersions: (name: string) => Promise<SkillVersion[]>;
}) {
  const [readingDraft, setReadingDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const enabledNames = new Set(skills.map((s) => s.name));
  const published = catalogue.filter((s) => s.state !== "pending");
  const pending = catalogue.filter((s) => s.state === "pending");
  const publishedTopics = new Set(catalogue.map((s) => s.topic));
  const suggestions = clusters.filter((c) => !publishedTopics.has(c.topic));

  const draft = readingDraft ? drafts[readingDraft] : null;
  const document = frontmatter(draft?.content ?? "");

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && isAdmin && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="size-4 text-primary" />
              {count(pending.length, "skill")} waiting for review
            </CardTitle>
            <CardDescription>
              The scanner found something worth a human reading before this runs on anyone's
              machine. Nothing can enable them until you approve.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pending.map((skill) => (
              <div
                key={skill.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{skill.name}</span>
                <SourceChip source={skill.source} />
                <Button size="sm" variant="outline" onClick={() => go("skills", skill.name)}>
                  Read it
                </Button>
                <Button size="sm" disabled={busy} onClick={() => onApprove(skill.name)}>
                  <CheckCircle2 data-icon="inline-start" /> Approve
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="project" className="gap-4">
        <TabsList>
          <TabsTrigger value="project">On this project {skills.length}</TabsTrigger>
          <TabsTrigger value="catalogue">Catalogue {published.length}</TabsTrigger>
          <TabsTrigger value="suggested">Suggested {suggestions.length}</TabsTrigger>
        </TabsList>

        {/* ---- installed here ------------------------------------------------ */}
        <TabsContent value="project">
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b p-4">
              <CardTitle className="text-sm">Installed on every machine on this project</CardTitle>
              <CardDescription>
                A teammate gets these by running <code className="font-mono text-xs">git pull</code>
                . The lockfile at <code className="font-mono text-xs">.drymem/skills.lock</code> is
                what carries them.
              </CardDescription>
            </CardHeader>
            {skills.length === 0 ? (
              <Blank icon={FileText} title="Nothing enabled here yet">
                Turn one on from the catalogue, or distil one from what this project keeps
                re-learning.
              </Blank>
            ) : (
              <ul className="flex flex-col">
                {skills.map((skill) => (
                  <li
                    key={skill.id}
                    className="flex flex-wrap items-center gap-2 border-t px-4 py-3 first:border-t-0"
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => go("skills", skill.name)}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm font-medium">
                          {skill.name}
                        </span>
                        <Badge variant="outline">v{skill.version}</Badge>
                        <StateChip state={skill.state} />
                        {skill.outdated && (
                          <Badge variant="outline" className="text-primary">
                            v{skill.latest_version} available
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {skill.description || skill.topic || "No description"} ·{" "}
                        {skill.uses > 0 ? count(skill.uses, "read") : "never read by an agent"}
                      </span>
                    </button>
                    {skill.outdated && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onEnable(skill.name)}
                      >
                        Update to v{skill.latest_version}
                      </Button>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`History of ${skill.name}`}
                          onClick={() => go("skills", skill.name)}
                        >
                          <History />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Every version</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${skill.name} from this project`}
                      disabled={busy}
                      onClick={() => setConfirm(skill.name)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        {/* ---- the organisation's catalogue ---------------------------------- */}
        <TabsContent value="catalogue">
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b p-4">
              <CardTitle className="text-sm">Everything your organisation has</CardTitle>
              <CardDescription>
                Turning one on pins this project to a version. Other projects are unaffected.
              </CardDescription>
            </CardHeader>
            {published.length === 0 ? (
              <Blank icon={Sparkles} title="The catalogue is empty">
                Distil one from a suggestion, or publish a folder you already have with{" "}
                <code className="font-mono">drymem skills publish ./my-skill</code>.
              </Blank>
            ) : (
              <ul className="flex flex-col">
                {published.map((skill) => (
                  <li
                    key={skill.id}
                    className="flex flex-wrap items-center gap-2 border-t px-4 py-3 first:border-t-0"
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => go("skills", skill.name)}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm font-medium">
                          {skill.name}
                        </span>
                        <SourceChip source={skill.source} />
                        <StateChip state={skill.state} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {skill.description || skill.topic || "No description"} · v
                        {skill.latest_version} · {relative(skill.updated_at)}
                        {skill.origin && ` · ${skill.origin}`}
                      </span>
                    </button>
                    {enabledNames.has(skill.name) ? (
                      <Badge variant="outline" className="text-success">
                        <CheckCircle2 /> On here
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => onEnable(skill.name)}
                      >
                        <Plus data-icon="inline-start" /> Enable
                      </Button>
                    )}
                    {isAdmin && skill.state !== "deprecated" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Deprecate ${skill.name}`}
                        disabled={busy}
                        onClick={() => onDeprecate(skill.name)}
                      >
                        <Ban />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        {/* ---- the loop ------------------------------------------------------ */}
        <TabsContent value="suggested">
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b p-4">
              <CardTitle className="text-sm">Subjects this project keeps returning to</CardTitle>
              <CardDescription>
                Drafting reads the memories about a subject and writes a SKILL.md. Nothing is
                installed until a person reads it and publishes it.
              </CardDescription>
            </CardHeader>
            {suggestions.length === 0 ? (
              <Blank icon={Sparkles} title="No suggestions">
                A subject appears here once two or more memories mention it and no skill covers it.
              </Blank>
            ) : (
              <ul className="flex max-h-[32rem] flex-col overflow-y-auto">
                {suggestions.map((cluster) => {
                  const ready = drafts[cluster.topic];
                  const busyHere = drafting === cluster.topic;
                  return (
                    <li
                      key={cluster.topic}
                      className="flex items-center gap-2 border-t px-4 py-3 first:border-t-0"
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        disabled={!ready}
                        onClick={() => ready && setReadingDraft(cluster.topic)}
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{cluster.topic}</span>
                          {ready && <Badge variant="outline">Draft ready</Badge>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {count(cluster.memory_count, "memory", "memories")}
                        </span>
                      </button>
                      {ready ? (
                        <Button size="sm" onClick={() => setReadingDraft(cluster.topic)}>
                          Review
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyHere || busy}
                          onClick={() => onDraft(cluster.topic)}
                        >
                          {busyHere ? <Spinner /> : <Wand2 data-icon="inline-start" />}
                          {busyHere ? "Drafting…" : "Draft"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {drafting && (
            <p className="mt-3 text-sm text-muted-foreground">
              Writing a skill from the memories about “{drafting}”. A local model takes a minute or
              two — you can keep working.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ---- reading a draft ---------------------------------------------- */}
      {/*
        A published skill has its own page now. A draft does not: it exists only
        in this browser until somebody publishes it, so there is nothing to link
        to and a dialog is the honest container.
      */}
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => !open && setReadingDraft(null)}
      >
        <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{draft?.name ?? "Draft"}</DialogTitle>
            <DialogDescription>
              {draft
                ? `Draft by ${draft.model} from ${count(draft.memory_count, "memory", "memories")}. Read it before publishing — nothing is installed until you do.`
                : ""}
            </DialogDescription>
            {document.meta.description && (
              <p className="text-foreground text-sm">{document.meta.description}</p>
            )}
          </DialogHeader>

          <div className="min-w-0 rounded-lg border bg-muted/20 p-4">
            <Markdown source={document.body} />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            {draft && readingDraft && (
              <Button
                disabled={busy}
                onClick={() => {
                  onPublish(readingDraft);
                  setReadingDraft(null);
                }}
              >
                <Sparkles data-icon="inline-start" /> Publish and enable here
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirm} from this project?</DialogTitle>
            <DialogDescription>
              It stops being installed on everyone's machine at their next session. The skill stays
              in the catalogue and every version is kept, so you can turn it back on at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm) onDisable(confirm);
                setConfirm(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
