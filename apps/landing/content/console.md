# The console

The web console is where a person reads the memory, decides what the team
shares, and runs the project. Your agent never needs it; you will.

Sign in at the address your team was given. If you have a token but no
password, use **Forgot password** on the sign-in page.

## Workspace

### Overview

What the project has been learning: memories saved over the last month, split by
kind, and how much of it is shared rather than private. The fastest way to see
whether drymem is actually being used.

### Memories

Everything the agents have written down, newest first. Each row shows its kind,
who wrote it, when, and whether it is **Private** to its author or **Shared**
with the project.

- **Search** takes one or two short words. `auth` finds more than
  `authentication setup flow`.
- **Filter** by kind along the top, and by Everything / Shared / Private on the
  right.
- **Open one** to read it in full, rate whether it was useful, share it with the
  team, or delete it.

Sharing copies the memory into the team's memory and records who vouched for it.
Your own copy stays where it was.

### Chat

Ask a question and get an answer built only from what this project's memory
actually contains, with a card under it for every memory the answer used. If
nothing matches, it says so rather than inventing an answer — that is the whole
point of it.

Answers are grounded in what you are allowed to read. A teammate's private
memory can never appear in yours.

### Decisions

The same memories as a tree, rooted on the parts of the codebase they are about.
Useful when you want *what has this team decided about payments* rather than
*what happened last Tuesday*.

### Sessions

One row per sitting an agent had: when it was, who, and what came out of it.
Open one to see every memory that session produced.

### Skills

Three tabs:

- **On this project** — what is installed on every machine on this project.
- **Catalogue** — everything the organisation has. Turning one on pins this
  project to a version; other projects are unaffected.
- **Suggested** — subjects this project keeps re-learning that have nothing
  written for them. drymem drafts a skill from your own memory; you read it
  before anything is published.

## Administration

### Projects

Every project the organisation has, who leads it, and how many memories it
holds. This is also where a project's **capture mode** is set.

### Members

Who is in the organisation, their role, and the invitations that have not been
accepted yet. Admins invite by email; nobody can sign themselves up.

### Audit

Who did what: invitations, role changes, shared memories, published skills, and
saves the scrubber refused. Admins only — a member cannot read it.

### Settings

Your own name and password, the machines signed in as you, this project's
capture mode, and the token the CLI uses.
