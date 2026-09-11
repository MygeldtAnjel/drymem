/**
 * The other four registers: sittings, skills, projects, people.
 *
 * These are management screens, and the temptation was a table in a sidebar
 * layout — the exact dashboard this world refuses. They keep the volume
 * instead: a column of citation lines on the left, the thing itself open on
 * paper on the right. A skill is a document, a project is a document, a person
 * is a short one; the only screen that ever needed a grid was the one nobody
 * asked for.
 */

import { useState } from "react";

import type {
  Cluster,
  Episode,
  Member,
  Person,
  Project,
  Session,
  Skill,
} from "./api";
import { Markdown } from "./Markdown";
import { PrivateMark, TeamMark } from "./Marks";
import { BackIcon, DeleteIcon, ShareIcon } from "./Icons";
import { clock, count, ratio, when } from "./format";

/** The head every register page shares: a term, a title, and its facts. */
function Sheet({
  kind,
  title,
  facts,
  children,
  rail,
  onBack,
  named,
}: {
  kind: string;
  title: string;
  /** True when the title is a string a machine produced — a key, an id, a slug. */
  named?: boolean;
  facts: Array<[string, React.ReactNode]>;
  children?: React.ReactNode;
  rail?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <section className="page" aria-label={kind}>
      {/* On a phone the panes are exclusive, so every page needs its own exit. */}
      <button className="page__back legend" onClick={onBack}>
        <BackIcon /> Back to the list
      </button>
      <div className="page__sheet">
        <div className="page__body">
          <header className="page__head">
            <div className="page__signal">
              <span className="legend">{kind}</span>
            </div>
            <h1 className={named ? "mono" : undefined}>{title}</h1>
            <dl className="cite">
              {facts.map(([term, value]) => (
                <div key={term}>
                  <dt className="legend">{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </header>
          {children}
        </div>
      </div>
      {rail && (
        <aside className="rail" aria-label="Actions">
          {rail}
        </aside>
      )}
    </section>
  );
}

export function Empty({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <section className="page page--empty">
      <button className="page__back legend" onClick={onBack}>
        <BackIcon /> Back to the list
      </button>
      <p>{children}</p>
    </section>
  );
}

// ---------------------------------------------------------------- sittings

/** What one agent run produced. A day's grouping says so rather than pretending. */
export function SittingLine({
  session,
  open,
  onOpen,
}: {
  session: Session;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={`entry${open ? " entry--open" : ""}`}
      onClick={onOpen}
      aria-current={open}
    >
      {session.shared > 0 ? <TeamMark title="" /> : <PrivateMark title="" />}
      <span className="entry__body">
        <span
          className={`entry__name${session.synthetic ? "" : " entry__name--key"}`}
        >
          {sittingLabel(session)}
        </span>
        <span className="entry__gloss">
          {session.titles.join(" · ") || "(no titles)"}
        </span>
        <span className="entry__meta legend">
          {session.author} · {when(session.ended_at)} ·{" "}
          {count(session.memory_count, "entry", "entries")}
        </span>
      </span>
    </button>
  );
}

export function sittingLabel(session: Session): string {
  return session.synthetic
    ? `${when(session.ended_at)} · by day`
    : session.session_id;
}

export function SittingPage({
  session,
  entries,
  onOpenEntry,
  onBack,
}: {
  session: Session;
  entries: Episode[];
  onOpenEntry: (episode: Episode) => void;
  onBack: () => void;
}) {
  const mine = entries.filter((e) => e.session_id === session.session_id);
  return (
    <Sheet
      kind="Sitting"
      onBack={onBack}
      named={!session.synthetic}
      title={sittingLabel(session)}
      facts={[
        ["Author", session.author],
        [
          "Ran",
          `${when(session.started_at)} · ${clock(session.started_at)}–${clock(session.ended_at)}`,
        ],
        [
          "Filed",
          `${count(session.memory_count, "entry", "entries")} · ${session.shared} shared`,
        ],
        ...(session.synthetic
          ? ([
              [
                "Grouping",
                "By author and day — these memories were saved before sittings were recorded.",
              ],
            ] as Array<[string, React.ReactNode]>)
          : []),
      ]}
    >
      <section className="sect">
        <h2 className="sect__term legend">What came out of it</h2>
        {mine.length === 0 ? (
          <p className="muted">
            Its entries are outside the page currently loaded. Open them from
            Entries.
          </p>
        ) : (
          <ul className="plain">
            {mine.map((episode) => (
              <li key={episode.uuid}>
                <button className="link" onClick={() => onOpenEntry(episode)}>
                  {episode.title || episode.name}
                </button>{" "}
                <span className="legend">{episode.type}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  );
}

// ------------------------------------------------------------------ skills

export function SkillLine({
  name,
  gloss,
  meta,
  draft,
  open,
  onOpen,
}: {
  name: string;
  gloss: string;
  meta: string;
  draft: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={`entry${open ? " entry--open" : ""}`}
      onClick={onOpen}
      aria-current={open}
    >
      {draft ? (
        <PrivateMark title="Not published yet" />
      ) : (
        <TeamMark title="Published" />
      )}
      <span className="entry__body">
        <span className="entry__name entry__name--key">{name}</span>
        <span className="entry__gloss">{gloss}</span>
        <span className="entry__meta legend">{meta}</span>
      </span>
    </button>
  );
}

export function SkillPage({
  skill,
  onDelete,
  onBack,
}: {
  skill: Skill;
  onDelete: () => void;
  onBack: () => void;
}) {
  return (
    <Sheet
      kind="Skill"
      onBack={onBack}
      named
      title={skill.name}
      facts={[
        ["Subject", skill.topic || "—"],
        ["Published by", skill.author],
        ["Updated", when(skill.updated_at)],
        ["Drawn from", count(skill.memory_count, "memory", "memories")],
        ...(skill.model
          ? ([["Drafted by", skill.model]] as Array<[string, React.ReactNode]>)
          : []),
      ]}
      rail={
        <button className="rail__btn rail__btn--danger" onClick={onDelete}>
          <DeleteIcon /> Unpublish
        </button>
      }
    >
      <Markdown source={skill.content} />
    </Sheet>
  );
}

/**
 * A subject the memories keep returning to, and the draft written from them.
 *
 * Drafting runs a model over the team's memories, so it is a button rather than
 * something that happens on selection — and the result is never installed
 * automatically. A skill changes how every agent on the team behaves; that is a
 * person's decision, and this screen only makes it a cheap one.
 */
export function ClusterPage({
  cluster,
  draft,
  drafting,
  onDraft,
  onPublish,
  published,
  onBack,
}: {
  cluster: Cluster;
  draft: {
    name: string;
    content: string;
    model: string;
    memory_count: number;
  } | null;
  drafting: boolean;
  onDraft: () => void;
  onPublish: () => void;
  published: boolean;
  onBack: () => void;
}) {
  return (
    <Sheet
      kind="Suggested skill"
      onBack={onBack}
      title={cluster.topic}
      facts={[
        ["Memories", String(cluster.memory_count)],
        [
          "Status",
          published
            ? "Published"
            : draft
              ? "Draft — not published"
              : "Not drafted yet",
        ],
      ]}
      rail={
        draft ? (
          <button
            className="rail__btn"
            onClick={onPublish}
            disabled={published}
          >
            <ShareIcon /> {published ? "Published" : "Publish to the team"}
          </button>
        ) : (
          <button className="rail__btn" onClick={onDraft} disabled={drafting}>
            <ShareIcon /> {drafting ? "Drafting…" : "Draft a skill"}
          </button>
        )
      }
    >
      {draft ? (
        <Markdown source={draft.content} />
      ) : (
        <>
          <section className="sect">
            <h2 className="sect__term legend">Why this keeps coming up</h2>
            <ul className="plain">
              {cluster.facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          </section>
          <p className="muted">
            {drafting
              ? "Writing a draft from these memories. A local model takes a minute or two."
              : "Drafting reads these memories and writes a SKILL.md for you to review. Nothing is installed until you publish it."}
          </p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- projects

export function ProjectLine({
  project,
  open,
  onOpen,
}: {
  project: Project;
  open: boolean;
  onOpen: () => void;
}) {
  const useful = ratio(project.positive, project.negative);
  return (
    <button
      className={`entry${open ? " entry--open" : ""}`}
      onClick={onOpen}
      aria-current={open}
    >
      <TeamMark title="" />
      <span className="entry__body">
        <span className="entry__name entry__name--key">
          {project.project_key}
        </span>
        <span className="entry__gloss">
          {project.display_name ?? "No display name"}
        </span>
        <span className="entry__meta legend">
          {count(project.memory_count, "entry", "entries")}
          {useful && ` · ${useful} useful`}
        </span>
      </span>
    </button>
  );
}

export function ProjectPage({
  project,
  members,
  onAdd,
  onBack,
}: {
  project: Project;
  members: Member[];
  onAdd: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const useful = ratio(project.positive, project.negative);

  return (
    <Sheet
      kind="Project"
      onBack={onBack}
      named={!project.display_name}
      title={project.display_name ?? project.project_key}
      facts={[
        // Only when the heading is the display name; otherwise it is the key,
        // and printing it twice tells a reader nothing the second time.
        ...(project.display_name
          ? ([["Key", <span className="mono">{project.project_key}</span>]] as Array<
              [string, React.ReactNode]
            >)
          : []),
        ["Entries", String(project.memory_count)],
        ["Rated useful", useful ?? "Not rated yet"],
        ["Members", String(members.length)],
      ]}
    >
      <section className="sect">
        <h2 className="sect__term legend">Who is on it</h2>
        <ul className="plain">
          {members.map((member) => (
            <li key={member.user_id}>
              {member.email} <span className="legend">{member.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="sect">
        <h2 className="sect__term legend">Add a teammate</h2>
        <p>
          They will see this project’s shared entries. Private entries stay
          private — sharing is always a separate, deliberate act by their
          author.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            onAdd(email.trim());
            setEmail("");
          }}
        >
          <input
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@yourteam.com"
            aria-label="Their email"
            spellCheck={false}
          />
          <button
            className="btn btn--gilt"
            type="submit"
            disabled={!email.trim()}
          >
            Add
          </button>
        </form>
      </section>
    </Sheet>
  );
}

// ------------------------------------------------------------------ people

export function PersonLine({
  person,
  open,
  onOpen,
}: {
  person: Person;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={`entry${open ? " entry--open" : ""}`}
      onClick={onOpen}
      aria-current={open}
    >
      <PrivateMark title="" />
      <span className="entry__body">
        <span className="entry__name">{person.name ?? person.email}</span>
        <span className="entry__gloss mono">{person.email}</span>
        <span className="entry__meta legend">
          {count(person.memory_count, "entry", "entries")} ·{" "}
          {count(person.project_count, "project")}
        </span>
      </span>
    </button>
  );
}

export function PersonPage({
  person,
  onBack,
}: {
  person: Person;
  onBack: () => void;
}) {
  return (
    <Sheet
      kind="Person"
      onBack={onBack}
      title={person.name ?? person.email}
      facts={[
        ["Email", <span className="mono">{person.email}</span>],
        ["Joined", when(person.created_at)],
        ["Entries written", String(person.memory_count)],
        ["Projects", String(person.project_count)],
      ]}
    >
      <section className="sect">
        <p>
          Counts only. What someone has written is theirs until they share it,
          so this page can tell you how much they have filed and never what any
          of it says.
        </p>
      </section>
    </Sheet>
  );
}
