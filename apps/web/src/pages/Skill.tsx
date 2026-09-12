/**
 * One skill, on its own page.
 *
 * It was a dialog, and a dialog was the wrong container: a skill is a document
 * with an author, a version history and a few hundred lines of Markdown, and
 * putting that in a box 3xl wide gave it a horizontal scrollbar and cut the
 * prose off mid-sentence. A page has a URL you can send someone, a trail back
 * to the catalogue, and as much width as the content needs.
 *
 * Two sections, in the order somebody reads them: what this is and what it
 * would do to your machine, then every version it has had.
 */

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Clock, Download, FileText, ShieldAlert, Trash2 } from "lucide-react";

import { Blank } from "@/components/Bits";
import { Crumbs } from "@/components/Crumbs";
import { Markdown } from "@/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Findings, SourceChip, StateChip } from "@/pages/Skills";
import type { CatalogueSkill, Skill, SkillVersion } from "@/api";
import { frontmatter } from "@/memory";
import { count, when } from "@/format";

export function SkillPage({
  name,
  skill,
  entry,
  versions,
  isAdmin,
  busy,
  onEnable,
  onDisable,
  onApprove,
  onDeprecate,
  onLoadVersions,
}: {
  name: string;
  /** The enabled copy, which is the only one carrying content. */
  skill: Skill | undefined;
  /** The catalogue row, which exists whether it is enabled here or not. */
  entry: CatalogueSkill | undefined;
  versions: SkillVersion[] | null;
  isAdmin: boolean;
  busy: boolean;
  onEnable: (name: string, version?: number) => void;
  onDisable: (name: string) => void;
  onApprove: (name: string) => void;
  onDeprecate: (name: string) => void;
  onLoadVersions: (name: string) => void;
}) {
  const [tab, setTab] = useState("skill");

  useEffect(() => {
    onLoadVersions(name);
    // `onLoadVersions` is stable in the parent; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const meta = entry ?? skill;
  // Content only travels with the enabled copy. For a catalogue-only skill the
  // newest version carries it, which is why versions load on mount.
  const content = skill?.content ?? versions?.[0]?.content ?? "";
  const document = frontmatter(content);
  const author = meta?.author ?? versions?.[0]?.author ?? null;
  const enabledHere = Boolean(skill);

  if (!meta && versions === null) return <Spinner />;
  if (!meta && versions?.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Crumbs trail={[{ label: "Skills", page: "skills" }, { label: name, mono: true }]} />
        <Blank icon={FileText} title="No such skill">
          Nothing in this organisation's catalogue is called {name}.
        </Blank>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Crumbs
        trail={[
          { label: "Skills", page: "skills" },
          ...(author ? [{ label: author.split("@")[0]!, page: "skills" }] : []),
          { label: name, mono: true },
        ]}
      />

      <Card className="min-w-0">
        <CardHeader className="min-w-0 gap-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="font-mono text-lg">{name}</CardTitle>
              {document.meta.description && (
                <CardDescription className="mt-1 max-w-2xl">
                  {document.meta.description}
                </CardDescription>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {enabledHere ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onDisable(name)}
                  aria-label={`Remove ${name} from this project`}
                >
                  <Trash2 data-icon="inline-start" /> Remove from project
                </Button>
              ) : (
                <Button disabled={busy || meta?.state === "pending"} onClick={() => onEnable(name)}>
                  <Download data-icon="inline-start" /> Add to this project
                </Button>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {skill && <Badge variant="outline">v{skill.version}</Badge>}
            {meta && <SourceChip source={meta.source} />}
            {meta && <StateChip state={meta.state} />}
            {enabledHere && (
              <Badge className="bg-success/15 text-success">
                <CheckCircle2 data-icon="inline-start" /> On this project
              </Badge>
            )}
            {skill?.outdated && (
              <Badge variant="outline" className="text-muted-foreground">
                <Clock data-icon="inline-start" /> v{skill.latest_version} available
              </Badge>
            )}
            {meta?.origin && (
              <Badge variant="outline" className="font-mono text-xs">
                {meta.origin}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">
              {author ?? "unknown"}
              {meta ? ` · ${count(meta.uses, "read")}` : ""}
            </span>
          </div>

          {isAdmin && meta?.state === "pending" && (
            <div className="border-border bg-muted/30 flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <ShieldAlert className="text-destructive size-4 shrink-0" />
              <p className="min-w-0 flex-1 text-sm">
                The scanner held this for review. Read it before anyone's agent does.
              </p>
              <Button size="sm" disabled={busy} onClick={() => onApprove(name)}>
                Approve
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="skill">Skill</TabsTrigger>
              <TabsTrigger value="versions">
                Versions {versions ? versions.length : ""}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="skill" className="min-w-0 pt-4">
              {skill?.findings?.length ? <Findings findings={skill.findings} /> : null}
              {content ? (
                <div className="border-border bg-muted/20 min-w-0 rounded-lg border p-4">
                  <Markdown source={document.body} />
                </div>
              ) : (
                <Spinner />
              )}
            </TabsContent>

            <TabsContent value="versions" className="min-w-0 pt-4">
              <p className="text-muted-foreground mb-3 text-sm">
                Versions never change. A project stays on the one it pinned until somebody moves it.
              </p>
              {versions === null ? (
                <Spinner />
              ) : (
                <ul className="flex min-w-0 flex-col gap-3">
                  {versions.map((version) => (
                    <li key={version.version} className="border-border min-w-0 rounded-lg border p-3">
                      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline">v{version.version}</Badge>
                        {skill?.version === version.version && (
                          <Badge className="bg-success/15 text-success">In use here</Badge>
                        )}
                        <span className="text-muted-foreground font-mono text-xs">
                          {version.sha256.slice(0, 12)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {version.author ?? "unknown"} · {when(version.created_at)}
                          {version.model && ` · ${version.model}`}
                        </span>
                        {skill?.version !== version.version && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="ml-auto"
                            disabled={busy}
                            onClick={() => onEnable(name, version.version)}
                          >
                            <Download data-icon="inline-start" /> Use this one
                          </Button>
                        )}
                      </div>
                      {version.note && (
                        <p className="text-muted-foreground mb-2 text-xs">{version.note}</p>
                      )}
                      <Findings findings={version.findings} />
                      <details className="mt-2 min-w-0">
                        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
                          Read this version
                        </summary>
                        <div className="border-border bg-muted/20 mt-2 min-w-0 rounded-lg border p-3">
                          <Markdown source={frontmatter(version.content).body} />
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {isAdmin && meta && meta.state !== "deprecated" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Retire this skill</CardTitle>
            <CardDescription>
              Deprecating stops projects adding it. Projects already on it keep working — deleting
              it would break a `pull` on a machine that did nothing wrong.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" disabled={busy} onClick={() => onDeprecate(name)}>
              <Ban data-icon="inline-start" /> Deprecate for the organisation
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
