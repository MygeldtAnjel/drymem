/**
 * Skills: the loop that makes drymem more than a notebook.
 *
 * Left half is what the team has published. Right half is what the memories
 * keep circling back to but nobody has written a skill for yet. Drafting runs
 * a model over those memories; publishing is a separate, deliberate click,
 * because a skill changes how every agent on the team behaves and a model
 * writing one unsupervised is a loop with nobody in it.
 */

import { useState } from "react";
import { FileText, Sparkles, Trash2, Wand2 } from "lucide-react";

import { Blank } from "@/components/Bits";
import { Markdown } from "@/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import type { Cluster, Skill } from "@/api";
import { count, relative } from "@/format";

export type Draft = { name: string; content: string; model: string; memory_count: number };

export function SkillsPage({
  skills,
  clusters,
  drafts,
  drafting,
  busy,
  onDraft,
  onPublish,
  onUnpublish,
  onOpen,
  open,
}: {
  skills: Skill[];
  clusters: Cluster[];
  drafts: Record<string, Draft>;
  drafting: string | null;
  busy: boolean;
  onDraft: (topic: string) => void;
  onPublish: (topic: string) => void;
  onUnpublish: (name: string) => void;
  onOpen: (value: { kind: "skill" | "draft"; key: string } | null) => void;
  open: { kind: "skill" | "draft"; key: string } | null;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const publishedTopics = new Set(skills.map((s) => s.topic));
  const suggestions = clusters.filter((c) => !publishedTopics.has(c.topic));

  const openSkill = open?.kind === "skill" ? skills.find((s) => s.name === open.key) : undefined;
  const openDraft = open?.kind === "draft" ? drafts[open.key] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <CardHeader className="border-b p-4">
            <CardTitle className="text-sm">Published</CardTitle>
            <CardDescription>
              Installed by anyone on the team with <code className="font-mono text-xs">drymem skills sync</code>.
            </CardDescription>
          </CardHeader>
          {skills.length === 0 ? (
            <Blank icon={FileText} title="Nothing published yet">
              Draft one from a suggestion, read it, then publish it if it is right.
            </Blank>
          ) : (
            <ul className="flex flex-col">
              {skills.map((skill) => (
                <li key={skill.id} className="flex items-center gap-2 border-t px-4 py-3 first:border-t-0">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpen({ kind: "skill", key: skill.name })}
                  >
                    <span className="block truncate font-mono text-sm font-medium">{skill.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {skill.author} · {relative(skill.updated_at)} ·{" "}
                      {count(skill.memory_count, "memory", "memories")}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Unpublish ${skill.name}`}
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

        <Card className="overflow-hidden p-0">
          <CardHeader className="border-b p-4">
            <CardTitle className="text-sm">Suggested</CardTitle>
            <CardDescription>
              Subjects this project’s memories keep returning to, with no skill written for them.
            </CardDescription>
          </CardHeader>
          {suggestions.length === 0 ? (
            <Blank icon={Sparkles} title="No suggestions">
              A subject shows up here once two or more memories mention it.
            </Blank>
          ) : (
            <ul className="flex max-h-[26rem] flex-col overflow-y-auto">
              {suggestions.map((cluster) => {
                const draft = drafts[cluster.topic];
                const isDrafting = drafting === cluster.topic;
                return (
                  <li
                    key={cluster.topic}
                    className="flex items-center gap-2 border-t px-4 py-3 first:border-t-0"
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => draft && onOpen({ kind: "draft", key: cluster.topic })}
                      disabled={!draft}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{cluster.topic}</span>
                        {draft && <Badge variant="outline">Draft ready</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {count(cluster.memory_count, "memory", "memories")}
                      </span>
                    </button>
                    {draft ? (
                      <Button size="sm" onClick={() => onOpen({ kind: "draft", key: cluster.topic })}>
                        Review
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isDrafting || busy}
                        onClick={() => onDraft(cluster.topic)}
                      >
                        {isDrafting ? <Spinner /> : <Wand2 data-icon="inline-start" />}
                        {isDrafting ? "Drafting…" : "Draft"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {drafting && (
        <p className="text-sm text-muted-foreground">
          Writing a skill from the memories about “{drafting}”. A local model takes a minute or
          two — you can keep working.
        </p>
      )}

      {/* Reading a skill is reading a document, so it gets the whole width. */}
      <Dialog open={Boolean(openSkill || openDraft)} onOpenChange={(o) => !o && onOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {openSkill?.name ?? openDraft?.name ?? "Skill"}
            </DialogTitle>
            <DialogDescription>
              {openSkill
                ? `Published by ${openSkill.author} · drawn from ${count(openSkill.memory_count, "memory", "memories")}`
                : openDraft
                  ? `Draft written by ${openDraft.model} from ${count(openDraft.memory_count, "memory", "memories")}. Read it before publishing — nothing is installed until you do.`
                  : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-4">
            <Markdown source={openSkill?.content ?? openDraft?.content ?? ""} />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            {openDraft && open && (
              <Button
                onClick={() => {
                  onPublish(open.key);
                  onOpen(null);
                }}
                disabled={busy}
              >
                <Sparkles data-icon="inline-start" /> Publish to the team
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish {confirm}?</DialogTitle>
            <DialogDescription>
              It stops being available to the team. The memories it was written from are not
              touched, so you can draft it again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm) onUnpublish(confirm);
                setConfirm(null);
              }}
            >
              Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
