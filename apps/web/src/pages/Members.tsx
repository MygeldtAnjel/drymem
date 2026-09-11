/**
 * Members: who is on this project, and who can be added.
 *
 * Two lists on purpose. The people on the project can read what it shares; the
 * people in the org who are not on it can be added with one click. Without the
 * second list, adding someone means knowing how to spell their email.
 */

import { useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";

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
import type { Member, Person } from "@/api";
import { count, when } from "@/format";

export function MembersPage({
  members,
  people,
  loading,
  busy,
  onAdd,
  onRole,
  onRemove,
}: {
  members: Member[];
  people: Person[];
  loading: boolean;
  busy: boolean;
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
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
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
              Everyone in your organisation is already on this project. New people are created
              with <code className="font-mono text-xs">drymem-admin user-create</code>.
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
