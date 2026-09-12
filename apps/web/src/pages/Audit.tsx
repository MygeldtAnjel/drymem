/**
 * Audit: who did what.
 *
 * Built around one sentence from the plan — *"who enabled this skill, and has
 * anyone pasted a credential this month?"* — so the credential answer is a
 * headline, not a row you have to find. Two numbers at the top, a filter that
 * defaults to everything, and a table underneath.
 *
 * Every row is an action and a target. Never content: a target names the rule
 * that fired and the project it fired in, and if a secret could reach this
 * table the audit trail would be a second copy of the secret.
 */

import { AlertTriangle, ScrollText, ShieldCheck } from "lucide-react";

import { Blank, RowsSkeleton } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AuditEvent, AuditSummary } from "@/api";
import { count, relative, when } from "@/format";

const GROUPS = [
  { key: "", label: "Everything" },
  { key: "security", label: "Security" },
  { key: "skills", label: "Skills" },
  { key: "memories", label: "Memories" },
  { key: "people", label: "People" },
  { key: "projects", label: "Projects" },
  { key: "access", label: "Access" },
];

/** The verb, in words, so the table reads as sentences rather than as keys. */
const VERBS: Record<string, string> = {
  "memory.rejected": "refused a save holding a credential",
  "memory.scrubbed": "saved a memory that had to be redacted",
  "memory.promote": "shared a memory",
  "memory.supersede": "replaced an earlier memory",
  "skill.publish": "published",
  "skill.enable": "enabled",
  "skill.disable": "removed",
  "skill.approve": "approved",
  "skill.deprecate": "deprecated",
  "skill.import": "imported",
  "skill.update": "updated",
  "skill.delete": "deleted",
  "org.create": "created the organisation",
  "user.signup": "signed up",
  "user.login": "signed in",
  "user.rename": "renamed",
  "user.password_change": "changed their password",
  "user.password_reset": "reset their password",
  "member.invite": "invited",
  "member.invite_revoke": "revoked an invitation for",
  "member.join": "joined",
  "member.add": "added",
  "member.remove": "removed",
  "member.role": "changed the role of",
  "project.create": "created",
  "project.rename": "renamed",
  "project.add_member": "added someone to",
  "project.set_role": "changed a role on",
  "project.remove_member": "removed someone from",
  "project.capture_mode": "changed what gets saved on",
  "token.create": "created an API token",
  "token.revoke": "revoked an API token",
  "session.revoke": "signed a device out",
  "device.approve": "approved a device",
};

const RISKY = new Set(["memory.rejected", "memory.scrubbed"]);

function Headline({ summary }: { summary: AuditSummary | null }) {
  if (!summary) return null;
  const { rejected, redacted } = summary.credentials;
  const clean = rejected === 0 && redacted === 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card className={clean ? "" : "border-amber-500/40"}>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-2">
            {clean ? (
              <ShieldCheck className="size-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="size-4 text-amber-500" />
            )}
            Credentials, last {summary.days} days
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">
            {clean ? "None" : `${rejected + redacted}`}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {clean
              ? "Nothing was refused and nothing had to be redacted."
              : `${count(rejected, "save")} refused · ${redacted} redacted before storing`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Events</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">{summary.total}</p>
          <p className="text-muted-foreground mt-1 text-xs">in the last {summary.days} days</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Most frequent</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.actions.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          ) : (
            <>
              <p className="truncate font-mono text-sm">{summary.actions[0]!.action}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {count(summary.actions[0]!.count, "time")} · last {relative(summary.actions[0]!.last_at)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AuditPage({
  events,
  summary,
  loading,
  busy,
  group,
  hasMore,
  onGroup,
  onMore,
}: {
  events: AuditEvent[];
  summary: AuditSummary | null;
  loading: boolean;
  busy: boolean;
  group: string;
  hasMore: boolean;
  onGroup: (group: string) => void;
  onMore: () => void;
}) {
  return (
    <div className="space-y-6">
      <Headline summary={summary} />

      <Card>
        {/* `min-w-0` on both: these are grid and flex children, whose default
            `min-width: auto` makes them refuse to shrink below their content —
            which is how six filter tabs dragged the whole card off a phone. */}
        <CardHeader className="min-w-0 gap-4">
          <div className="min-w-0">
            <CardTitle>Activity</CardTitle>
            <CardDescription>
              Every action that changed something shared. Never what was written — only that it
              happened, and by whom.
            </CardDescription>
          </div>
          <Tabs
            value={group || "all"}
            onValueChange={(v) => onGroup(v === "all" ? "" : v)}
            className="min-w-0"
          >
            {/* Six filters do not fit on a phone; the strip scrolls rather than
                shrinking the labels to nothing. */}
            <div className="min-w-0 overflow-x-auto">
              <TabsList className="w-max">
                {GROUPS.map((g) => (
                  <TabsTrigger key={g.key || "all"} value={g.key || "all"}>
                    {g.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        </CardHeader>

        <CardContent className="min-w-0">
          {loading ? (
            <RowsSkeleton rows={6} />
          ) : events.length === 0 ? (
            <Blank icon={ScrollText} title="Nothing here">
              {group
                ? "No events of this kind yet. Try another filter."
                : "The trail starts the first time somebody changes something."}
            </Blank>
          ) : (
            <>
              {/* A project key is long and a table will not wrap it, so the
                  table scrolls sideways instead of stretching the whole page. */}
              <div className="-mx-2 overflow-x-auto px-2">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[38%]">What</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead className="w-[22%]">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {RISKY.has(event.action) && (
                            <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                          )}
                          <span>{VERBS[event.action] ?? event.action}</span>
                        </div>
                        {event.target && (
                          <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                            {event.target}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {event.actor_name || event.actor || (
                          <span className="text-muted-foreground">removed account</span>
                        )}
                        {event.actor_name && event.actor && (
                          <p className="text-muted-foreground truncate text-xs">{event.actor}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm" title={when(event.created_at)}>
                        {relative(event.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>

              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <Button variant="outline" size="sm" disabled={busy} onClick={onMore}>
                    {busy ? "Loading…" : "Older"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
