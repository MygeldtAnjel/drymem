---
name: drymem
description: A law-library reference volume for team memory — every entry carries its standing, every fact its treatment.
colors:
  ink-900: "#101318"
  ink-850: "#171a1f"
  ink-800: "#1d2127"
  ink-700: "#5a6678"
  ink-600: "#626f82"
  ink-400: "#8b95a6"
  ink-300: "#a3adbb"
  ink-200: "#b6bcc6"
  oxblood: "#8c1d2c"
  oxblood-bright: "#d4677a"
  gilt: "#c8a951"
  gilt-dim: "#8a7439"
  paper: "#f1f0ea"
  paper-edge: "#dedcd2"
  paper-ink: "#15161a"
  paper-ink-soft: "#4c515c"
  sig-live: "#2f7d4f"
  sig-team: "#c8a951"
  sig-private: "#8b95a6"
  sig-struck: "#f1f0ea"
  sig-struck-field: "#8c1d2c"
typography:
  display:
    fontFamily: "Spectral, Iowan Old Style, Charter, Georgia, serif"
    fontSize: "clamp(2.5rem, 9vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
  headline:
    fontFamily: "Spectral, Iowan Old Style, Charter, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Spectral, Iowan Old Style, Charter, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Spectral, Iowan Old Style, Charter, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "normal"
  ui:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  dense:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.09em"
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, JetBrains Mono, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  none: "0"
  chip: "2px"
  control: "3px"
spacing:
  hair: "0.25rem"
  tight: "0.5rem"
  snug: "0.625rem"
  base: "0.75rem"
  step: "1rem"
  pane: "1.25rem"
  band: "2rem"
  page: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.gilt}"
    textColor: "{colors.ink-900}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0.5625rem 1rem"
  button-primary-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.gilt-dim}"
    rounded: "{rounded.control}"
    padding: "0.5625rem 1rem"
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink-200}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0.5625rem 1rem"
  button-default-hover:
    backgroundColor: "{colors.ink-800}"
    textColor: "{colors.ink-200}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.oxblood-bright}"
    rounded: "{rounded.control}"
    padding: "0.5625rem 1rem"
  button-danger-hover:
    backgroundColor: "{colors.oxblood}"
    textColor: "{colors.paper}"
  rail-action:
    backgroundColor: "transparent"
    textColor: "{colors.ink-300}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.625rem"
  rail-action-hover:
    backgroundColor: "{colors.ink-800}"
    textColor: "{colors.paper}"
  rail-action-on:
    backgroundColor: "transparent"
    textColor: "{colors.gilt}"
  input-search:
    backgroundColor: "{colors.ink-850}"
    textColor: "{colors.paper}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    padding: "0.4375rem 0.625rem"
  input-token:
    backgroundColor: "{colors.ink-900}"
    textColor: "{colors.paper}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.75rem"
  entry-line:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.75rem"
  entry-line-open:
    backgroundColor: "{colors.ink-800}"
    textColor: "{colors.paper}"
  chip-struck:
    backgroundColor: "{colors.sig-struck-field}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "0 0.3125rem"
  chip-stamped:
    backgroundColor: "transparent"
    textColor: "{colors.gilt}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "0 0.25rem"
  plate:
    backgroundColor: "{colors.ink-850}"
    textColor: "{colors.ink-200}"
    rounded: "{rounded.none}"
    padding: "2.5rem 2.25rem"
    width: "min(30rem, 100%)"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.none}"
    padding: "3rem 3.5rem 0"
---

# Design System: drymem

## Overview

**Creative North Star: "Still Good Law"**

A citator asks one question of every authority: does it still stand? drymem asks
the same of every memory, so the surface is not an app — it is a reference volume
open under a lamp. Cool near-black closes in around the edges; the only lit thing
on screen is the page you are reading, set on India paper. Gilt appears where a
spine would be stamped and nowhere else. Oxblood is the binding: it shows at a
bound edge, at a struck fact, and at the point of no return.

The system is dense, quiet, and typographic. There are no cards, no coloured
status pills competing for attention, no gradients standing in for hierarchy.
Hierarchy comes from three things and only three: the tonal step between the
chrome greys, a hairline rule, and a change of typeface. Every state a reader
must distinguish at a glance is a **drawn mark** — a shape, not a hue — because
the states this product trades in (private, shared, still standing, superseded)
have to survive greyscale, and that is a product requirement rather than a taste.

The confirmed anti-reference is the sidebar-and-cards dark dashboard that every
other memory tool ships. This build refuses it literally: the project sidebar was
designed and then removed, because with one project it was 13rem of empty black
occupying the first viewport. What replaced it is a two-column volume — the index
of entries on the left, the page on the right.

**Key Characteristics:**
- Two columns, never three: the volume index and the page.
- One lit surface. India paper is where reading happens; everything else is chrome.
- State is a shape first, a colour second — four SVG marks with a permanent legend.
- Gilt for standing and selection; oxblood for binding and for striking.
- Square plates, 3px controls, hairline rules; one shadow in the whole system.
- Serif for everything a person reads, mono for everything a machine named.

## Colors

A law library at night: the greys are cool and never warm, the two accents are
materials from a bound book rather than UI colours, and the single light surface
is thin India paper rather than white.

### Primary
- **Gilt** (`{colors.gilt}`): spine stamping. The wordmark, the selected entry's
  3px left rail, the "useful"/shared stamp chips, the primary button's field, the
  chrome focus ring, and text selection. It measures 8.20:1 on the deepest chrome.
  Its scarcity is the point — if gilt appears on more than a few elements per
  screen, it stops reading as stamping and starts reading as a brand colour.
- **Gilt Dim** (`{colors.gilt-dim}`): the same metal without the light on it —
  input focus borders, the frontispiece rule, the stamp chip's hairline, and the
  disabled primary button's outline.

### Secondary
- **Oxblood** (`{colors.oxblood}`): the binding. Exactly five sites: the
  frontispiece plate's bound top edge, the confirm dialog's bound top edge,
  blockquote rules, prose link colour, and the focus ring on paper. One sixth
  site exists inside the app proper — the field behind the superseded chip.
- **Oxblood Bright** (`{colors.oxblood-bright}`): oxblood with enough lightness
  to be read as small text on chrome (5.00:1 on the plate). Error messages, the
  flash's error state, the destructive button's label and its hover text.

### Tertiary
- **Signal Green** (`{colors.sig-live}`): the live/still-stands mark only. It is
  3.69:1 against the chrome, which is why it is never allowed to carry the state
  by itself — the upright bar does that, and the green confirms it.

### Neutral
- **Ink 900** (`{colors.ink-900}`): the room. Page ground, index ground, code
  blocks inside the prose.
- **Ink 850** (`{colors.ink-850}`): the first tonal lift — the margin rail, the
  plates, the search and project fields, the mobile back bar.
- **Ink 800** (`{colors.ink-800}`): the second lift — the open entry's field,
  hover on the default button and rail actions, the flash bar, fact dividers.
- **Ink 700** (`{colors.ink-700}`): every hairline rule and control border
  (3.20:1 — a rule, deliberately below text contrast).
- **Ink 600** (`{colors.ink-600}`): scrollbar thumbs and the default button's
  resting border.
- **Ink 400** (`{colors.ink-400}`): secondary UI text — legends, placeholders,
  the topic key's stem, disabled labels (6.16:1).
- **Ink 300** (`{colors.ink-300}`): primary UI text on chrome — entry glosses,
  rail action labels, dialog body (8.20:1, a 1.388× luminance step over ink-400,
  which is what keeps the two tiers actually distinguishable).
- **Ink 200** (`{colors.ink-200}`): the body default and fact text (9.75:1).
- **Paper** (`{colors.paper}`): India paper — the reading sheet, and the brightest
  text on chrome (entry names, titles, field values).
- **Paper Edge** (`{colors.paper-edge}`): the sheet's own hairlines — its left
  border, rules under `h2`, the running head's underline.
- **Paper Ink** (`{colors.paper-ink}`) / **Paper Ink Soft**
  (`{colors.paper-ink-soft}`): 15.83:1 and 6.97:1 on paper. Body copy and its
  subordinate tier — citation lines, minor headings, list markers, blockquotes.

### Named Rules

**The Binding Rule.** Oxblood is a material, not an accent. It appears at a bound
edge, at a struck fact, at a prose link, and at the paper focus ring — and it is
deliberately absent from the chrome. Adding it to a nav item, a badge, or a chart
series scatters the binding and turns it into decoration.

**The Stamping Rule.** Gilt marks standing and selection only: what is stamped,
what is shared, what is open. It is never a container fill, never a hover state
on its own, and never used on paper — it measures 1.99:1 there.

**The Colour-Never-Alone Rule.** No state is conveyed by hue. Every one of the
four treatment states is a drawn geometry with a word beside it in the legend.
Audit test: screenshot the surface in greyscale; if any state became ambiguous,
the state has been encoded wrong.

## Typography

**Display / Reading Font:** Spectral (fallback Iowan Old Style, Charter, Georgia)
**UI Font:** the OS sans stack (`ui-sans-serif, system-ui, -apple-system, …`)
**Mono Font:** the OS mono stack (`ui-monospace, SF Mono, Cascadia Mono, …`)

**Character:** Spectral is a screen-first serif with enough weight to hold a
several-screen body without tiring, and enough contrast to read as a printed page
rather than a text field. The pairing divides the surface by authorship: the
serif is for what a *person* reads at length, the sans for controls the interface
puts there, the mono for strings a *machine* produced — topic keys, tokens,
counts, code. That split is the whole rule; there is no third decorative face.

Spectral is self-hosted via `@fontsource/spectral` (400, 600, 400-italic). The
mono stack is deliberately unpinned to the OS: it sets identifiers, not lettering.

### Hierarchy
- **Display** (Spectral 600, `clamp(2.5rem, 9vw, 3.5rem)`, line-height 1): the
  frontispiece wordmark, in gilt. One instance in the product.
- **Headline** (Spectral 400, 1.375rem, line-height 1.25): the entry title and
  `h2` inside prose. The entry title is set in **mono**, not serif — it is a
  topic key, not a sentence.
- **Title** (Spectral 400, 1.0625rem): the index heading ("12 entries",
  "4 citing …").
- **Body** (Spectral 400, 1.0625rem, line-height 1.62, measure 66ch): memory
  prose on paper. Drops to 0.9375rem below 760px.
- **UI** (sans, 0.9375rem): the document default on chrome.
- **Dense** (sans, 0.8125rem): every control label, button, gloss, and field.
- **Label** (sans 600, 0.6875rem, 0.09em, uppercase): the `.legend` class — the
  chrome's small-caps voice. Section markers, metadata lines, mark legend terms,
  scope labels.
- **Mono** (0.8125rem, tabular numerals): topic keys, timestamps, counts, tokens.

### Named Rules

**The Two-Voices Rule.** Serif is for prose a person reads; sans is for controls;
mono is for anything a machine named. A topic key never gets set in the serif,
and a paragraph of memory never gets set in the sans.

**The Measure Rule.** The reading column is capped at 66ch (`--measure`) and the
entry head is capped to the same value, so the rule under the title ends where
the prose ends. Widening the pane widens the margin, never the line.

**The No-Kicker Rule.** Headings stand alone. No eyebrow, no all-caps kicker
above a title — the small-caps legend style exists for metadata *beside* or
*below* content, never as a label stacked above a heading that already says what
it is.

**The Space-Above Rule.** Every prose heading carries far more space above it
than below (`2.25em` / `0.65em`), so a heading binds to the text it introduces.

## Layout

**The volume.** A full-viewport CSS grid, two columns:
`minmax(21rem, 29rem) 1fr` — the index, then the page. Below 1100px the index
narrows to `minmax(17rem, 23rem)`. There is no third column; the project selector
lives inline in the index head, beside the wordmark.

**The page.** Itself a grid, `1fr auto`: the India-paper sheet, then the margin
rail (9.5rem, narrowing to 7.5rem below 1100px). The sheet scrolls; the rail does
not. The rail's action list is top-aligned and its instrument readout (entry
count, useful ratio) is pushed to the bottom with `margin-top: auto` — inside the
rail's own column, never floating over the prose.

**Paper insets.** The sheet carries no top padding of its own; the 3rem / 3.5rem
inset lives on an inner wrapper, because a sticky element inside a padded scroll
container is pinned *below* that padding and the running head could not reach the
edge. Insets step down to 2rem at 1100px and 1.75rem / 1.25rem at 760px.

**Rhythm.** Spacing is a small set of repeated values rather than a formal scale:
0.25 / 0.5 / 0.625 / 0.75 / 1 / 1.25 / 2 / 3rem, with 0.4375rem and 0.5625rem
appearing where a control needed an optical rather than a nominal value. Panel
padding is 1.25rem, list-row padding 0.625rem × 0.75rem, icon-to-label gap 0.5rem.

**Phone (≤760px).** The two panes become exclusive, driven by `data-pane` on the
volume: the index *or* the entry, never both stacked — stacking meant scrolling
past a dozen entries to reach the memory, and the actions never came into view.
A back bar appears above the sheet, the margin rail becomes a bottom action bar
(row direction, icon over uppercase label, larger icons at full opacity), the
sheet loses its border and gutter shadow, and the instrument readout is hidden.

**Keyboard.** `/` focuses search, `Escape` backs out one level, `j`/`k` move
through the index from anywhere, and the arrow keys move only when focus is
inside the index — the reading column keeps its own scrolling.

### Named Rules

**The Min-Height-Zero Rule.** Every scrolling track in a grid or flex parent gets
`min-height: 0` — `.page`, `.page__sheet`, `.index`, `.index__scroll`. A grid
item's default `min-height: auto` let a several-screen memory stretch the reading
column to 1288px inside a 900px viewport: the column barely scrolled, the entry
head never left, and prose ran under the running head. This is a rule, not an
incident.

**The Two-Column Rule.** The first viewport is the index and the page. Adding a
navigation sidebar is the one structural move this world refuses outright; new
global controls go into the index head or the margin rail.

## Elevation & Depth

The system is flat. Depth is tonal: three chrome greys (`ink-900` ground,
`ink-850` first lift, `ink-800` second lift) plus hairline rules in `ink-700`.
Panels do not float; they are separated by a 1px line or a step in value.

There is exactly **one** shadow in the product, and it is structural rather than
ambient: a directional gutter cast leftward from the paper's bound edge, which
makes the sheet read as a page lying on the chrome instead of a white rectangle
pasted onto it. It is removed on phones, where the sheet is the full width and
there is no gutter for it to fall into.

Two related devices, both scoped: the modal scrim (`rgb(8 10 13 / 0.72)`) and a
6px backdrop blur behind the running head, which lets prose pass under a
94%-opaque paper band without smearing into it.

### Shadow Vocabulary
- **Gutter** (`box-shadow: -18px 0 40px -24px rgb(0 0 0 / 0.85)`): the paper's
  bound edge against the chrome. The only shadow in the system; desktop only.

### Named Rules

**The One-Shadow Rule.** Depth is value, not blur. If a new surface needs to feel
raised, move it a tonal step and give it a hairline — do not add a second shadow.

## Shapes

Two radii and a deliberate zero.

- **Controls: 3px.** Buttons, inputs, entry rows, the flash bar, code blocks. Just
  enough to read as a control rather than a cell.
- **Chips and marks: 2px.** The struck chip, the stamp chip, the focus ring, the
  mark's own chip. Also the focus outline's radius.
- **Plates: square (0).** The frontispiece plate and the confirm dialog take no
  radius at all, because a book board is square — and because a 3px oxblood top
  edge fights a rounded corner.

Borders do the work radius doesn't: 1px `ink-700` hairlines for structure, a 3px
oxblood top border as a bound edge, a 2px paper-ink rule under the entry title, a
2px oxblood left rule on blockquotes, and a 3px transparent left border on every
entry row that turns gilt when the row is open (`--rail: 3px`), so selection
costs no layout shift.

Even the scrollbars are dressed: 10px, thumb in `ink-600`, inset by a 3px
transparent border via `background-clip: content-box`.

### Named Rules

**The Square-Board Rule.** Anything carrying a bound oxblood edge is square. Radius
and a thick accent border are mutually exclusive.

## Components

### Treatment Marks (signature)

The load-bearing component of this world. Four 12×12 SVG geometries, sized in
`em` (0.75em) so they scale with whatever text they sit beside:

- **Open ring** — private, held, not published (`{colors.sig-private}`).
- **Filled disc** — shared with the project (`{colors.sig-team}`, gilt).
- **Upright bar** — the fact still stands (`{colors.sig-live}`).
- **Struck bar** — superseded: the same upright bar at 0.55 opacity with a rule
  drawn through it, set in paper **on an oxblood chip** rather than in a tint of
  oxblood. The mark measures 7.90:1 against its own chip, and the chip keeps the
  colour the world actually names instead of drifting to a rose that would pass
  contrast but leave the family.

Each carries a `role="img"` and a `<title>` naming the state in words. The legend
(`MarkLegend`) is permanent, not a tooltip: it sits in the index head where a
reader first meets the marks, pairing every shape with its word.

Marks appear at four sites: the citation line in the index, the fact line in
search results, the entry's signal line above its title, and the running head.

### Citation Line (the index row)

The index is a list of citations, not cards. Each row: mark, then a stack of
topic key (mono, with the `payments/` stem dimmed and the leaf bright), a
two-line clamped gloss, and a provenance line of author · date in small caps.
Rows are transparent with a 3px transparent left border; hover lifts the field to
`ink-850`; the open row lifts to `ink-800` and turns its left border gilt.

### Fact Line (citing references)

Search replaces the index's list, not the layout: it becomes the *citing
references* column, showing facts rather than documents. Each fact is a treatment
mark, the fact text, and a metadata line; a superseded fact also carries the
paper-on-oxblood "superseded" chip. Rows are divided by a 1px `ink-800` line
rather than boxed.

### The Page (reading sheet)

India paper, scrolling, bordered left in `paper-edge` and carrying the gutter
shadow. Its head is a signal line (mark + scope in small caps), the topic key as
an `h1` in mono, and a citation line of author · date · time, all capped at the
measure and closed with a 2px paper-ink rule.

**Running head.** A sticky band at the top of the sheet carrying the scope mark
and the entry's leaf name. It is hidden at rest (`opacity: 0`,
`translateY(-100%)`, `pointer-events: none`) and slides in only once the entry
head has scrolled out, via an IntersectionObserver rooted on the sheet and keyed
on the entry id. At rest it would simply repeat the title back to the reader.

### Margin Rail (actions)

The stamp actions live in the margin, as a reader's marginalia would. Each is a
drawn icon plus a word — Useful, Not useful, Share, Delete — at `ink-300`,
lifting to `ink-800`/paper on hover. A stamped action stays gilt. Once an entry
is shared, "Share" is replaced by a non-interactive state line (filled disc +
"Shared"), so the control disappears rather than sitting disabled.

The destructive action is the only oxblood-tinted hover in the chrome: a 22%
oxblood wash with an `oxblood-bright` label.

### Buttons

- **Shape:** 3px radius, 1px border, `0.5625rem 1rem`.
- **Primary (gilt):** gilt field, `ink-900` label, weight 600 — 8.20:1. Used once
  per surface, for the single committing action.
- **Default:** transparent with an `ink-600` border; hover fills `ink-800` and
  brightens the border to `ink-400`.
- **Danger:** oxblood border, `oxblood-bright` label; hover inverts to a solid
  oxblood field with a paper label.
- **Disabled:** expressed by *colour*, never opacity — `ink-400` on an `ink-700`
  border, and the gilt button drops to an outline in `gilt-dim`. A 0.45 opacity
  veil had put every disabled label under 2.2:1.

### Inputs

`ink-850` field (`ink-900` on the frontispiece plate), 1px `ink-700` border, 3px
radius, `ink-400` placeholder, paper-coloured value. Focus swaps the border to
`gilt-dim` and suppresses the outline — the only place in the system where the
focus ring is replaced rather than drawn, because the border is already the
control's edge. The token field is set in mono.

### Chips

Two, both 2px radius and set in the small-caps label voice:
- **Stamped** (`useful` / `not useful`): gilt text inside a `gilt-dim` hairline,
  no fill.
- **Superseded**: paper text on a solid oxblood field — the one filled chip in
  the system, and the one place oxblood appears inside the app proper.

### Dialog

A square `ink-850` plate with a 3px oxblood bound edge, over a
`rgb(8 10 13 / 0.72)` scrim. Small-caps title ("Strike this entry"), the topic
key in mono, the consequence in plain words, and a right-aligned pair where the
safe action takes focus on open and the destructive one is the danger button.

### Frontispiece (sign-in)

A centred square plate on a radial wash that lightens toward the top of the
viewport (`#1b1f26` → `ink-900` at 62%) — the lamp. Gilt wordmark, a `gilt-dim`
hairline rule, the promise in serif, then the token field and the gilt button.
A help block sits below a hairline, naming the exact command that issues a token.

### Icons

Drawn, never typographic: 16×16 SVGs on one grid at stroke-width 1.6, round caps
and joins, sized 1em and set to 0.85 opacity in the rail (1.0 on phones). They
replaced text characters that were being asked to carry meaning — including a
dagger standing in for "delete permanently, no undo".

### Flash

A fixed bottom-centre bar in `ink-800` with an `ink-600` border,
`pointer-events: none`, fading in purely on `:not(:empty)`. Errors recolour the
text to `oxblood-bright`; the container never changes.

### Named Rules

**The Drawn-Mark Rule.** Anything that carries meaning is drawn — an SVG on the
16×16 (icons) or 12×12 (marks) grid. A text character, an emoji, or an icon-font
glyph is never allowed to stand in for a state or an action.

**The Disappear-Don't-Disable Rule.** An action that no longer applies is replaced
by the state it produced, not left on screen greyed out. Disabled styling is
reserved for an action that is momentarily unavailable, like a form mid-submit.

## Do's and Don'ts

### Do:
- **Do** encode every meaningful state as a drawn shape with a word beside it,
  and let colour only confirm it. Greyscale the screen to audit.
- **Do** keep the reading column at the 66ch measure and let extra width become
  margin.
- **Do** put `min-height: 0` on every scrolling track inside a grid or flex parent.
- **Do** reach for a tonal step (`ink-900` → `ink-850` → `ink-800`) and a 1px
  `ink-700` hairline when you need separation.
- **Do** express disabled state with colour, and keep every disabled label above
  4.5:1.
- **Do** set anything a machine named — topic keys, tokens, counts, timestamps —
  in the mono stack, and anything a person reads at length in Spectral.
- **Do** self-host any new typeface. The product promises nothing leaves the
  network, so it cannot fetch its own lettering from a CDN.
- **Do** compute contrast before shipping a colour, and record the number.

### Don't:
- **Don't** add a navigation sidebar or convert the index into a card grid. The
  two-column volume is the thesis, and the dark sidebar-and-cards dashboard is
  the named anti-reference.
- **Don't** scatter oxblood through the chrome. It is a binding, a struck fact,
  and a link — not an accent colour looking for surfaces.
- **Don't** use gilt on India paper. It measures 1.99:1 there; the paper focus
  ring and prose links are oxblood for exactly this reason.
- **Don't** put an all-caps kicker above a heading.
- **Don't** use a text character, emoji, or icon font as an icon or a state marker.
- **Don't** add a second shadow. Depth is value; the gutter cast is the only one.
- **Don't** round a plate that carries a bound oxblood edge.
- **Don't** dim a disabled control with opacity.
- **Don't** repeat the entry title in the running head at rest — the running head
  exists only in the running state.

## Open Items

Recorded because the system is not finished, and a contributor should know which
edges are still rough rather than inherit them as intent.

- **Legend wrap at 900px.** The mark legend wraps and orphans "SUPERSEDED" onto
  its own row. The legend must stay visible at every width — it is the key to the
  whole state vocabulary — so the fix is in its layout, not in hiding it.
- **The struck chip's silhouette.** The oxblood chip is 2.06:1 against the
  `ink-900` field, so at 12px it reads as a red square a beat before it reads as
  a struck bar. The governing measurement is the mark *inside* the chip (7.90:1),
  which is why this ships, but the silhouette is the weak link.
- **The index answers the wrong question.** It shows published-or-not (the scope
  mark), not still-good-or-not. That is the honest limit of the current read path:
  `superseded` is a property of a *fact*, not of an `Episode`, so an entry has no
  standing to display. Exposing `promoted_at` / `invalid_at` on the read path is
  the single highest-value change available to this world — it would let the
  treatment mark, not just the scope mark, appear on every citation line.
- **Unspent ceiling devices** from the citator form, named and deliberately left
  on the table: folio numbering, an "as of" treatment date in the running head,
  parallel-citation small caps, and rule-and-leader alignment down the index.
- **`--step-4` (1.875rem) is declared and never used.** It is not part of the
  ramp above; either spend it or drop it.
