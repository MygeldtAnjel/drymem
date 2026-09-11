/**
 * The volume, open.
 *
 * Left: the index. Right: whatever it is pointing at, set on India paper
 * because that is where reading happens. The index now carries five registers —
 * entries, sittings, skills, projects, people — because a team's memory is not
 * only its entries: it is also who wrote them, when, and what was distilled out
 * of them afterwards.
 *
 * The registers live in the index head, not a sidebar. That is the one
 * structural move this world refuses, and five sections is exactly the moment
 * the temptation arrives.
 *
 * Search does not replace the index; it becomes the *citing references* column,
 * which is what a citator shows: not documents, but the facts drawn from them,
 * each marked live or superseded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  api,
  getToken,
  setToken,
  type Cluster,
  type Episode,
  type Fact,
  type Member,
  type Person,
  type Project,
  type Session,
  type Skill,
} from "./api";
import { Entry } from "./Entry";
import { MarkLegend, TreatmentMark, ScopeMark } from "./Marks";
import {
  ClusterPage,
  Empty,
  PersonLine,
  PersonPage,
  ProjectLine,
  ProjectPage,
  SittingLine,
  SittingPage,
  SkillLine,
  SkillPage,

} from "./Panes";
import { count, firstLine, leaf, stem, when } from "./format";
import { SignIn } from "./SignIn";

const REGISTERS = ["Entries", "Sittings", "Skills", "Projects", "People"] as const;
type Register = (typeof REGISTERS)[number];

type Draft = { name: string; content: string; model: string; memory_count: number };

export function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  if (!authed) return <SignIn onDone={() => setAuthed(true)} />;
  return <Volume onSignOut={() => setAuthed(false)} />;
}

function Volume({ onSignOut }: { onSignOut: () => void }) {
  const [register, setRegister] = useState<Register>("Entries");
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<string>("");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [pane, setPane] = useState<"index" | "facts">("index");
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [selected, setSelected] = useState<Episode | null>(null);
  const [openSitting, setOpenSitting] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [drafting, setDrafting] = useState<string | null>(null);
  const [stamp, setStamp] = useState<Record<string, 1 | -1>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ what: string; run: () => void } | null>(null);
  // On a phone the two panes are exclusive: stacking them meant scrolling past
  // a dozen entries to reach the memory, and the actions never came into view.
  const [phone, setPhone] = useState<"index" | "entry">("index");
  const searchRef = useRef<HTMLInputElement>(null);
  const indexRef = useRef<HTMLElement>(null);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        onSignOut();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    },
    [onSignOut],
  );

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  useEffect(() => {
    api
      .projects()
      .then((list) => {
        setProjects(list);
        setActive((current) => current || list[0]?.project_key || "");
      })
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    if (!active) return;
    setBusy(true);
    setPane("index");
    api
      .context(active)
      .then((list) => {
        setEpisodes(list);
        setSelected(list[0] ?? null);
        setStamp(
          Object.fromEntries(
            list.filter((e) => e.rating === 1 || e.rating === -1).map((e) => [e.uuid, e.rating!]),
          ) as Record<string, 1 | -1>,
        );
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }, [active, fail]);

  // Each register loads when it is first opened, and again when the project
  // changes. Loading all five up front would spend a model run on `discover`
  // for a reader who only came to read one memory.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      setBusy(true);
      try {
        if (register === "Sittings") {
          const list = await api.sessions(active);
          if (!cancelled) {
            setSessions(list);
            setOpenSitting((c) => c ?? list[0]?.session_id ?? null);
          }
        } else if (register === "Skills") {
          const [published, found] = await Promise.all([
            api.skills(active),
            api.discover(active).catch(() => [] as Cluster[]),
          ]);
          if (!cancelled) {
            setSkills(published);
            setClusters(found);
            if (published[0]) setOpenSkill((c) => c ?? published[0]!.name);
            else if (found[0]) setOpenCluster((c) => c ?? found[0]!.topic);
          }
        } else if (register === "People") {
          const list = await api.people();
          if (!cancelled) {
            setPeople(list);
            setOpenPerson((c) => c ?? list[0]?.id ?? null);
          }
        } else if (register === "Projects") {
          if (!cancelled) setOpenProject((c) => c ?? active);
        }
      } catch (e) {
        if (!cancelled) fail(e);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [register, active, fail]);

  // Members belong to whichever project is open in the Projects register.
  useEffect(() => {
    if (register !== "Projects" || !openProject) return;
    api.members(openProject).then(setMembers).catch(fail);
  }, [register, openProject, fail]);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !active) return;
      setBusy(true);
      setError(null);
      try {
        setFacts(await api.search(active, trimmed));
        setLastQuery(trimmed);
        setPane("facts");
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [active, fail],
  );

  // Keyboard first, but the arrows belong to whatever is being read. Taking
  // them globally meant a several-screen memory could not be scrolled, and a
  // press swapped the document out from under the reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      const inIndex =
        e.target instanceof Node && indexRef.current?.contains(e.target) === true;
      if (e.key === "/" && !typing && register === "Entries") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (confirming) return setConfirming(null);
        if (typing) return searchRef.current?.blur();
        if (pane === "facts") return setPane("index");
      }
      if (typing || confirming || register !== "Entries") return;

      const list = pane === "index" ? episodes : [];
      if (list.length === 0 || !selected) return;

      // j/k move from anywhere; the arrows only when focus is in the index, so
      // the reading column keeps its own scrolling.
      const down = e.key === "j" || (inIndex && e.key === "ArrowDown");
      const up = e.key === "k" || (inIndex && e.key === "ArrowUp");
      if (!down && !up) return;

      e.preventDefault();
      const at = list.findIndex((x) => x.uuid === selected.uuid);
      setSelected(
        down
          ? (list[Math.min(list.length - 1, at + 1)] ?? selected)
          : (list[Math.max(0, at - 1)] ?? selected),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [episodes, pane, selected, confirming, register]);

  const rate = async (rating: 1 | -1) => {
    if (!selected) return;
    try {
      // The query that surfaced it rides along: "a bad answer to auth" is a
      // signal, "a bad memory" is not.
      await api.rate(selected.uuid, rating, pane === "facts" ? lastQuery : "");
      setStamp((s) => ({ ...s, [selected.uuid]: rating }));
      flash(rating > 0 ? "Marked useful" : "Marked not useful");
    } catch (e) {
      fail(e);
    }
  };

  const promote = async () => {
    if (!selected || selected.scope === "team") return;
    try {
      await api.promote(selected.uuid);
      const shared = { ...selected, scope: "team", promoted_at: new Date().toISOString() };
      setSelected(shared);
      setEpisodes((list) => list.map((x) => (x.uuid === shared.uuid ? shared : x)));
      flash("Shared with the project");
    } catch (e) {
      fail(e);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await api.remove(selected.uuid);
      const rest = episodes.filter((x) => x.uuid !== selected.uuid);
      setEpisodes(rest);
      setSelected(rest[0] ?? null);
      setConfirming(null);
      flash("Deleted");
    } catch (e) {
      fail(e);
    }
  };

  const draftSkill = async (topic: string) => {
    setDrafting(topic);
    setError(null);
    try {
      const draft = await api.distill(active, topic);
      setDrafts((d) => ({ ...d, [topic]: draft }));
      flash(`Drafted from ${draft.memory_count} memories — review it before publishing`);
    } catch (e) {
      fail(e);
    } finally {
      setDrafting(null);
    }
  };

  const publishSkill = async (topic: string) => {
    const draft = drafts[topic];
    if (!draft) return;
    try {
      const saved = await api.publishSkill({
        project_key: active,
        name: draft.name,
        topic,
        content: draft.content,
        model: draft.model,
        memory_count: draft.memory_count,
      });
      setSkills((list) => [saved, ...list.filter((s) => s.name !== saved.name)]);
      flash(`Published ${saved.name}`);
    } catch (e) {
      fail(e);
    }
  };

  const unpublishSkill = async (name: string) => {
    try {
      await api.removeSkill(active, name);
      setSkills((list) => list.filter((s) => s.name !== name));
      setOpenSkill(null);
      setConfirming(null);
      flash("Unpublished");
    } catch (e) {
      fail(e);
    }
  };

  const addMember = async (email: string) => {
    if (!openProject) return;
    try {
      setMembers(await api.addMember(openProject, email));
      flash(`${email} added`);
    } catch (e) {
      fail(e);
    }
  };

  const project = useMemo(
    () => projects.find((p) => p.project_key === active),
    [projects, active],
  );
  const shownProject = useMemo(
    () => projects.find((p) => p.project_key === openProject),
    [projects, openProject],
  );

  const heading = (): string => {
    if (register === "Entries") {
      return pane === "index"
        ? count(episodes.length, "entry", "entries")
        : `${facts.length} citing “${lastQuery}”`;
    }
    if (register === "Sittings") return count(sessions.length, "sitting");
    if (register === "Skills") return `${skills.length} published · ${clusters.length} suggested`;
    if (register === "Projects") return count(projects.length, "project");
    return count(people.length, "person", "people");
  };

  const openEntry = (episode: Episode) => {
    setRegister("Entries");
    setSelected(episode);
    setPhone("entry");
  };

  return (
    <div className="volume" data-pane={phone}>
      <section className="index" aria-label={register} ref={indexRef}>
        <header className="index__head">
          <div className="index__bar">
            <span className="index__word">drymem</span>
            {projects.length > 1 ? (
              <select
                className="index__project"
                value={active}
                onChange={(e) => setActive(e.target.value)}
                aria-label="Project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.project_key}>
                    {p.project_key}
                  </option>
                ))}
              </select>
            ) : (
              <span className="index__project index__project--one" title={active}>
                {active}
              </span>
            )}
            <button
              className="index__out legend"
              onClick={() => {
                setToken(null);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </div>

          {/* The registers. In the index head, never a sidebar. */}
          <nav className="registers" aria-label="Registers">
            {REGISTERS.map((name) => (
              <button
                key={name}
                className={`registers__tab legend${register === name ? " registers__tab--on" : ""}`}
                aria-current={register === name}
                onClick={() => {
                  setRegister(name);
                  setPhone("index");
                }}
              >
                {name}
              </button>
            ))}
          </nav>

          {/* The heading says what it is; no kicker above it. */}
          <h2 className="index__title">{heading()}</h2>

          {register === "Entries" && (
            <>
              <form
                className="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch(query);
                }}
              >
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search facts…  /"
                  aria-label="Search this project's memory"
                  spellCheck={false}
                />
                {pane === "facts" && (
                  <button
                    type="button"
                    className="search__clear"
                    onClick={() => setPane("index")}
                  >
                    Back to entries
                  </button>
                )}
              </form>
              <MarkLegend />
            </>
          )}
        </header>

        <div className="index__scroll">
          {busy && <p className="muted">Reading…</p>}

          {!busy && register === "Entries" && pane === "index" && (
            <EntryList
              episodes={episodes}
              selected={selected}
              stamp={stamp}
              onOpen={(episode) => {
                setSelected(episode);
                setPhone("entry");
              }}
            />
          )}

          {!busy && register === "Entries" && pane === "facts" && (
            <FactList facts={facts} query={lastQuery} />
          )}

          {!busy && register === "Sittings" &&
            (sessions.length === 0 ? (
              <p className="muted">No sittings yet. One appears the first time an agent files.</p>
            ) : (
              sessions.map((session) => (
                <SittingLine
                  key={session.session_id}
                  session={session}
                  open={openSitting === session.session_id}
                  onOpen={() => {
                    setOpenSitting(session.session_id);
                    setPhone("entry");
                  }}
                />
              ))
            ))}

          {!busy && register === "Skills" && (
            <>
              {skills.map((skill) => (
                <SkillLine
                  key={skill.id}
                  name={skill.name}
                  gloss={skill.topic || "No subject recorded"}
                  meta={`${skill.author} · ${when(skill.updated_at)} · ${count(skill.memory_count, "memory", "memories")}`}
                  draft={false}
                  open={openSkill === skill.name}
                  onOpen={() => {
                    setOpenSkill(skill.name);
                    setOpenCluster(null);
                    setPhone("entry");
                  }}
                />
              ))}
              {clusters
                .filter((c) => !skills.some((s) => s.topic === c.topic))
                .map((cluster) => (
                  <SkillLine
                    key={cluster.topic}
                    name={cluster.topic}
                    gloss={cluster.facts[0] ?? "A subject these memories keep returning to"}
                    meta={`suggested · ${count(cluster.memory_count, "memory", "memories")}`}
                    draft
                    open={openCluster === cluster.topic}
                    onOpen={() => {
                      setOpenCluster(cluster.topic);
                      setOpenSkill(null);
                      setPhone("entry");
                    }}
                  />
                ))}
              {skills.length === 0 && clusters.length === 0 && (
                <p className="muted">
                  Nothing to distil yet. Subjects appear here once two memories return to one.
                </p>
              )}
            </>
          )}

          {!busy && register === "Projects" &&
            projects.map((p) => (
              <ProjectLine
                key={p.id}
                project={p}
                open={openProject === p.project_key}
                onOpen={() => {
                  setOpenProject(p.project_key);
                  setPhone("entry");
                }}
              />
            ))}

          {!busy && register === "People" &&
            people.map((person) => (
              <PersonLine
                key={person.id}
                person={person}
                open={openPerson === person.id}
                onOpen={() => {
                  setOpenPerson(person.id);
                  setPhone("entry");
                }}
              />
            ))}
        </div>
      </section>

      <Reading
        register={register}
        episode={selected}
        stamp={stamp}
        project={project}
        onRate={rate}
        onPromote={promote}
        onDeleteEntry={() =>
          setConfirming({ what: selected?.title ?? "this entry", run: () => void remove() })
        }
        onBack={() => setPhone("index")}
        sessions={sessions}
        openSitting={openSitting}
        episodes={episodes}
        onOpenEntry={openEntry}
        skills={skills}
        openSkill={openSkill}
        onUnpublish={(name) =>
          setConfirming({ what: name, run: () => void unpublishSkill(name) })
        }
        clusters={clusters}
        openCluster={openCluster}
        drafts={drafts}
        drafting={drafting}
        onDraft={draftSkill}
        onPublish={publishSkill}
        shownProject={shownProject}
        members={members}
        onAddMember={addMember}
        people={people}
        openPerson={openPerson}
      />

      {confirming && (
        <Confirm
          name={confirming.what}
          onCancel={() => setConfirming(null)}
          onConfirm={confirming.run}
        />
      )}

      <div className="flash" role="status" aria-live="polite">
        {error ? <span className="flash__error">{error}</span> : notice}
      </div>
    </div>
  );
}

function EntryList({
  episodes,
  selected,
  stamp,
  onOpen,
}: {
  episodes: Episode[];
  selected: Episode | null;
  stamp: Record<string, 1 | -1>;
  onOpen: (episode: Episode) => void;
}) {
  if (episodes.length === 0) {
    return (
      <p className="muted">
        Nothing filed yet. A memory appears here the moment an agent saves one.
      </p>
    );
  }
  return (
    <>
      {episodes.map((episode) => (
        <button
          key={episode.uuid}
          className={`entry${selected?.uuid === episode.uuid ? " entry--open" : ""}`}
          onClick={() => onOpen(episode)}
          aria-current={selected?.uuid === episode.uuid}
        >
          <ScopeMark scope={episode.scope} />
          <span className="entry__body">
            <span className="entry__name">{episode.title || leaf(episode.name)}</span>
            <span className="entry__gloss">{firstLine(episode.content)}</span>
            <span className="entry__meta legend">
              {episode.type} · {episode.author ?? "unknown"} · {when(episode.created_at)}
              {stamp[episode.uuid] ? (
                <span className="entry__stamped">
                  {stamp[episode.uuid] === 1 ? "useful" : "not useful"}
                </span>
              ) : null}
            </span>
            {episode.topic_key && (
              <span className="entry__key mono">
                <span className="entry__stem">{stem(episode.topic_key)}</span>
                {leaf(episode.topic_key)}
              </span>
            )}
          </span>
        </button>
      ))}
    </>
  );
}

function FactList({ facts, query }: { facts: Fact[]; query: string }) {
  if (facts.length === 0) {
    return (
      <p className="muted">
        Nothing cites “{query}”. Shorter keywords work better — “auth”, not “authentication
        setup”.
      </p>
    );
  }
  return (
    <>
      {facts.map((fact, i) => (
        <article key={`${fact.name}-${i}`} className="fact">
          <TreatmentMark superseded={fact.superseded} />
          <div>
            <p className="fact__text">{fact.fact}</p>
            <p className="fact__meta legend">
              {fact.name} · {when(fact.created_at)}
              {fact.superseded && <span className="fact__struck">superseded</span>}
            </p>
          </div>
        </article>
      ))}
    </>
  );
}

/** Whatever the index is pointing at, open on paper. */
function Reading(props: {
  register: Register;
  episode: Episode | null;
  stamp: Record<string, 1 | -1>;
  project?: Project;
  onRate: (r: 1 | -1) => void;
  onPromote: () => void;
  onDeleteEntry: () => void;
  onBack: () => void;
  sessions: Session[];
  openSitting: string | null;
  episodes: Episode[];
  onOpenEntry: (episode: Episode) => void;
  skills: Skill[];
  openSkill: string | null;
  onUnpublish: (name: string) => void;
  clusters: Cluster[];
  openCluster: string | null;
  drafts: Record<string, Draft>;
  drafting: string | null;
  onDraft: (topic: string) => void;
  onPublish: (topic: string) => void;
  shownProject?: Project;
  members: Member[];
  onAddMember: (email: string) => void;
  people: Person[];
  openPerson: string | null;
}) {
  const { register } = props;

  if (register === "Entries") {
    return (
      <Entry
        episode={props.episode}
        stamped={props.episode ? props.stamp[props.episode.uuid] : undefined}
        onRate={props.onRate}
        onPromote={props.onPromote}
        onDelete={props.onDeleteEntry}
        onBack={props.onBack}
        project={props.project}
      />
    );
  }

  if (register === "Sittings") {
    const session = props.sessions.find((s) => s.session_id === props.openSitting);
    if (!session) {
      return <Empty onBack={props.onBack}>Select a sitting to see what came out of it.</Empty>;
    }
    return (
      <SittingPage
        session={session}
        entries={props.episodes}
        onOpenEntry={props.onOpenEntry}
        onBack={props.onBack}
      />
    );
  }

  if (register === "Skills") {
    const skill = props.skills.find((s) => s.name === props.openSkill);
    if (skill) {
      return (
        <SkillPage
          skill={skill}
          onDelete={() => props.onUnpublish(skill.name)}
          onBack={props.onBack}
        />
      );
    }
    const cluster = props.clusters.find((c) => c.topic === props.openCluster);
    if (cluster) {
      return (
        <ClusterPage
          cluster={cluster}
          draft={props.drafts[cluster.topic] ?? null}
          drafting={props.drafting === cluster.topic}
          onDraft={() => props.onDraft(cluster.topic)}
          onPublish={() => props.onPublish(cluster.topic)}
          published={props.skills.some((s) => s.topic === cluster.topic)}
          onBack={props.onBack}
        />
      );
    }
    return (
      <Empty onBack={props.onBack}>Select a skill, or a subject worth distilling one from.</Empty>
    );
  }

  if (register === "Projects") {
    if (!props.shownProject) return <Empty onBack={props.onBack}>Select a project.</Empty>;
    return (
      <ProjectPage
        project={props.shownProject}
        members={props.members}
        onAdd={props.onAddMember}
        onBack={props.onBack}
      />
    );
  }

  const person = props.people.find((p) => p.id === props.openPerson);
  if (!person) return <Empty onBack={props.onBack}>Select someone.</Empty>;
  return <PersonPage person={person} onBack={props.onBack} />;
}

function Confirm({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Confirm">
      <div className="confirm">
        <p className="legend">Strike this</p>
        <p className="confirm__name mono">{name}</p>
        <p className="confirm__warn">
          Removing it takes it out of the graph and the index. There is no undo.
        </p>
        <div className="confirm__row">
          <button className="btn" onClick={onCancel} autoFocus>
            Keep it
          </button>
          <button className="btn btn--danger" onClick={onConfirm}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

