/**
 * Drawn diagrams, for the places a document has an ASCII one.
 *
 * The repository's markdown keeps its box-drawing characters: in a terminal, on
 * GitHub, in a diff, that is the right form and it costs nothing. On a web page
 * it is a wall of monospace that a reader skips — the same information, in the
 * one medium that can do better, rendered worse.
 *
 * So a fence tagged `diagram:<id>` is swapped for the drawing below and its
 * ASCII is dropped. Each medium gets its own best version of the same picture;
 * neither is a translation of the other at read time.
 *
 * Every colour is a CSS variable, so these follow the page into dark mode.
 */

const FONT =
  "font-family:var(--font-sans),system-ui,sans-serif";
const MONO = "font-family:var(--font-mono),ui-monospace,monospace";

/** A titled column with a number, a heading and its lines. */
const stage = (
  x: number,
  n: string,
  title: string,
  lines: string[],
  { tall = false }: { tall?: boolean } = {},
) => `
  <g>
    <rect x="${x}" y="34" width="228" height="${tall ? 176 : 176}" rx="12"
          fill="var(--card)" stroke="var(--border)" />
    <text x="${x + 18}" y="62" style="${MONO};font-size:11px" fill="var(--brand)">${n}</text>
    <text x="${x + 18}" y="84" style="${FONT};font-size:13.5px;font-weight:600" fill="var(--foreground)">${title}</text>
    ${lines
      .map(
        (line, i) => `
    <text x="${x + 18}" y="${110 + i * 19}" style="${FONT};font-size:11.5px" fill="var(--muted-foreground)">${line}</text>`,
      )
      .join("")}
  </g>`;

/** An arrow between two stages, with its label above the line. */
const arrow = (x: number, label: string) => `
  <g>
    <line x1="${x}" y1="122" x2="${x + 36}" y2="122"
          stroke="var(--muted-foreground)" stroke-width="1.5" />
    <path d="M${x + 36} 122 l-6 -4 v8 z" fill="var(--muted-foreground)" />
    <text x="${x + 18}" y="112" text-anchor="middle"
          style="${FONT};font-size:10px" fill="var(--muted-foreground)">${label}</text>
  </g>`;

/**
 * How a skill reaches a teammate's machine.
 *
 * The one thing this drawing has to make obvious is the thing the prose says
 * first: git is not on the path. So git is named once, in the footer, as the
 * thing that is *not* there — a box nobody draws is a box nobody notices.
 */
const skillFlow = `
<svg viewBox="0 0 800 300" width="100%" role="img"
     aria-label="A skill goes from an admin to the drymem server to each teammate's machine. Git is not involved."
     style="max-width:800px;height:auto">
  <title>How a skill reaches a teammate's machine</title>

  <text x="0" y="16" style="${FONT};font-size:10.5px;font-weight:600;letter-spacing:0.06em" fill="var(--muted-foreground)">ADMIN — WEB UI OR CLI</text>
  <text x="286" y="16" style="${FONT};font-size:10.5px;font-weight:600;letter-spacing:0.06em" fill="var(--muted-foreground)">DRYMEM SERVER</text>
  <text x="572" y="16" style="${FONT};font-size:10.5px;font-weight:600;letter-spacing:0.06em" fill="var(--muted-foreground)">EVERY TEAMMATE'S MACHINE</text>

  ${stage(0, "01", "Add a skill", [
    "Written, distilled from your own",
    "memory, or imported.",
    "",
    "Then: enable it on a project.",
  ])}
  ${arrow(236, "publish")}
  ${stage(286, "02", "Scanned, then published", [
    "A credential is refused outright;",
    "a finding waits for an admin.",
    "",
    "Enabling pins a version.",
  ])}
  ${arrow(522, "pull")}
  ${stage(572, "03", "Fetched at session start", [
    "The hook asks for this project's",
    "enabled skills, with this",
    "machine's own token, and writes",
    "them to disk.",
  ])}

  <rect x="0" y="232" width="800" height="52" rx="10"
        fill="var(--muted)" stroke="var(--border)" />
  <!-- One text element with flowing tspans: measuring a monospace run by hand
       and positioning what follows it leaves a gap that is wrong at every
       font size but the one it was guessed at. -->
  <text x="18" y="254" style="${FONT};font-size:11.5px">
    <tspan style="font-weight:600" fill="var(--foreground)">Nothing is committed.</tspan>
    <tspan dx="6" fill="var(--muted-foreground)">Skills land in</tspan>
    <tspan dx="6" style="${MONO};font-size:11px" fill="var(--foreground)">.claude/skills/&lt;name&gt;/SKILL.md</tspan>
    <tspan dx="6" fill="var(--muted-foreground)">— gitignored, and generated.</tspan>
  </text>
  <text x="18" y="272" style="${FONT};font-size:11.5px" fill="var(--muted-foreground)">Removing one is the same path: the next session deletes it, and never touches a skill somebody wrote by hand.</text>
</svg>`;

export const DIAGRAMS: Record<string, string> = {
  "skill-flow": skillFlow,
};
