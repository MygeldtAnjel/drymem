/**
 * The entry, open on paper.
 *
 * Two things changed here when memories gained a shape. The heading is now the
 * *title* a person wrote rather than the topic key a machine generated — which
 * is what the Two-Voices rule wanted all along, and the topic key moved down
 * into the citation line where a machine-named string belongs. And the body is
 * split into its sections: a heading from the template is set as a running
 * term in small caps, an author's own heading stays an ordinary prose heading,
 * so a reader can tell the shape from the writing without either being louder.
 */

import { useEffect, useRef, useState } from "react";

import type { Episode, Project } from "./api";
import { Markdown } from "./Markdown";
import { ScopeMark, TeamMark } from "./Marks";
import { BackIcon, DeleteIcon, NotUsefulIcon, ShareIcon, UsefulIcon } from "./Icons";
import { clock, leaf, ratio, when } from "./format";
import { TYPES, split } from "./memory";

/**
 * True once `key`'s element has scrolled out of its scroll container.
 *
 * Keyed on the entry, not just the ref: the first mount happens while no entry
 * is selected, so the ref is still null and the effect returns early — and a
 * ref's identity never changes, so it would never run again.
 */
export function useScrolledPast(
  ref: React.RefObject<HTMLElement | null>,
  key: string | null,
): boolean {
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

/** The facts about a memory that are not its prose. */
function Citation({ episode, projectKey }: { episode: Episode; projectKey: string }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Type", <span title={TYPES[episode.type] ?? ""}>{episode.type}</span>],
    ["Author", episode.author ?? "unknown"],
    ["Filed", `${when(episode.created_at)}${clock(episode.created_at) ? ` · ${clock(episode.created_at)}` : ""}`],
    ["Project", <span className="mono">{projectKey}</span>],
  ];
  if (episode.topic_key) rows.push(["Topic", <span className="mono">{episode.topic_key}</span>]);
  if (episode.session_id) {
    rows.push(["Session", <span className="mono">{episode.session_id}</span>]);
  }
  rows.push([
    "Standing",
    episode.scope === "team"
      ? `Shared${episode.promoted_at ? ` · ${when(episode.promoted_at)}` : ""}`
      : "Private to you",
  ]);

  return (
    <dl className="cite">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt className="legend">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Entry({
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

  const { lead, sections } = split(episode.content);
  const title = episode.title || leaf(episode.name);

  // The body's own first heading is what became the title, so printing it
  // again put the same sentence at the top of the page twice.
  const sames = sections.length > 0 && sections[0]!.heading.trim() === title.trim();
  const body = sames ? [{ ...sections[0]!, heading: "" }, ...sections.slice(1)] : sections;

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
          <span>{title}</span>
        </div>

        <div className="page__body">
          <header className="page__head" ref={headRef}>
            <div className="page__signal">
              <ScopeMark scope={episode.scope} />
              <span className="legend">{episode.scope === "team" ? "Shared" : "Private"}</span>
            </div>
            <h1>{title}</h1>
            <Citation episode={episode} projectKey={project?.project_key ?? ""} />
          </header>

          {lead && <Markdown source={lead} />}

          {body.map((section, i) => (
            <section className="sect" key={`${section.heading}-${i}`}>
              {section.heading && (
                <h2 className={section.canonical ? "sect__term legend" : "sect__own"}>
                  {section.heading}
                </h2>
              )}
              <Markdown source={section.body} />
            </section>
          ))}

          {!lead && sections.length === 0 && <p className="muted">This entry is empty.</p>}
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
