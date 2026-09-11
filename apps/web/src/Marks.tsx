/**
 * Treatment marks — the world's core vocabulary.
 *
 * A citator never says "this case is fine"; it stamps a signal you can read at
 * a glance across a column of hundreds. drymem has the same four states, and
 * each gets a *shape*, drawn, not a coloured dot:
 *
 *   ○ open ring    private — held, not published
 *   ● filled disc  team — published to the project
 *   │ upright bar  live — this fact still stands
 *   ⁄ struck bar   superseded — a later memory contradicted it
 *
 * Colour confirms the shape; it never carries the meaning alone. Someone who
 * cannot distinguish the hues still reads every state correctly, and that was
 * a stated product requirement, not a nicety.
 */

import "./marks.css";

type MarkProps = { title?: string };

export function PrivateMark({ title = "Private — only you can see this" }: MarkProps) {
  return (
    <svg className="mark mark--private" viewBox="0 0 12 12" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function TeamMark({ title = "Shared with the project" }: MarkProps) {
  return (
    <svg className="mark mark--team" viewBox="0 0 12 12" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="6" cy="6" r="4" fill="currentColor" />
    </svg>
  );
}

export function LiveMark({ title = "Still stands" }: MarkProps) {
  return (
    <svg className="mark mark--live" viewBox="0 0 12 12" role="img" aria-label={title}>
      <title>{title}</title>
      <rect x="5" y="1" width="2" height="10" fill="currentColor" />
    </svg>
  );
}

export function StruckMark({ title = "Superseded by a later memory" }: MarkProps) {
  return (
    <svg className="mark mark--struck" viewBox="0 0 12 12" role="img" aria-label={title}>
      <title>{title}</title>
      <rect x="5" y="1" width="2" height="10" fill="currentColor" opacity="0.55" />
      <line x1="1" y1="9.5" x2="11" y2="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ScopeMark({ scope }: { scope: string }) {
  return scope === "team" ? <TeamMark /> : <PrivateMark />;
}

export function TreatmentMark({ superseded }: { superseded: boolean }) {
  return superseded ? <StruckMark /> : <LiveMark />;
}

/** The key, shown once where a reader first meets the marks. */
export function MarkLegend() {
  return (
    <dl className="mark-legend">
      <div>
        <dt>
          <PrivateMark title="" />
        </dt>
        <dd>private</dd>
      </div>
      <div>
        <dt>
          <TeamMark title="" />
        </dt>
        <dd>shared</dd>
      </div>
      <div>
        <dt>
          <LiveMark title="" />
        </dt>
        <dd>stands</dd>
      </div>
      <div>
        <dt>
          <StruckMark title="" />
        </dt>
        <dd>superseded</dd>
      </div>
    </dl>
  );
}
