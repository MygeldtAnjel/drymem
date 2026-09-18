# Command reference

Every command runs as `npx drymem <command>`. Nothing is installed globally —
the session hooks call it the same way, so the package has to work like this
anyway.

Most commands work out which project you are in from the git remote of the
current directory. Run them inside the repository you mean.

## Getting connected

### `setup`

```bash
npx drymem setup [--server URL] [--global]
```

Configures this repository: signs the machine in through your browser if it has
no token yet, installs Claude Code's session hooks, registers the memory server
with every agent it finds on this machine, and pulls the project's skills. Run
it once per repository, per machine. `--global` configures your agents for every
project instead of this one.

It prints each file it touched. Everything is merged into what was already
there, and a configuration it cannot parse is left alone and reported rather
than rewritten.

**Which server it talks to.** The first time on a machine it asks, defaulting to
`http://localhost:8080` — right if you are running drymem yourself, and where
you type your team's address otherwise:

```
drymem server URL [http://localhost:8080]: https://drymem.acme.com
```

Pass `--server` to skip the question, which is what you want in a script or in
instructions you are handing to a teammate:

```bash
npx drymem@latest setup --server https://drymem.acme.com
```

After the first time it reuses the answer and never asks again. `drymem login
--server …` is how you point a machine at a different server later.

### `login`

```bash
npx drymem login [--server URL]
```

Signs this machine in and stores a token. `setup` does this for you; run it on
its own to point a machine at a different server, or to sign in again after
revoking a token.

### `whoami`

Prints the project drymem resolved, the server it is talking to, and whether
that server is healthy. The first thing to run when something looks wrong.

### `token`

Prints this machine's token. You need it if you are signing in to the console
from a machine where the CLI is already connected.

## Reading memory

### `context`

```bash
npx drymem context [n]
```

The most recent memories for this project, newest first. Defaults to a handful.
This is the same material your agent is given at the start of a session.

### `search`

```bash
npx drymem search <query>
```

Searches this project's memory. **Use one or two short words.** `retry` finds
more than `retry policy for payment webhooks`, because it matches on terms
rather than on the sentence.

### `ask`

```bash
npx drymem ask "why do we stop retrying after three attempts?"
```

An answer built only from what this project's memory contains, with the
memories it used listed underneath. If nothing matches, it says so.

### `ui`

Opens a terminal interface for browsing, searching, rating and sharing without
leaving the shell.

### `projects`

Lists the projects you can see, with how many memories each holds.

## Writing memory

### `save`

```bash
npx drymem save "The staging database password rotates on Fridays."
```

Saves a memory for this project, privately. Use it for the thing you just
worked out that your agent was not part of.

### `save-session`

```bash
npx drymem save-session [--shared] [--type <kind>]
```

Saves deliberately, reading from a file or standard input. This is what a
project set to **manual** capture uses. `--shared` shares it with the team
immediately; `--type` is one of `decision`, `architecture`, `bugfix`,
`discovery`, `convention`, `note`.

### `promote`

```bash
npx drymem promote <episode-id>
```

Shares one of your memories with the project. Your own copy stays; the team gets
a copy that records you as the person who vouched for it.

### `delete`

```bash
npx drymem delete <episode-id>
```

Removes a memory — both copies if it was shared, and its index row. There is no
undo.

### `import`

```bash
npx drymem import <source> [--dry-run]
```

Backfills memory the team already wrote down, rather than starting from nothing.
Sources: `claude-memory`, `git`, `docs`, `ecc`, `engram`. Always run it with
`--dry-run` first — it prints what it would save without saving anything.

## Skills

### `skills list` · `skills catalogue`

`list` shows what this project runs. `catalogue` shows everything the
organisation has published, whether this project uses it or not.

### `skills add` · `skills remove`

```bash
npx drymem skills add <name>
npx drymem skills remove <name>
```

Turns a skill on or off **for this project**. Other projects are unaffected.
Everyone on the project gets the change at their next session; nobody has to run
anything.

### `skills pull`

Fetches the project's enabled skills and writes them to disk now, rather than
waiting for the next session. The escape hatch when you have just enabled
something and do not want to restart your agent.

### `skills publish`

```bash
npx drymem skills publish <path>
```

Publishes a skill to the organisation's catalogue. It is scanned first: a
credential is refused outright, and anything else suspicious waits for an admin
to approve it.

### `skills import`

```bash
npx drymem skills import owner/repo@skill
```

Brings a skill in from outside. Org admins only — an imported skill runs on
every machine on whichever projects enable it.

### `skills status` · `skills diff` · `skills usage`

`status` compares what is on disk with what the server says should be there.
`diff <name>` shows what changed between versions. `usage` shows how often each
skill has actually been read.

### `skills discover` · `skills distill`

`discover` lists subjects this project keeps re-learning with nothing written
for them. `distill <topic>` drafts a skill from those memories for you to read
and edit before anything is published.

## Administration

### `audit`

```bash
npx drymem audit [--security]
```

Who did what. `--security` narrows it to the entries that matter for a review:
refused saves, role changes, and skills published or imported. Admins only.

## Used by your agent, not by you

### `mcp`

Runs the MCP server over stdio. `setup` registers this; you would only run it by
hand when configuring an agent drymem does not set up automatically.

### `hook`

```bash
npx drymem hook <event>
```

Runs a session hook. `setup` installs these into your agent's configuration.
They always exit successfully, even when the server is unreachable — a hook must
never break the session it runs in.

### `--version`

```bash
npx drymem --version
```

Prints the version of the CLI itself, which is the first thing anyone will ask
you for. `version` and `-v` do the same.
