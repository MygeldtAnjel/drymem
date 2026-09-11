/**
 * The volume, open.
 *
 * Left: the index — the project's memories as citation lines, each stamped
 * with its treatment. Right: the entry, set on India paper because this is
 * where reading actually happens, with its stamp actions in the margin rail.
 *
 * Search does not replace the index; it becomes the *citing references* column,
 * which is what a citator shows: not documents, but the facts drawn from them,
 * each marked live or superseded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, getToken, setToken, type Episode, type Fact, type Project } from "./api";
import { Markdown } from "./Markdown";
import { MarkLegend, ScopeMark, TeamMark, TreatmentMark } from "./Marks";
import { BackIcon, DeleteIcon, NotUsefulIcon, ShareIcon, UsefulIcon } from "./Icons";
import { clock, firstLine, leaf, ratio, stem, when } from "./format";
import { SignIn } from "./SignIn";

type Pane = "index" | "facts";

export function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  if (!authed) return <SignIn onDone={() => setAuthed(true)} />;
  return <Volume onSignOut={() => setAuthed(false)} />;
}

function Volume({ onSignOut }: { onSignOut: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<string>("");
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [pane, setPane] = useState<Pane>("index");
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [selected, setSelected] = useState<Episode | null>(null);
  const [stamp, setStamp] = useState<Record<string, 1 | -1>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // On a phone the two panes are exclusive: stacking them meant scrolling past
  // a dozen entries to reach the memory, and the actions never came into view.
  const [pane_, setPane_] = useState<"index" | "entry">("index");
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
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }, [active, fail]);

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
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (confirming) return setConfirming(false);
        if (typing) return searchRef.current?.blur();
        if (pane === "facts") return setPane("index");
      }
      if (typing || confirming) return;

      const list = pane === "index" ? episodes : [];
      if (list.length === 0 || !selected) return;

      // j/k move from anywhere; the arrows only when focus is in the index, so
      // the reading column keeps its own scrolling.
      const arrows = inIndex;
      const down = e.key === "j" || (arrows && e.key === "ArrowDown");
      const up = e.key === "k" || (arrows && e.key === "ArrowUp");
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
  }, [episodes, pane, selected, confirming]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

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
      const shared = { ...selected, scope: "team" };
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
      setConfirming(false);
      flash("Deleted");
    } catch (e) {
      fail(e);
    }
  };

  const project = useMemo(
    () => projects.find((p) => p.project_key === active),
    [projects, active],
  );

  return (
    <div className="volume" data-pane={pane_}>
      <section className="index" aria-label="Memories" ref={indexRef}>
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

          {/* The heading says what it is; no kicker above it. */}
          <h2 className="index__title">
            {pane === "index"
              ? `${episodes.length} entries`
              : `${facts.length} citing “${lastQuery}”`}
          </h2>

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
              <button type="button" className="search__clear" onClick={() => setPane("index")}>
                Back to entries
              </button>
            )}
          </form>
          <MarkLegend />
        </header>

        <div className="index__scroll">
          {busy && <p className="muted">Reading…</p>}

          {!busy && pane === "index" && episodes.length === 0 && (
            <p className="muted">
              Nothing filed yet. A memory appears here the moment an agent saves one.
            </p>
          )}

          {!busy &&
            pane === "index" &&
            episodes.map((episode) => (
              <button
                key={episode.uuid}
                className={`entry${selected?.uuid === episode.uuid ? " entry--open" : ""}`}
                onClick={() => {
                  setSelected(episode);
                  setPane_("entry");
                }}
                aria-current={selected?.uuid === episode.uuid}
              >
                <ScopeMark scope={episode.scope} />
                <span className="entry__body">
                  <span className="entry__name mono">
                    <span className="entry__stem">{stem(episode.name)}</span>
                    {leaf(episode.name)}
                  </span>
                  <span className="entry__gloss">{firstLine(episode.content)}</span>
                  <span className="entry__meta legend">
                    {episode.author ?? "unknown"} · {when(episode.created_at)}
                    {stamp[episode.uuid] ? (
                      <span className="entry__stamped">
                        {stamp[episode.uuid] === 1 ? "useful" : "not useful"}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}

          {!busy && pane === "facts" && facts.length === 0 && (
            <p className="muted">
              Nothing cites “{lastQuery}”. Shorter keywords work better — “auth”, not
              “authentication setup”.
            </p>
          )}

          {!busy &&
            pane === "facts" &&
            facts.map((fact, i) => (
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
        </div>
      </section>

      <Entry
        episode={selected}
        stamped={selected ? stamp[selected.uuid] : undefined}
        onRate={rate}
        onPromote={promote}
        onDelete={() => setConfirming(true)}
        onBack={() => setPane_("index")}
        project={project}
      />

      {confirming && selected && (
        <Confirm
          name={selected.name}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}

      <div className="flash" role="status" aria-live="polite">
        {error ? <span className="flash__error">{error}</span> : notice}
      </div>

    </div>
  );
}

/**
 * True once `key`'s element has scrolled out of its scroll container.
 *
 * Keyed on the entry, not just the ref: the first mount happens while no entry
 * is selected, so the ref is still null and the effect returns early — and a
 * ref's identity never changes, so it would never run again.
 */
function useScrolledPast(ref: React.RefObject<HTMLElement | null>, key: string | null): boolean {
  const [past, setPast] = useState(false);

  useEffect(() => {
    setPast(false);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setPast(!entry?.isIntersecting), {
      root: el.closest(".page__sheet"),
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, key]);

  return past;
}

function Entry({
  episode,
  stamped,
  onRate,
  onPromote,
  onDelete,
  onBack,
  project,
}: {
  episode: Episode | null;
  stamped?: 1 | -1;
  onRate: (r: 1 | -1) => void;
  onPromote: () => void;
  onDelete: () => void;
  onBack: () => void;
  project?: Project;
}) {
  const headRef = useRef<HTMLElement>(null);
  const scrolled = useScrolledPast(headRef, episode?.uuid ?? null);

  if (!episode) {
    return (
      <section className="page page--empty">
        {/* The back control lives here too: deleting the last entry on a phone
            otherwise left the reader on an empty pane with no way out. */}
        <button className="page__back legend" onClick={onBack}>
          <BackIcon /> All entries
        </button>
        <p>Select an entry to read it.</p>
      </section>
    );
  }

  return (
    <section className="page" aria-label="Entry">
      <button className="page__back legend" onClick={onBack}>
        <BackIcon /> All entries
      </button>

      <div className="page__sheet">
        {/* Running head: appears only once the entry head has left the
            viewport, so a several-screen body keeps its place without
            repeating the title to itself at rest. */}
        <div
          className={`page__running${scrolled ? " page__running--on" : ""}`}
          aria-hidden={!scrolled}
        >
          <ScopeMark scope={episode.scope} />
          <span className="mono">{leaf(episode.name)}</span>
        </div>

        <div className="page__body">
        <header className="page__head" ref={headRef}>
          <div className="page__signal">
            <ScopeMark scope={episode.scope} />
            <span className="legend">{episode.scope === "team" ? "Shared" : "Private"}</span>
          </div>
          <h1 className="mono">{episode.name}</h1>
          <p className="page__cite">
            {episode.author ?? "unknown"} · {when(episode.created_at)}
            {clock(episode.created_at) && ` · ${clock(episode.created_at)}`}
          </p>
        </header>

        <Markdown source={episode.content} />
        </div>
      </div>

      <aside className="rail" aria-label="Actions">
        <button
          className={`rail__btn${stamped === 1 ? " rail__btn--on" : ""}`}
          onClick={() => onRate(1)}
        >
          <UsefulIcon /> Useful
        </button>
        <button
          className={`rail__btn${stamped === -1 ? " rail__btn--on" : ""}`}
          onClick={() => onRate(-1)}
        >
          <NotUsefulIcon /> Not useful
        </button>
        {episode.scope === "team" ? (
          <p className="rail__state">
            <TeamMark title="" /> Shared
          </p>
        ) : (
          <button className="rail__btn" onClick={onPromote} title="Share with the project">
            <ShareIcon /> Share
          </button>
        )}
        <button className="rail__btn rail__btn--danger" onClick={onDelete}>
          <DeleteIcon /> Delete
        </button>

        {project && (
          <div className="foot">
            <span className="mono">{project.memory_count}</span>
            <span className="legend">entries</span>
            {ratio(project.positive, project.negative) && (
              <>
                <span className="mono">{ratio(project.positive, project.negative)}</span>
                <span className="legend">useful</span>
              </>
            )}
          </div>
        )}
      </aside>
    </section>
  );
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
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Confirm deletion">
      <div className="confirm">
        <p className="legend">Strike this entry</p>
        <p className="confirm__name mono">{name}</p>
        <p className="confirm__warn">
          Deleting removes it from the graph and the index. There is no undo.
        </p>
        <div className="confirm__row">
          <button className="btn" onClick={onCancel} autoFocus>
            Keep it
          </button>
          <button className="btn btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
