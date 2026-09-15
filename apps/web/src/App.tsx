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
  type AuditEvent,
  type AuditSummary,
  type CatalogueSkill,
  type Project,
  type Session,
  type Skill,
  type SkillVersion,
} from "./api";
import {
  AcceptInvite,
  ApproveDevice,
  ForgotPassword,
  ResetPassword,
} from "@/pages/Gate";
import { Shell } from "@/components/Shell";
import { Blank } from "@/components/Bits";
import { MemoriesPage, MemoryDetail } from "@/pages/Memories";
import { MembersPage } from "@/pages/Members";
import { OverviewPage } from "@/pages/Overview";
import { ProjectsPage } from "@/pages/Projects";
import { SessionPage, SessionsPage } from "@/pages/Sessions";
import { ChatPage } from "@/pages/Chat";
import { GraphPage } from "@/pages/Graph";
import { SkillsPage, type Draft } from "@/pages/Skills";
import { SkillPage } from "@/pages/Skill";
import { AuditPage } from "@/pages/Audit";
import { SettingsPage } from "@/pages/Settings";
import { count } from "./format";
import { SignIn } from "./SignIn";
import { go, useRoute } from "./router";
import { SearchX } from "lucide-react";

const TITLES: Record<string, { title: string; description?: string }> = {
  overview: {
    title: "Overview",
    description:
      "What this project has learned, and whether everything is running.",
  },
  memories: {
    title: "Memories",
    description: "Everything your agents have written down, newest first.",
  },
  chat: {
    title: "Chat",
    description:
      "Ask this project anything. Every claim points at a memory you can open.",
  },
  graph: {
    title: "Decisions",
    description: "What was decided, and where it landed.",
  },
  audit: {
    title: "Audit",
    description:
      "Who did what, and whether a credential has gone anywhere it should not.",
  },
  sessions: {
    title: "Sessions",
    description: "The agent runs that produced those memories.",
  },
  skills: {
    title: "Skills",
    description:
      "Turn what the team keeps re-learning into a skill every agent installs.",
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

function Workspace({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => void;
}) {
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
  const [catalogue, setCatalogue] = useState<CatalogueSkill[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [auditGroup, setAuditGroup] = useState("");
  const [auditBefore, setAuditBefore] = useState<number | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [hits, setHits] = useState<Episode[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [drafting, setDrafting] = useState<string | null>(null);

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
    Promise.all([
      api.me(),
      api.health().catch(() => null),
      api.schema().catch(() => null),
    ])
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
        const [
          context,
          overview,
          sessionList,
          enabled,
          wholeCatalogue,
          memberList,
          personList,
        ] = await Promise.all([
          api.context(projectKey, 100),
          api.overview(projectKey).catch(() => null),
          api.sessions(projectKey).catch(() => []),
          api.skills(projectKey).catch(() => []),
          api.catalogue(projectKey).catch(() => []),
          api.members(projectKey).catch(() => []),
          api.people().catch(() => []),
        ]);
        setEpisodes(context);
        setStats(overview);
        setSessions(sessionList);
        setSkills(enabled);
        setCatalogue(wholeCatalogue);
        setMembers(memberList);
        setPeople(personList);
        api
          .discover(projectKey)
          .then(setClusters)
          .catch(() => setClusters([]));
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
    setHits(null);
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
      const found = await api.search(active, trimmed, 30);
      setHits(found.memories);
      setFacts(found.facts);
    } catch (e) {
      fail(e, "Search");
    } finally {
      setSearching(false);
    }
  };

  const patchEpisode = (uuid: string, patch: Partial<Episode>) =>
    setEpisodes((list) =>
      list.map((e) => (e.uuid === uuid ? { ...e, ...patch } : e)),
    );

  const rate = (episode: Episode, rating: 1 | -1) =>
    act("Rating", async () => {
      await api.rate(episode.uuid, rating, facts ? query.trim() : "");
      patchEpisode(episode.uuid, { rating });
      return rating > 0 ? "Marked useful" : "Marked not useful";
    });

  const promote = (episode: Episode) =>
    act("Sharing", async () => {
      await api.promote(episode.uuid);
      patchEpisode(episode.uuid, {
        scope: "team",
        promoted_at: new Date().toISOString(),
      });
      void api
        .overview(active)
        .then(setStats)
        .catch(() => {});
      return "Shared with the project";
    });

  const remove = (episode: Episode) =>
    act("Deleting", async () => {
      await api.remove(episode.uuid);
      setEpisodes((list) => list.filter((e) => e.uuid !== episode.uuid));
      go("memories");
      void api
        .overview(active)
        .then(setStats)
        .catch(() => {});
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

  /**
   * The audit trail is loaded on demand, not with the rest of the project.
   * It is admin-only and most sessions never open it, so fetching it eagerly
   * would be one 403 per sign-in for every member of the team.
   */
  const loadAudit = async (group: string, before: number | null = null) => {
    setAuditLoading(true);
    try {
      const [page, summary] = await Promise.all([
        api.audit({ group: group || undefined, before: before ?? undefined }),
        before
          ? Promise.resolve(auditSummary)
          : api.auditSummary(30).catch(() => null),
      ]);
      setAuditEvents((current) =>
        before ? [...current, ...page.events] : page.events,
      );
      setAuditBefore(page.next_before);
      if (!before) setAuditSummary(summary);
    } catch (e) {
      fail(e, "Loading the audit trail");
    } finally {
      setAuditLoading(false);
    }
  };

  const chooseAuditGroup = (group: string) => {
    setAuditGroup(group);
    setAuditEvents([]);
    void loadAudit(group);
  };

  useEffect(() => {
    if (route.page !== "audit") return;
    void loadAudit(auditGroup);
    // Re-reading on every filter change is handled by chooseAuditGroup; this is
    // only the first open of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.page]);

  /** Reload just the two skill lists, after anything that changes them. */
  const refreshSkills = async () => {
    const [enabled, all] = await Promise.all([
      api.skills(active).catch(() => []),
      api.catalogue(active).catch(() => []),
    ]);
    setSkills(enabled);
    setCatalogue(all);
  };

  const publishSkill = (topic: string) =>
    act("Publishing", async () => {
      const draft = drafts[topic];
      if (!draft) return;
      const saved = await api.publishSkill({
        name: draft.name,
        topic,
        content: draft.content,
        model: draft.model,
        memory_count: draft.memory_count,
        source: "distilled",
        project_key: active,
      });
      await refreshSkills();
      // A held version is not an installed one, and saying "published" would be
      // a lie the person only discovers when nothing appears on their machine.
      return saved.state === "pending"
        ? `${saved.name} is held for review — an admin has to approve it`
        : `Published ${saved.name}@${saved.version} and enabled it here`;
    });

  const enableSkill = (name: string, version?: number) =>
    act("Enabling", async () => {
      const enabled = await api.enableSkill(name, active, version);
      await refreshSkills();
      return `${enabled.name}@${enabled.version} is on this project — commit .drymem/skills.lock`;
    });

  const disableSkill = (name: string) =>
    act("Removing", async () => {
      await api.disableSkill(name, active);
      await refreshSkills();
      return `${name} removed — commit .drymem/skills.lock`;
    });

  const approveSkill = (name: string) =>
    act("Approving", async () => {
      await api.approveSkill(name);
      await refreshSkills();
      return `${name} approved; projects can enable it now`;
    });

  const deprecateSkill = (name: string) =>
    act("Deprecating", async () => {
      const result = await api.deprecateSkill(name);
      await refreshSkills();
      return result.still_enabled_in > 0
        ? `${name} deprecated — still enabled in ${count(result.still_enabled_in, "project")}`
        : `${name} deprecated`;
    });

  const skillVersions = (name: string): Promise<SkillVersion[]> =>
    api.skillVersions(name).catch(() => []);

  // The skill page asks for its own versions on mount. Held here so a second
  // visit to the same skill paints from what is already loaded.
  const [versionsFor, setVersionsFor] = useState<
    Record<string, SkillVersion[]>
  >({});
  const loadVersions = useCallback((name: string) => {
    api
      .skillVersions(name)
      .then((list) =>
        setVersionsFor((current) => ({ ...current, [name]: list })),
      )
      .catch(() => setVersionsFor((current) => ({ ...current, [name]: [] })));
  }, []);

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

  const setCaptureMode = (key: string, mode: string) =>
    act("Changing what gets saved", async () => {
      const updated = await api.setCaptureMode(key, mode);
      setProjects((list) =>
        list.map((p) =>
          p.project_key === key
            ? { ...p, capture_mode: updated.capture_mode }
            : p,
        ),
      );
      return mode === "automatic"
        ? "Agents will save a private summary automatically"
        : mode === "ask"
          ? "Agents will ask before saving"
          : "Nothing saves unless you run drymem save-session";
    });

  const renameProject = (key: string, name: string) =>
    act("Renaming", async () => {
      const updated = await api.renameProject(key, name);
      setProjects((list) =>
        list.map((p) =>
          p.project_key === key
            ? { ...p, display_name: updated.display_name }
            : p,
        ),
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
        description:
          "Your browser refused clipboard access. Select the text and copy it.",
      });
    }
  };

  const project = useMemo(
    () => projects.find((p) => p.project_key === active),
    [projects, active],
  );

  const openMemory =
    route.page === "memories" && route.id
      ? episodes.find((e) => e.uuid === route.id)
      : undefined;

  const meta = TITLES[route.page] ?? TITLES.overview!;
  // On a memory's own page the card already carries the title; repeating it in
  // the page heading printed the same sentence twice, one line apart.
  // Detail pages print their own trail, so the shell heading steps aside.
  const onDetail =
    openMemory !== undefined ||
    (route.page === "skills" && Boolean(route.id)) ||
    (route.page === "sessions" && Boolean(route.id));
  const heading = onDetail ? { title: "", description: undefined } : meta;

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
        catalogue={catalogue}
        auditEvents={auditEvents}
        auditSummary={auditSummary}
        auditGroup={auditGroup}
        auditLoading={auditLoading}
        auditHasMore={auditBefore !== null}
        onAuditGroup={chooseAuditGroup}
        onAuditMore={() => void loadAudit(auditGroup, auditBefore)}
        clusters={clusters}
        people={people}
        members={members}
        projects={projects}
        facts={facts}
        hits={hits}
        query={query}
        searching={searching}
        drafts={drafts}
        drafting={drafting}
        setQuery={setQuery}
        onSearch={search}
        onClearSearch={() => {
          setFacts(null);
          setHits(null);
        }}
        onRate={rate}
        onPromote={promote}
        onDelete={remove}
        onDraft={draftSkill}
        onPublish={publishSkill}
        onEnable={enableSkill}
        onDisable={disableSkill}
        onApprove={approveSkill}
        onDeprecate={deprecateSkill}
        onVersions={skillVersions}
        versionsFor={versionsFor}
        onLoadVersions={loadVersions}
        onAddMember={addMember}
        onRole={setRole}
        onRemoveMember={removeMember}
        onRenameMe={renameMe}
        onRenameProject={renameProject}
        onCaptureMode={setCaptureMode}
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
  catalogue: CatalogueSkill[];
  auditEvents: AuditEvent[];
  auditSummary: AuditSummary | null;
  auditGroup: string;
  auditLoading: boolean;
  auditHasMore: boolean;
  onAuditGroup: (group: string) => void;
  onAuditMore: () => void;
  clusters: Cluster[];
  people: Person[];
  members: Member[];
  projects: Project[];
  facts: Fact[] | null;
  hits: Episode[] | null;
  query: string;
  searching: boolean;
  drafts: Record<string, Draft>;
  drafting: string | null;
  setQuery: (v: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onRate: (episode: Episode, rating: 1 | -1) => void;
  onPromote: (episode: Episode) => void;
  onDelete: (episode: Episode) => void;
  onDraft: (topic: string) => void;
  onPublish: (topic: string) => void;
  onEnable: (name: string, version?: number) => void;
  onDisable: (name: string) => void;
  onApprove: (name: string) => void;
  onDeprecate: (name: string) => void;
  onVersions: (name: string) => Promise<SkillVersion[]>;
  versionsFor: Record<string, SkillVersion[]>;
  onLoadVersions: (name: string) => void;
  onAddMember: (email: string) => void;
  onRole: (email: string, role: string) => void;
  onRemoveMember: (email: string) => void;
  onRenameMe: (name: string) => void;
  onRenameProject: (key: string, name: string) => void;
  onCaptureMode: (key: string, mode: string) => void;
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
          hits={props.hits}
          searching={props.searching}
          query={props.query}
          onQuery={props.setQuery}
          onSearch={props.onSearch}
          onClearSearch={props.onClearSearch}
        />
      );
    case "chat":
      return <ChatPage projectKey={props.active} />;
    case "graph":
      return <GraphPage projectKey={props.active} />;
    case "sessions":
      if (route.id)
        return <SessionPage projectKey={props.active} id={route.id} />;
      return <SessionsPage sessions={props.sessions} loading={props.loading} />;
    case "skills":
      if (route.id) {
        return (
          <SkillPage
            name={route.id}
            skill={props.skills.find((s) => s.name === route.id)}
            entry={props.catalogue.find((s) => s.name === route.id)}
            versions={props.versionsFor[route.id] ?? null}
            isAdmin={props.isAdmin}
            busy={props.busy}
            onEnable={props.onEnable}
            onDisable={props.onDisable}
            onApprove={props.onApprove}
            onDeprecate={props.onDeprecate}
            onLoadVersions={props.onLoadVersions}
            onCopy={props.onCopy}
          />
        );
      }
      return (
        <SkillsPage
          skills={props.skills}
          catalogue={props.catalogue}
          clusters={props.clusters}
          drafts={props.drafts}
          drafting={props.drafting}
          busy={props.busy}
          isAdmin={props.isAdmin}
          onDraft={props.onDraft}
          onPublish={props.onPublish}
          onEnable={props.onEnable}
          onDisable={props.onDisable}
          onApprove={props.onApprove}
          onDeprecate={props.onDeprecate}
          onVersions={props.onVersions}
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
    case "audit":
      return (
        <AuditPage
          events={props.auditEvents}
          summary={props.auditSummary}
          loading={props.auditLoading}
          busy={props.auditLoading}
          group={props.auditGroup}
          hasMore={props.auditHasMore}
          onGroup={props.onAuditGroup}
          onMore={props.onAuditMore}
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
          onCaptureMode={props.onCaptureMode}
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
