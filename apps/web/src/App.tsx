/**
 * The app: data loading, routing, and every action the UI can take.
 *
 * All server state lives here and is passed down, so a page is a pure view of
 * props. That is on purpose — it means a page can be read to find out what a
 * screen shows, and this file can be read to find out what the product does.
 *
 * Every action that reaches the server ends in a toast, success or failure.
 * A silent success is indistinguishable from a click that did nothing, and
 * that is the fastest way for an admin screen to lose someone's trust.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import {
  ApiError,
  api,
  auth,
  rememberProject,
  rememberedProject,
  type AgentSession,
  type Cluster,
  type Episode,
  type Fact,
  type Health,
  type Me,
  type Member,
  type MemorySchema,
  type Overview,
  type Person,
  type Project,
  type Session,
  type Skill,
} from "./api";
import { AcceptInvite, ApproveDevice, ForgotPassword, ResetPassword } from "@/pages/Gate";
import { Shell } from "@/components/Shell";
import { Blank } from "@/components/Bits";
import { MemoriesPage, MemoryDetail } from "@/pages/Memories";
import { MembersPage } from "@/pages/Members";
import { OverviewPage } from "@/pages/Overview";
import { ProjectsPage } from "@/pages/Projects";
import { SessionsPage } from "@/pages/Sessions";
import { SkillsPage, type Draft } from "@/pages/Skills";
import { SettingsPage } from "@/pages/Settings";
import { SignIn } from "./SignIn";
import { go, useRoute } from "./router";
import { SearchX } from "lucide-react";

const TITLES: Record<string, { title: string; description?: string }> = {
  overview: {
    title: "Overview",
    description: "What this project has learned, and whether everything is running.",
  },
  memories: {
    title: "Memories",
    description: "Everything your agents have written down, newest first.",
  },
  sessions: {
    title: "Sessions",
    description: "The agent runs that produced those memories.",
  },
  skills: {
    title: "Skills",
    description: "Turn what the team keeps re-learning into a skill every agent installs.",
  },
  projects: {
    title: "Projects",
    description: "Every repository this organisation has memory for.",
  },
  members: {
    title: "Members",
    description: "Who can read what this project shares.",
  },
  settings: {
    title: "Settings",
    description: "You, this project, and where the data lives.",
  },
};

export function App() {
  const route = useRoute();
  // `undefined` = not asked yet; `null` = asked, nobody signed in.
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    auth
      .session()
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  const signedIn = (s: Session) => {
    setSession(s);
    // A device approval interrupted by sign-in resumes where it was going.
    let after: string | null = null;
    try {
      after = sessionStorage.getItem("drymem.after");
      sessionStorage.removeItem("drymem.after");
    } catch {
      /* nothing to resume */
    }
    // Every door leads to Overview once it is open. Checking only for the
    // sign-in page left a freshly accepted invite sitting on the invite form,
    // signed in, with nothing to say so.
    if (after) window.location.hash = `#/${after}`;
    else go("overview");
  };

  const signedOut = () => {
    setSession(null);
    go("signin");
  };

  if (session === undefined) return null;

  if (route.page === "invite" && route.id) {
    return <AcceptInvite token={route.id} onDone={signedIn} />;
  }
  if (route.page === "device" && route.id) {
    return <ApproveDevice code={route.id} session={session} />;
  }
  if (route.page === "forgot") return <ForgotPassword />;
  if (route.page === "reset" && route.id) {
    return <ResetPassword token={route.id} onDone={signedIn} />;
  }
  if (session === null) return <SignIn onDone={signedIn} />;

  return (
    <TooltipProvider delayDuration={200}>
      <Workspace session={session} onSignOut={signedOut} />
      <Toaster position="bottom-right" theme="dark" richColors closeButton />
    </TooltipProvider>
  );
}

function Workspace({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const route = useRoute();

  const [me, setMe] = useState<Me | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [schema, setSchema] = useState<MemorySchema | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState("");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [stats, setStats] = useState<Overview | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [drafting, setDrafting] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<{ kind: "skill" | "draft"; key: string } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(() => {
    void auth.logout().catch(() => {});
    onSignOut();
  }, [onSignOut]);

  /** Any 401 means the token died under us; everything else is worth reading. */
  const fail = useCallback(
    (error: unknown, what: string) => {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        return;
      }
      toast.error(`${what} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    [signOut],
  );

  useEffect(() => {
    Promise.all([api.me(), api.health().catch(() => null), api.schema().catch(() => null)])
      .then(([who, status, shape]) => {
        setMe(who);
        setHealth(status);
        setSchema(shape);
      })
      .catch((e) => fail(e, "Signing in"));
  }, [fail]);

  useEffect(() => {
    api
      .projects()
      .then((list) => {
        setProjects(list);
        setActive((current) => {
          if (current) return current;
          const remembered = rememberedProject();
          const known = list.find((p) => p.project_key === remembered);
          return known?.project_key ?? list[0]?.project_key ?? "";
        });
      })
      .catch((e) => fail(e, "Loading projects"));
  }, [fail]);

  /**
   * Everything for a project, in one pass.
   *
   * `discover` runs a graph query that can be slow on a big project, so it is
   * allowed to fail on its own without taking the screen down with it — an
   * empty suggestions panel is a much better outcome than an error page.
   */
  const load = useCallback(
    async (projectKey: string) => {
      if (!projectKey) return;
      setLoading(true);
      try {
        const [context, overview, sessionList, skillList, memberList, personList] =
          await Promise.all([
            api.context(projectKey, 100),
            api.overview(projectKey).catch(() => null),
            api.sessions(projectKey).catch(() => []),
            api.skills(projectKey).catch(() => []),
            api.members(projectKey).catch(() => []),
            api.people().catch(() => []),
          ]);
        setEpisodes(context);
        setStats(overview);
        setSessions(sessionList);
        setSkills(skillList);
        setMembers(memberList);
        setPeople(personList);
        api.discover(projectKey).then(setClusters).catch(() => setClusters([]));
      } catch (e) {
        fail(e, "Loading this project");
      } finally {
        setLoading(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    setFacts(null);
    setDrafts({});
    void load(active);
  }, [active, load]);

  const chooseProject = (key: string) => {
    setActive(key);
    rememberProject(key);
  };

  // ---- actions ------------------------------------------------------------

  const act = async (what: string, run: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const message = await run();
      if (message) toast.success(message);
    } catch (e) {
      fail(e, what);
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    try {
      setFacts(await api.search(active, trimmed, 30));
    } catch (e) {
      fail(e, "Search");
    } finally {
      setSearching(false);
    }
  };

  const patchEpisode = (uuid: string, patch: Partial<Episode>) =>
    setEpisodes((list) => list.map((e) => (e.uuid === uuid ? { ...e, ...patch } : e)));

  const rate = (episode: Episode, rating: 1 | -1) =>
    act("Rating", async () => {
      await api.rate(episode.uuid, rating, facts ? query.trim() : "");
      patchEpisode(episode.uuid, { rating });
      return rating > 0 ? "Marked useful" : "Marked not useful";
    });

  const promote = (episode: Episode) =>
    act("Sharing", async () => {
      await api.promote(episode.uuid);
      patchEpisode(episode.uuid, { scope: "team", promoted_at: new Date().toISOString() });
      void api.overview(active).then(setStats).catch(() => {});
      return "Shared with the project";
    });

  const remove = (episode: Episode) =>
    act("Deleting", async () => {
      await api.remove(episode.uuid);
      setEpisodes((list) => list.filter((e) => e.uuid !== episode.uuid));
      go("memories");
      void api.overview(active).then(setStats).catch(() => {});
      return "Memory deleted";
    });

  const draftSkill = async (topic: string) => {
    setDrafting(topic);
    try {
      const draft = await api.distill(active, topic);
      setDrafts((d) => ({ ...d, [topic]: draft }));
      toast.success(`Drafted “${draft.name}”`, {
        description: `Written from ${draft.memory_count} memories by ${draft.model}. Read it before publishing.`,
      });
    } catch (e) {
      fail(e, "Drafting");
    } finally {
      setDrafting(null);
    }
  };

  const publishSkill = (topic: string) =>
    act("Publishing", async () => {
      const draft = drafts[topic];
      if (!draft) return;
      const saved = await api.publishSkill({
        project_key: active,
        name: draft.name,
        topic,
        content: draft.content,
        model: draft.model,
        memory_count: draft.memory_count,
      });
      setSkills((list) => [saved, ...list.filter((s) => s.name !== saved.name)]);
      return `Published ${saved.name} to the team`;
    });

  const unpublishSkill = (name: string) =>
    act("Unpublishing", async () => {
      await api.removeSkill(active, name);
      setSkills((list) => list.filter((s) => s.name !== name));
      return `${name} unpublished`;
    });

  const addMember = (email: string) =>
    act("Adding", async () => {
      setMembers(await api.addMember(active, email));
      return `${email} added to this project`;
    });

  const setRole = (email: string, role: string) =>
    act("Changing the role", async () => {
      setMembers(await api.setMemberRole(active, email, role));
      return `${email} is now ${role === "admin" ? "an admin" : "a member"}`;
    });

  const removeMember = (email: string) =>
    act("Removing", async () => {
      setMembers(await api.removeMember(active, email));
      return `${email} removed from this project`;
    });

  const renameMe = (name: string) =>
    act("Saving", async () => {
      setMe(await api.renameMe(name));
      return name ? `You are now shown as ${name}` : "Display name cleared";
    });

  const renameProject = (key: string, name: string) =>
    act("Renaming", async () => {
      const updated = await api.renameProject(key, name);
      setProjects((list) =>
        list.map((p) => (p.project_key === key ? { ...p, display_name: updated.display_name } : p)),
      );
      return name ? `Renamed to ${name}` : "Name cleared";
    });

  /** Clipboard access can be refused; saying so beats a button that does nothing. */
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied the ${what}`);
    } catch {
      toast.error(`Could not copy the ${what}`, {
        description: "Your browser refused clipboard access. Select the text and copy it.",
      });
    }
  };

  const project = useMemo(
    () => projects.find((p) => p.project_key === active),
    [projects, active],
  );

  const openMemory = route.page === "memories" && route.id
    ? episodes.find((e) => e.uuid === route.id)
    : undefined;

  const meta = TITLES[route.page] ?? TITLES.overview!;
  // On a memory's own page the card already carries the title; repeating it in
  // the page heading printed the same sentence twice, one line apart.
  const heading =
    openMemory !== undefined ? { title: "Memory", description: undefined } : meta;

  return (
    <Shell
      route={route}
      me={me}
      projects={projects}
      activeProject={active}
      onProject={chooseProject}
      onSignOut={signOut}
      title={heading.title}
      description={heading.description}
    >
      <Screen
        route={route}
        openMemory={openMemory}
        session={session}
        isAdmin={session.role === "owner" || session.role === "admin"}
        loading={loading}
        busy={busy}
        active={active}
        project={project}
        me={me}
        health={health}
        schema={schema}
        stats={stats}
        episodes={episodes}
        sessions={sessions}
        skills={skills}
        clusters={clusters}
        people={people}
        members={members}
        projects={projects}
        facts={facts}
        query={query}
        searching={searching}
        drafts={drafts}
        drafting={drafting}
        openSkill={openSkill}
        setOpenSkill={setOpenSkill}
        setQuery={setQuery}
        onSearch={search}
        onClearSearch={() => setFacts(null)}
        onRate={rate}
        onPromote={promote}
        onDelete={remove}
        onDraft={draftSkill}
        onPublish={publishSkill}
        onUnpublish={unpublishSkill}
        onAddMember={addMember}
        onRole={setRole}
        onRemoveMember={removeMember}
        onRenameMe={renameMe}
        onRenameProject={renameProject}
        onChooseProject={chooseProject}
        onSignOut={signOut}
        onCopy={copy}
      />
    </Shell>
  );
}

function Screen(props: {
  route: { page: string; id: string };
  openMemory?: Episode;
  session: Session;
  isAdmin: boolean;
  loading: boolean;
  busy: boolean;
  active: string;
  project?: Project;
  me: Me | null;
  health: Health | null;
  schema: MemorySchema | null;
  stats: Overview | null;
  episodes: Episode[];
  sessions: AgentSession[];
  skills: Skill[];
  clusters: Cluster[];
  people: Person[];
  members: Member[];
  projects: Project[];
  facts: Fact[] | null;
  query: string;
  searching: boolean;
  drafts: Record<string, Draft>;
  drafting: string | null;
  openSkill: { kind: "skill" | "draft"; key: string } | null;
  setOpenSkill: (v: { kind: "skill" | "draft"; key: string } | null) => void;
  setQuery: (v: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onRate: (episode: Episode, rating: 1 | -1) => void;
  onPromote: (episode: Episode) => void;
  onDelete: (episode: Episode) => void;
  onDraft: (topic: string) => void;
  onPublish: (topic: string) => void;
  onUnpublish: (name: string) => void;
  onAddMember: (email: string) => void;
  onRole: (email: string, role: string) => void;
  onRemoveMember: (email: string) => void;
  onRenameMe: (name: string) => void;
  onRenameProject: (key: string, name: string) => void;
  onChooseProject: (key: string) => void;
  onSignOut: () => void;
  onCopy: (text: string, what: string) => void;
}) {
  const { route } = props;

  if (route.page === "memories" && route.id) {
    if (props.loading) return null;
    if (!props.openMemory) {
      return (
        <Blank icon={SearchX} title="That memory is not here">
          It may have been deleted, or it belongs to a different project.
        </Blank>
      );
    }
    return (
      <MemoryDetail
        episode={props.openMemory}
        projectKey={props.active}
        busy={props.busy}
        onRate={(rating) => props.onRate(props.openMemory!, rating)}
        onPromote={() => props.onPromote(props.openMemory!)}
        onDelete={() => props.onDelete(props.openMemory!)}
      />
    );
  }

  switch (route.page) {
    case "memories":
      return (
        <MemoriesPage
          episodes={props.episodes}
          loading={props.loading}
          facts={props.facts}
          searching={props.searching}
          query={props.query}
          onQuery={props.setQuery}
          onSearch={props.onSearch}
          onClearSearch={props.onClearSearch}
        />
      );
    case "sessions":
      return <SessionsPage sessions={props.sessions} loading={props.loading} />;
    case "skills":
      return (
        <SkillsPage
          skills={props.skills}
          clusters={props.clusters}
          drafts={props.drafts}
          drafting={props.drafting}
          busy={props.busy}
          onDraft={props.onDraft}
          onPublish={props.onPublish}
          onUnpublish={props.onUnpublish}
          open={props.openSkill}
          onOpen={props.setOpenSkill}
        />
      );
    case "projects":
      return (
        <ProjectsPage
          projects={props.projects}
          active={props.active}
          loading={props.loading}
          busy={props.busy}
          onOpen={props.onChooseProject}
          onRename={props.onRenameProject}
        />
      );
    case "members":
      return (
        <MembersPage
          members={props.members}
          people={props.people}
          loading={props.loading}
          busy={props.busy}
          isAdmin={props.isAdmin}
          projectKey={props.active}
          onAdd={props.onAddMember}
          onRole={props.onRole}
          onRemove={props.onRemoveMember}
        />
      );
    case "settings":
      return (
        <SettingsPage
          me={props.me}
          session={props.session}
          health={props.health}
          schema={props.schema}
          project={props.project}
          busy={props.busy}
          onRenameMe={props.onRenameMe}
          onRenameProject={props.onRenameProject}
          onSignOut={props.onSignOut}
          onCopy={props.onCopy}
        />
      );
    default:
      return (
        <OverviewPage
          stats={props.stats}
          health={props.health}
          recent={props.episodes}
          loading={props.loading}
        />
      );
  }
}
