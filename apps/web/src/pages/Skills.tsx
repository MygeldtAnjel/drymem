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

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { Blank, PersonChip } from "@/components/Bits";
import { Input } from "@/components/ui/input";
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
import type { CatalogueSkill, Cluster, Finding, Skill, SkillVersion } from "@/api";
import { frontmatter } from "@/memory";
import { count, relative } from "@/format";
import { go } from "@/router";

export type Draft = {
  name: string;
  content: string;
  model: string;
  memory_count: number;
  /** The topic keys it was written from, so a reader can judge the coverage. */
  sources?: string[];
};

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

/**
 * One skill in the catalogue.
 *
 * A card rather than a row because a catalogue is browsed, not audited: a
 * person arrives wanting to find out what is available, and a description that
 * gets two lines instead of a truncated tail is the difference between reading
 * and squinting. The list shape stays on "On this project", where the job is
 * checking what is installed rather than shopping.
 */
function SkillCard({
  skill,
  enabledHere,
  isAdmin,
  busy,
  pinned,
  outdated,
  latestVersion,
  onEnable,
  onDeprecate,
  onFilter,
  onRemove,
}: {
  skill: CatalogueSkill;
  enabledHere: boolean;
  isAdmin: boolean;
  busy: boolean;
  /** The version this project is on, when it is installed here. */
  pinned?: number;
  outdated?: boolean;
  latestVersion?: number;
  onEnable: (name: string) => void;
  onDeprecate: (name: string) => void;
  onFilter: (topic: string) => void;
  /** Present only on the installed list, where removing is the action. */
  onRemove?: (name: string) => void;
}) {
  return (
    <li className="border-border bg-card hover:border-input flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors">
      <button className="min-w-0 text-left" onClick={() => go("skills", skill.name)}>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">{skill.name}</span>
          {enabledHere && (
            <Badge className="bg-success/15 text-success">
              <CheckCircle2 data-icon="inline-start" /> On here
            </Badge>
          )}
          <StateChip state={skill.state} />
        </span>
        <span className="text-muted-foreground mt-1.5 line-clamp-2 text-xs">
          {skill.description || skill.topic || "No description"}
        </span>
      </button>

      {skill.topics.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {skill.topics.slice(0, 3).map((topic) => (
            <button
              key={topic}
              className="border-border text-muted-foreground hover:border-input hover:text-foreground truncate rounded-full border px-2 py-0.5 text-[11px] transition-colors"
              onClick={() => onFilter(topic)}
            >
              {topic}
            </button>
          ))}
          {skill.topics.length > 3 && (
            <span className="text-muted-foreground text-[11px]">
              +{skill.topics.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <SourceChip source={skill.source} />
        <Badge variant="outline">v{pinned ?? skill.latest_version}</Badge>
        {outdated && (
          <Badge variant="outline" className="text-primary">
            <Clock data-icon="inline-start" /> v{latestVersion} available
          </Badge>
        )}
        {skill.uses > 0 && (
          <Badge variant="outline" className="text-primary">
            <Flame data-icon="inline-start" /> {count(skill.uses, "read")}
          </Badge>
        )}
      </div>

      <div className="border-border mt-auto flex min-w-0 flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          <PersonChip author={skill.author} name={skill.author_name} />
          <span className="ml-1.5">· {relative(skill.updated_at)}</span>
        </span>
        {outdated && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onEnable(skill.name)}>
            Update to v{latestVersion}
          </Button>
        )}
        {!enabledHere && (
          <Button size="sm" disabled={busy} onClick={() => onEnable(skill.name)}>
            <Plus data-icon="inline-start" /> Add
          </Button>
        )}
        {onRemove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${skill.name} from this project`}
            disabled={busy}
            onClick={() => onRemove(skill.name)}
          >
            <Trash2 />
          </Button>
        ) : (
          isAdmin &&
          skill.state !== "deprecated" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Deprecate ${skill.name}`}
              disabled={busy}
              onClick={() => onDeprecate(skill.name)}
            >
              <Ban />
            </Button>
          )
        )}
      </div>
    </li>
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
  moreSkills,
  fetchingMore,
  onMoreSkills,
}: {
  skills: Skill[];
  catalogue: CatalogueSkill[];
  clusters: Cluster[];
  drafts: Record<string, Draft>;
  drafting: string | null;
  busy: boolean;
  isAdmin: boolean;
  moreSkills: string | null;
  fetchingMore: boolean;
  onMoreSkills: () => void;
  onDraft: (topic: string) => void;
  onPublish: (topic: string) => void;
  onEnable: (name: string, version?: number) => void;
  onDisable: (name: string) => void;
  onApprove: (name: string) => void;
  onDeprecate: (name: string) => void;
  onVersions: (name: string) => Promise<SkillVersion[]>;
}) {
  // Controlled, so clicking a tag on an installed skill can take you to the
  // catalogue with that tag already filtering it.
  const [tab, setTab] = useState("project");
  const [readingDraft, setReadingDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const enabledNames = new Set(skills.map((s) => s.name));
  const published = catalogue.filter((s) => s.state !== "pending");
  const pending = catalogue.filter((s) => s.state === "pending");
  const publishedTopics = new Set(catalogue.map((s) => s.topic));
  const suggestions = clusters.filter((c) => !publishedTopics.has(c.topic));

  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? published.filter((s) =>
        `${s.name} ${s.description ?? ""} ${s.topic} ${s.topics.join(" ")}`
          .toLowerCase()
          .includes(needle),
      )
    : published;

  const draft = readingDraft ? drafts[readingDraft] : null;

  /*
   * Open the draft the moment it lands.
   *
   * Drafting takes a local model a minute or two. Coming back to a toast and
   * having to find a "Read" button is the wrong end of that wait — the whole
   * point of the pause is the document at the end of it.
   */
  const waitingFor = useRef<string | null>(null);
  useEffect(() => {
    if (drafting) waitingFor.current = drafting;
  }, [drafting]);
  useEffect(() => {
    const topic = waitingFor.current;
    if (!drafting && topic && drafts[topic]) {
      waitingFor.current = null;
      setReadingDraft(topic);
    }
  }, [drafting, drafts]);
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

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
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
              <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {skills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    enabledHere
                    isAdmin={isAdmin}
                    busy={busy}
                    pinned={skill.version}
                    outdated={skill.outdated}
                    latestVersion={skill.latest_version}
                    onEnable={onEnable}
                    onDeprecate={onDeprecate}
                    onFilter={(topic) => {
                      setFilter(topic);
                      setTab("catalogue");
                    }}
                    onRemove={setConfirm}
                  />
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
              <div className="flex flex-col gap-4 p-4">
                {/* A seeded organisation starts with eighteen. Scrolling a grid
                    looking for one by eye is the thing a filter exists for. */}
                {published.length > 6 && (
                  <div className="relative max-w-sm">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                    <Input
                      className="pl-8"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter by name, description or tag"
                      aria-label="Filter the catalogue"
                    />
                  </div>
                )}

                {matching.length === 0 ? (
                  <Blank icon={Search} title="Nothing matches">
                    No skill here has “{filter}” in its name, description or tags.
                  </Blank>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {matching.map((skill) => (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        enabledHere={enabledNames.has(skill.name)}
                        isAdmin={isAdmin}
                        busy={busy}
                        onEnable={onEnable}
                        onDeprecate={onDeprecate}
                        onFilter={setFilter}
                      />
                    ))}
                  </ul>
                )}

                {moreSkills && (
                  <div className="flex items-center justify-center gap-3">
                    {/* The filter runs over what is loaded, so say so rather
                        than let "nothing matches" mean two different things. */}
                    <p className="text-muted-foreground text-xs">
                      {count(published.length, "skill")} loaded
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={fetchingMore}
                      onClick={onMoreSkills}
                    >
                      {fetchingMore ? <Spinner className="size-3.5" /> : null} Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ---- the loop ------------------------------------------------------ */}
        <TabsContent value="suggested">
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b p-4">
              <CardTitle className="text-sm">Parts of the codebase with no skill</CardTitle>
              <CardDescription>
                Drafting reads what the team decided while working here and writes a SKILL.md.
                Nothing is installed until a person reads it and publishes it.
              </CardDescription>
            </CardHeader>
            {suggestions.length === 0 ? (
              <Blank icon={Sparkles} title="No suggestions">
                A part of the codebase appears here once two or more memories name a file in it.
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
                          <span className="truncate font-mono text-sm font-medium">
                            {cluster.topic}
                          </span>
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

          {draft?.sources && draft.sources.length > 0 && (
            <div className="min-w-0">
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                What it covers
              </p>
              <div className="flex min-w-0 flex-wrap gap-1">
                {draft.sources.map((source) => (
                  <span
                    key={source}
                    className="border-border text-muted-foreground truncate rounded-full border px-2 py-0.5 font-mono text-[11px]"
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
          )}

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
