/**
 * The frame: a rail of destinations, a header that says where you are, and one
 * scrolling column of content.
 *
 * Built on shadcn's Sidebar so the behaviour people expect is the behaviour
 * they get — it collapses to icons on a laptop, becomes a sheet on a phone,
 * remembers its state, and handles the focus trap. None of that is worth
 * hand-writing, and hand-written versions are where admin UIs usually break.
 */

import {
  Boxes,
  FolderGit2,
  LayoutDashboard,
  MessagesSquare,
  Network,
  NotebookPen,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { CatMark } from "./Logo";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { UserMenu } from "./UserMenu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./ui/sidebar";
import { Separator } from "./ui/separator";
import { isAdmin, type Me, type Project } from "@/api";
import { go, type Route } from "@/router";

type Destination = {
  page: string;
  label: string;
  icon: LucideIcon;
  /** Offered only to an owner or an admin — the API refuses everyone else. */
  adminOnly?: boolean;
};

export const WORK: Destination[] = [
  { page: "overview", label: "Overview", icon: LayoutDashboard },
  { page: "memories", label: "Memories", icon: NotebookPen },
  { page: "chat", label: "Chat", icon: MessagesSquare },
  { page: "graph", label: "Decisions", icon: Network },
  { page: "sessions", label: "Sessions", icon: Boxes },
  { page: "skills", label: "Skills", icon: Sparkles },
];

export const ADMIN: Destination[] = [
  { page: "projects", label: "Projects", icon: FolderGit2 },
  { page: "members", label: "Members", icon: Users },
  { page: "audit", label: "Audit", icon: ScrollText, adminOnly: true },
  { page: "settings", label: "Settings", icon: Settings },
];

/** What this person is actually allowed to open. */
export const destinationsFor = (items: Destination[], me: Me | null): Destination[] =>
  items.filter((item) => !item.adminOnly || isAdmin(me));

export function Shell({
  route,
  me,
  projects,
  activeProject,
  onProject,
  onSignOut,
  title,
  description,
  actions,
  children,
}: {
  route: Route;
  me: Me | null;
  projects: Project[];
  activeProject: string;
  onProject: (key: string) => void;
  onSignOut: () => void;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const group = (label: string, items: Destination[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ page, label: text, icon: Icon }) => (
            <SidebarMenuItem key={page}>
              <SidebarMenuButton
                isActive={route.page === page}
                onClick={() => go(page)}
                tooltip={text}
              >
                <Icon />
                <span>{text}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => go("overview")} tooltip="drymem">
                <CatMark className="size-6 shrink-0 text-foreground" />
                <span className="text-[15px] font-semibold tracking-tight">drymem</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {group("Workspace", WORK)}
          {group("Administration", destinationsFor(ADMIN, me))}
        </SidebarContent>

        <SidebarFooter>
          <UserMenu me={me} onSignOut={onSignOut} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <ProjectSwitcher projects={projects} active={activeProject} onChange={onProject} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
            {/* A detail page carries its own name in a breadcrumb; printing
                "Skills" above "Skills / miguel / graphiti" says it twice. */}
            {title && (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                  {description && (
                    <p className="text-muted-foreground mt-1 text-sm">{description}</p>
                  )}
                </div>
                {actions && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
