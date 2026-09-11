---
name: drymem
description: A dark operator's console for a team's shared memory — one warm light, a black cat, and every state named in words as well as colour.
colors:
  background: "#0b0d10"
  foreground: "#e8eaed"
  card: "#111419"
  popover: "#171b21"
  secondary: "#1e232b"
  muted: "#171b21"
  muted-foreground: "#98a1ad"
  primary: "#f2a93b"
  primary-foreground: "#1a1305"
  destructive: "#f0596b"
  success: "#3fb27f"
  border: "#232932"
  input: "#525c6b"
  ring: "#f2a93b"
  chart-1: "#a98bf5"
  chart-2: "#5b9cf5"
  chart-3: "#f0596b"
  chart-4: "#f2a93b"
  chart-5: "#3fb27f"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  chip: "0.375rem"
  control: "0.5rem"
  card: "0.625rem"
  sheet: "0.75rem"
spacing:
  hair: "0.25rem"
  tight: "0.5rem"
  snug: "0.75rem"
  base: "1rem"
  pane: "1.25rem"
  band: "1.5rem"
  page: "2rem"
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: "0 0.625rem"
    height: "2rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    borderColor: "{colors.border}"
    rounded: "{rounded.control}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
  button-destructive:
    backgroundColor: "rgb(240 89 107 / 0.1)"
    textColor: "{colors.destructive}"
  card:
    backgroundColor: "{colors.card}"
    borderColor: "{colors.border}"
    rounded: "{rounded.card}"
    padding: "1.25rem"
  input:
    backgroundColor: "transparent"
    borderColor: "{colors.input}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2.25rem"
  chip-type:
    rounded: "{rounded.chip}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.mono}"
  sidebar:
    backgroundColor: "{colors.card}"
    borderColor: "{colors.border}"
    width: "16rem"
---

# Design System: drymem

## Overview

**Creative North Star: a dark operator's room with one warm light in it.**

drymem is a team's shared memory, and the thing that makes shared memory worth
having is that *anyone on the team* can open it, read it, and run it. So this
surface is an admin console, not a reading room: a rail of destinations, cards
and tables, and every management action — members, roles, projects, skills, your
own profile — reachable without touching a terminal.

The room is a cool near-black in four steps. There is exactly one accent, amber
`#f2a93b`, and it is the eye of the black cat that serves as the product's mark.
Everything else earns attention by position and value, not by colour.

**The anti-reference is the previous build of this same screen**, which dressed
the product as a law-library reference volume: serif prose on India paper, drawn
treatment marks, no sidebar. It was internally consistent and it was wrong — it
made a management tool feel like a book, and the person who has to add a
teammate at 4pm does not want a book. Reading matters here, but it is one of
seven jobs, not the whole product.

**Key Characteristics:**
- A persistent left rail, split into Workspace and Administration. The rail is
  the answer to "where is everything?", and hiding it was the old build's
  central mistake.
- Cards and tables. Dense, scannable, familiar — the shapes people already know
  from every console they use.
- One accent. Amber marks the primary action, the active destination, and
  nothing else.
- Every state is a word first. Colour confirms it.
- shadcn/ui components live as source in the repo, so the design system is
  editable rather than imported.

## Colors

Dark-only, defined once on `:root`. There is no light mode and no `.dark` class
to toggle, which is why no component in this app carries a `dark:` override.

### Primary
- **Amber** (`{colors.primary}`): the one light in the room. 9.24:1 on a card.
  The primary button, the active rail item's icon, the focus ring, the "Useful"
  stamp, the cat's eye in the mark. Its scarcity is the whole point — the moment
  amber appears on more than a few elements per screen it stops reading as *the*
  action and becomes decoration.
- **Amber ink** (`{colors.primary-foreground}`): 9.23:1 on amber. The only thing
  ever set on an amber field.

### Semantic
- **Destructive** (`{colors.destructive}`): 5.58:1. Delete, unpublish, remove,
  sign out, and an unreachable service. Never a hover state on its own.
- **Success** (`{colors.success}`): 6.93:1. A connected service and a shared
  memory — always beside the word "Connected" or "Shared", never alone.

### Neutral
- **Background** (`#0b0d10`): the room.
- **Card / Muted** (`#111419`, `#171b21`): the first and second tonal lift.
  Panels, popovers, inputs, hovers.
- **Secondary / Accent** (`#1e232b`): the third lift — the active rail item's
  field, the secondary button.
- **Border** (`#232932`): hairlines. A decorative boundary, deliberately quiet.
- **Input** (`#525c6b`): control outlines only. A field's edge is a *meaningful*
  boundary, so it takes 3:1 against its own fill rather than the 1.3:1 a
  hairline can live with.
- **Muted foreground** (`#98a1ad`): 7.06:1. Every secondary line of text.
- **Foreground** (`#e8eaed`): 15.31:1 on a card.

### Memory types
Six kinds of memory, six hues, each on its own tinted field and each printed
beside its own word. Every pair clears 7:1 on its own chip:

| Type | Chip | Text | Answers |
|---|---|---|---|
| `decision` | `#1c1930` | `#c4aefa` | Why is it done this way? |
| `architecture` | `#141d2e` | `#8fbcfb` | How is this part put together? |
| `bugfix` | `#2a161b` | `#f7909c` | What broke, and what fixed it? |
| `discovery` | `#2a2113` | `#f7c375` | What is true that nobody wrote down? |
| `convention` | `#122620` | `#6fd1a5` | How does this team do this? |
| `note` | `#1a1f26` | `#aab3bf` | Anything else worth keeping. |

The same five hues are the chart ramp, so a type means the same colour in a chip
and in the mix bar on Overview.

### Named Rules

**The One-Light Rule.** Amber marks the primary action and the current
destination. It is never a container fill, never a hover state, never a decorative
tint, and never two things on one screen competing to be the point.

**The Colour-Never-Alone Rule.** No state is carried by hue. "Shared", "Private",
"Connected", "Superseded", "Useful" and every memory type print their word next
to their colour, and most carry an icon too. Audit test: screenshot the surface in
greyscale; if any state became ambiguous, it is encoded wrong.

**The Measured-Not-Guessed Rule.** Every value in this file was computed against
the surface it sits on before it shipped. The ratios in the comments of
`index.css` are real. A contrast failure here is a regression, not a judgement
call.

## Typography

**UI font:** Geist Variable (self-hosted via `@fontsource-variable/geist`).
**Mono:** JetBrains Mono (self-hosted), for anything a machine named — project
keys, topic keys, session ids, skill slugs, code, the token.

Nothing is fetched from a CDN. The product's pitch is that nothing leaves the
network it is installed on, and a font request is a request.

### Hierarchy
- **Page title** (600, 1.25rem, -0.02em): one per screen, in the content header.
- **Card title** (600, 1.125rem / 0.875rem for dense cards).
- **Body** (400, 0.875rem): the document default.
- **Label** (500, 0.75rem, 0.06em, uppercase): the running terms inside a
  memory's body — Summary, Why, Where, Key details, Learned.
- **Mono** (0.75rem): keys, ids, slugs, commands.

### Named Rules

**The Two-Voices Rule.** Sans for anything a person wrote or an interface says;
mono for anything a machine named. A project key is never set in the sans, and a
memory's title is never set in the mono.

**The Running-Term Rule.** A memory's body splits into sections, and the two
kinds of heading are set differently. A heading from the template (Summary, Why,
Where, Key details, Learned) is a *running term* — the standing question that
section answers — so it takes the small-caps label voice above a hairline. A
heading the author invented stays an ordinary bold heading. Neither is louder;
they are different kinds of thing, and a reader can see the shape of a memory
before reading a word of it.

**The No-Double-Title Rule.** A memory's first heading is what became its title.
Printing it again in the page header, the card header and the body put the same
sentence on screen three times — so the page header says only "Memory", and the
body drops the heading it duplicated.

## Layout

**The shell.** `SidebarProvider` + `Sidebar` + `SidebarInset`. The rail is 16rem,
collapses to icons on demand, and becomes a sheet below `lg`. Its state persists,
and it handles its own focus trap — none of which is worth hand-writing, and all
of which is where hand-written admin navigation usually breaks.

**The rail** is two groups. *Workspace* is what the team's memory is: Overview,
Memories, Sessions, Skills. *Administration* is how it is run: Projects, Members,
Settings. The split exists so the daily screens are not buried under the ones you
visit twice a month.

**The header** carries the sidebar trigger and the project switcher, and nothing
else. Which project you are looking at changes the meaning of every number on
every screen, so it is the one control that is always visible.

**The content column** is `max-w-7xl`, with the page title, an optional
description, and an optional action row at the top of every screen. Forms are
capped at `max-w-3xl` — a field 1100px wide is not more readable for it.

**Responsive.** One column below `sm`, two or three above `lg`. Tables get their
own `overflow-x-auto` and are the only thing allowed to be wider than the page;
the body never scrolls sideways.

### Named Rules

**The Rail-Is-The-Map Rule.** Every screen in the product is reachable from the
rail in one click. A screen that is only reachable by clicking through another
screen does not exist as far as most people are concerned.

**The Cards-Size-To-Content Rule.** Grids of cards use `items-start`. Stretching
a short card to match a tall one beside it produces a panel that is mostly empty
and looks broken.

## Elevation & Depth

Flat, and depth is value: `background` → `card` → `muted` → `secondary`, plus
hairline borders. The only shadows in the product belong to things that genuinely
float above the page — the dialog, the dropdown, the mobile sheet, the toast.

## Components

### The mark (signature)

A black cat's head, drawn as three SVG paths, with amber almond eyes and slit
pupils. Drawn rather than fetched: no request, any size, and it inherits the
surface it sits on. It appears at the top of the rail, on the sign-in page, and
as the favicon. The eyes are the only lit thing in it — the light in the console
is the cat looking back at you.

### Memory row

The core repeated unit. A type chip, the title, a scope chip and any rating on
the right, two clamped lines of the body, then author · relative time · topic key
in mono. Scannable at forty rows; readable at one.

### Memory page

Two columns above `lg`: the body on the left, a Details card and an actions card
on the right. The body renders its sections as running terms; the Details card
carries kind, author, when, project, topic, session and visibility — the session
links through to the run that produced it.

### Empty and loading states

Every list has both, and neither is a spinner in the middle of a blank page.
Loading is a skeleton shaped like the rows that are coming. Empty says what would
put something there — usually a specific command — because "No data" tells a new
user nothing they can act on.

### Toasts

Every action that reaches the server ends in one, success or failure, in words.
A silent success is indistinguishable from a click that did nothing, and that is
the fastest way for an admin screen to lose someone's trust. Errors carry the
server's own message and stay long enough to read.

### Named Rules

**The Say-What-Happened Rule.** No server action completes silently. No
destructive action happens without a dialog that names the thing and says what is
and is not lost.

**The Explain-The-Locked-Field Rule.** A field that cannot be edited is still
shown, disabled, with one line saying why and where it *can* be changed. "Why can
I not change this?" is better answered once, in place, than left to someone
hunting for a control that does not exist.
