/**
 * Lift the diagram out of an Archify page as a standalone SVG, per theme.
 *
 * `make diagrams` renders each diagram as an explorable HTML page — guided
 * views, a legend, motion. That page is ~800 KB and is the right thing to open
 * on its own; it is the wrong thing to drop into a documentation page, which
 * wants one picture that scales and follows the reader's theme.
 *
 * The SVG inside those pages styles itself entirely through flat classes over
 * CSS variables, and the variables come from `[data-theme]` and `[data-preset]`
 * blocks on an ancestor. So making it standalone is mechanical: resolve the
 * variables for one theme and preset, emit them on the `svg` element itself,
 * append the class rules, and the file no longer needs the page it came from.
 *
 *   node scripts/diagram-svg.mjs <in.html> <out-dir> <basename>
 *
 * Writes `<basename>-light.svg` and `<basename>-dark.svg`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [input, outDir, base] = process.argv.slice(2);
if (!input || !outDir || !base) {
  console.error("usage: diagram-svg.mjs <in.html> <out-dir> <basename>");
  process.exit(2);
}

const html = readFileSync(input, "utf8");

const svgMatch = html.match(/<svg\b[\s\S]*?<\/svg>/);
if (!svgMatch) {
  console.error(`No <svg> in ${input}`);
  process.exit(1);
}
const svg = svgMatch[0];
const preset = svg.match(/data-preset="([^"]+)"/)?.[1] ?? "classic";

const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

/**
 * At-rule blocks, gone. The page carries a print stylesheet that forces the
 * full light palette onto `[data-theme="dark"]`, and it comes last — read
 * flat, it silently makes both themes light.
 */
function withoutAtRules(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@", i);
    if (at === -1) return out + source.slice(i);
    out += source.slice(i, at);
    const semi = source.indexOf(";", at);
    const open = source.indexOf("{", at);
    if (open === -1 || (semi !== -1 && semi < open)) {
      i = semi === -1 ? source.length : semi + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    for (; j < source.length; j += 1) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}" && (depth -= 1) === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/** Every `selector { … }` in source order, comments stripped. */
function rules(source) {
  const out = [];
  const text = withoutAtRules(source.replace(/\/\*[\s\S]*?\*\//g, ""));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ selector: m[1].trim(), body: m[2].trim() });
  return out;
}

const all = rules(css);

/**
 * Variables for one theme, applied in source order so later blocks win — which
 * is how the cascade would have resolved them in the page.
 */
function variablesFor(theme) {
  const vars = new Map();
  const wanted = [
    (s) => s === ":root" || s === "html" || s === "body",
    (s) => s === `[data-theme="${theme}"]`,
    (s) => s === `[data-preset="${preset}"][data-theme="${theme}"]`,
  ];
  for (const { selector, body } of all) {
    for (const part of selector.split(",").map((p) => p.trim())) {
      if (!wanted.some((test) => test(part))) continue;
      for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/gi)) {
        vars.set(name, value.trim());
      }
    }
  }
  return vars;
}

/** The class rules the diagram actually uses, so nothing irrelevant is carried. */
const used = new Set(
  [...svg.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean),
);

function classRules() {
  const out = [];
  for (const { selector, body } of all) {
    const parts = selector.split(",").map((p) => p.trim());
    const keep = parts.filter((p) => {
      const m = p.match(/^\.([a-z0-9-]+)$/i);
      return m && used.has(m[1]);
    });
    if (keep.length && body) out.push(`${keep.join(", ")} { ${body} }`);
  }
  return out;
}

mkdirSync(outDir, { recursive: true });

// Archify draws to the edge of its viewBox: on a page that is fine, because the
// container supplies the margin. A standalone file has no container, so it
// carries its own — and the painted canvas is what makes the dark file readable
// when it is opened on its own rather than on a dark page.
const PAD = 32;
const [vx, vy, vw, vh] = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1000 1000")
  .trim()
  .split(/\s+/)
  .map(Number);
const box = [vx - PAD, vy - PAD, vw + PAD * 2, vh + PAD * 2];
const canvas = `<rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="var(--bg)" />`;

for (const theme of ["light", "dark"]) {
  const vars = variablesFor(theme);
  const declarations = [...vars].map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const style = `<style>\nsvg {\n${declarations}\n}\n${classRules().join("\n")}\n</style>`;

  // The style goes first inside the root element, so nothing paints unstyled,
  // and `data-theme` is stamped on in case a rule still keys off it.
  const out = svg
    .replace(/^<svg\b/, `<svg xmlns="http://www.w3.org/2000/svg" data-theme="${theme}"`)
    .replace(/viewBox="[^"]+"/, `viewBox="${box.join(" ")}"`)
    .replace(/>/, `>\n${style}\n${canvas}`);

  const path = join(outDir, `${base}-${theme}.svg`);
  writeFileSync(path, out);
  console.log(`${path}  ${(out.length / 1024).toFixed(0)} KB  ${vars.size} vars`);
}
