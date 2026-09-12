/**
 * Members: who is on this project, and who can be added.
 *
 * Two lists on purpose. The people on the project can read what it shares; the
 * people in the org who are not on it can be added with one click. Without the
 * second list, adding someone means knowing how to spell their email.
 */

import { useEffect, useState } from "react";
import { Copy, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Blank, RowsSkeleton } from "@/components/Bits";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { auth, type Invite, type Member, type Person } from "@/api";
import { count, relative, when } from "@/format";

export function MembersPage({
  members,
  people,
  loading,
  busy,
  isAdmin,
  projectKey,
  onAdd,
  onRole,
  onRemove,
}: {
  members: Member[];
  people: Person[];
  loading: boolean;
  busy: boolean;
  isAdmin: boolean;
  projectKey: string;
  onAdd: (email: string) => void;
  onRole: (email: string, role: string) => void;
  onRemove: (email: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const onProject = new Set(members.map((m) => m.email));
  const others = people.filter((p) => !onProject.has(p.email));
  const last = members.length <= 1;

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && <InviteCard projectKey={projectKey} />}

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-sm">On this project</CardTitle>
          <CardDescription>
            They can read every memory shared with the project. Private memories stay private —
            sharing is always a separate, deliberate act by the author.
          </CardDescription>
        </CardHeader>
        {loading ? (
          <RowsSkeleton rows={3} />
        ) : members.length === 0 ? (
          <Blank icon={Users} title="Nobody on this project">
            That should not happen — a project always keeps at least one member.
          </Blank>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-40">Role</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.user_id}>
                  <TableCell className="font-medium">{member.email}</TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      onValueChange={(role) => onRole(member.email, role)}
                      disabled={busy}
                    >
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${member.email}`}
                      disabled={busy || last}
                      title={last ? "A project must keep at least one member" : undefined}
                      onClick={() => setConfirm(member.email)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-sm">Everyone else in your organisation</CardTitle>
          <CardDescription>
            Add someone and they see this project’s shared memories straight away.
          </CardDescription>
        </CardHeader>
        {others.length === 0 ? (
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              Everyone in your organisation is already on this project. Invite someone new above
              and they will appear here.
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Memories</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {others.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="font-medium">{person.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {person.name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {person.memory_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onAdd(person.email)}>
                      <UserPlus data-icon="inline-start" /> Add
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {count(members.length, "member")} on this project · {count(people.length, "person", "people")} in the organisation
        </p>
      </Card>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirm} from this project?</DialogTitle>
            <DialogDescription>
              They lose access to everything shared here. Their own memories stay theirs, and
              nothing they wrote is deleted. You can add them back at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm) onRemove(confirm);
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

/**
 * Invite someone who is not in the organisation yet.
 *
 * The link is shown to the admin rather than emailed: on a laptop there is no
 * mail server, and a link you can paste into Slack beats an email that never
 * left. When SMTP is configured the server will send it as well.
 */
function InviteCard({ projectKey }: { projectKey: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [toProject, setToProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<Invite | null>(null);
  const [pending, setPending] = useState<Invite[]>([]);

  const refresh = () => auth.invites().then(setPending).catch(() => setPending([]));
  useEffect(() => {
    void refresh();
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await auth.invite({
        email: email.trim(),
        role,
        project_key: toProject ? projectKey : null,
      });
      setLink(created);
      setEmail("");
      toast.success(`Invitation created for ${created.email}`, {
        description: "Copy the link and send it to them. It works once and expires in 7 days.",
      });
      void refresh();
    } catch (err) {
      toast.error("Could not invite", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy — select the link and copy it by hand.");
    }
  };

  const revoke = async (invite: Invite) => {
    try {
      await auth.revokeInvite(invite.id);
      toast.success(`Invitation for ${invite.email} revoked`);
      void refresh();
      if (link?.id === invite.id) setLink(null);
    } catch (err) {
      toast.error("Could not revoke", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="text-sm">Invite someone</CardTitle>
        <CardDescription>
          They get a link, choose a password, and are in. No self-service sign-up exists — every
          account on this server was invited by an admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={send}>
          <div className="min-w-56 flex-1">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              aria-label="Email to invite"
              required
            />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-36" aria-label="Organisation role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={toProject}
              onChange={(e) => setToProject(e.target.checked)}
              className="accent-primary"
            />
            Add to this project
          </label>
          <Button type="submit" disabled={busy || !email.trim()}>
            <Mail data-icon="inline-start" /> {busy ? "Creating…" : "Create invitation"}
          </Button>
        </form>

        {link?.invite_url && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm">
              Send this to <span className="font-medium">{link.email}</span>:
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link.invite_url} className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => copy(link.invite_url!)}>
                <Copy data-icon="inline-start" /> Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Shown once. It works one time and expires {relative(link.expires_at).replace("ago", "from now")}.
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">Waiting to be accepted</p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {pending.map((invite) => (
                <li key={invite.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                  <span className="text-xs text-muted-foreground">{invite.role}</span>
                  <span className="text-xs text-muted-foreground">
                    expires {when(invite.expires_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke invitation for ${invite.email}`}
                    onClick={() => revoke(invite)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The org-wide people list, shown on its own tab of the same screen. */
export function PeopleTable({ people }: { people: Person[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Memories</TableHead>
          <TableHead className="text-right">Projects</TableHead>
          <TableHead className="text-right">Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map((person) => (
          <TableRow key={person.id}>
            <TableCell className="font-medium">{person.email}</TableCell>
            <TableCell className="text-muted-foreground">{person.name ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{person.memory_count}</TableCell>
            <TableCell className="text-right tabular-nums">{person.project_count}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {when(person.created_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
