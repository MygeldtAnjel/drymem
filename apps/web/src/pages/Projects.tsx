/**
 * Projects: every repository this org has memory for.
 *
 * The key is the normalised git remote and is never editable — it is how two
 * people cloning the same repo end up in the same memory, and changing it
 * would split a team in half. The display name is editable, because
 * "github.com/acme/payments-service-v2" is not what anyone calls it.
 */

import { useState } from "react";
import { Check, FolderGit2, Pencil, X } from "lucide-react";

import { Blank, RowsSkeleton } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Project } from "@/api";
import { ratio } from "@/format";

export function ProjectsPage({
  projects,
  active,
  loading,
  busy,
  onOpen,
  onRename,
}: {
  projects: Project[];
  active: string;
  loading: boolean;
  busy: boolean;
  onOpen: (key: string) => void;
  onRename: (key: string, name: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (loading) {
    return (
      <Card className="p-0">
        <RowsSkeleton rows={3} />
      </Card>
    );
  }

  if (projects.length === 0) {
    return (
      <Blank icon={FolderGit2} title="No projects yet">
        A project is created automatically the first time an agent saves a memory in a
        repository. Run <code className="font-mono">drymem setup</code> in one to start.
      </Blank>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="text-sm">All projects</CardTitle>
        <CardDescription>
          The key is the repository’s git remote and cannot be changed — it is what makes two
          people working on the same repo share one memory.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead className="text-right">Memories</TableHead>
            <TableHead className="text-right">Useful</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => {
            const useful = ratio(project.positive, project.negative);
            const isEditing = editing === project.project_key;
            return (
              <TableRow key={project.id}>
                <TableCell className="max-w-xs">
                  {isEditing ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        onRename(project.project_key, draft);
                        setEditing(null);
                      }}
                    >
                      <Input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Payments"
                        aria-label="Display name"
                        className="h-8"
                      />
                      <Button type="submit" size="icon-sm" aria-label="Save" disabled={busy}>
                        <Check />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Cancel"
                        onClick={() => setEditing(null)}
                      >
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <button
                      className="flex w-full items-center gap-2 text-left"
                      onClick={() => onOpen(project.project_key)}
                    >
                      <span className="truncate font-medium">
                        {project.display_name ?? project.project_key.split("/").pop()}
                      </span>
                      {project.project_key === active && (
                        <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Open
                        </span>
                      )}
                    </button>
                  )}
                </TableCell>
                <TableCell className="max-w-xs">
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {project.project_key}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{project.memory_count}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {useful ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Rename ${project.project_key}`}
                      onClick={() => {
                        setEditing(project.project_key);
                        setDraft(project.display_name ?? "");
                      }}
                    >
                      <Pencil />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
