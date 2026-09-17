/**
 * The two icons the page needs, drawn rather than installed.
 *
 * `☀` and `☾` were the first attempt and they were wrong: a text glyph is a
 * *character*, so it lands on the font's baseline, takes the font's own weight,
 * and renders as a different picture on every platform — on some, as an emoji
 * in full colour. A 16px stroked path is the same shape everywhere, inherits
 * `currentColor`, and centres on the button rather than on a text baseline.
 *
 * Two paths is not worth an icon dependency; if a third is ever needed, it is.
 */

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const Sun = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

export const Moon = () => (
  <svg {...base}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);
