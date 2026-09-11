import { Check, ChevronsUpDown, FolderGit2 } from "lucide-react";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { Project } from "@/api";
import { go } from "@/router";

export function ProjectSwitcher({
  projects,
  active,
  onChange,
}: {
  projects: Project[];
  active: string;
  onChange: (key: string) => void;
}) {
  const current = projects.find((p) => p.project_key === active);
  const label = current?.display_name ?? active ?? "No project";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-[min(22rem,60vw)]">
          <FolderGit2 data-icon="inline-start" />
          <span className="truncate">{label}</span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[min(28rem,90vw)]">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuGroup>
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => onChange(project.project_key)}
              className="justify-between gap-4"
            >
              <span className="truncate">{project.display_name ?? project.project_key}</span>
              {project.project_key === active && (
                <Check className="shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
          {projects.length === 0 && (
            <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => go("projects")}>Manage projects</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
