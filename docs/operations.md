# Running drymem

## Backups

**Both databases, or neither.** Postgres holds the index — who wrote what, when,
which project, what it was rated. Neo4j holds the only copy of the memory's
*text*. Back up one and not the other and you restore a product that lists
memories it cannot show you.

```bash
scripts/backup.sh dump backups/          # backups/drymem-<timestamp>/
scripts/backup.sh restore backups/drymem-20260916T203135Z
```

Both run against `docker-compose.yml` by default. `COMPOSE_PROJECT` and
`COMPOSE_FILE` point them at another deployment.

**It stops the stack.** Neo4j Community has no online backup, and half a page
file restores worse than no file. For a pilot on one machine, a minute of
downtime is the right trade — the alternative is Neo4j Enterprise, which is a
different decision and a licence.

**Restore replaces everything.** Both volumes are emptied and reloaded. There is
no merge, and no undo.

### This procedure has been run

Not just written. On the rehearsal stack: two memories saved with distinctive
text, a dump taken, `docker compose down -v` to destroy both volumes, then a
restore. Postgres came back with its rows and — the part that matters — the
memory *text* came back from Neo4j, readable through the API. A backup that has
never been restored is a hypothesis.

Test yours the same way, on a copy, before you need it.

## What to watch

- `GET /healthz` reports both stores. `{"status":"degraded"}` means the API is
  up and the engine is not.
- `drymem-admin stats --days 14` prints what the pilot is judged on.
- The audit trail (`/v1/audit`, admins only) records every shared change, and
  refused saves — a credential caught by the scrubber shows up there.

## Adding an organisation

`POST /auth/signup` works exactly once: the first account creates the
organisation, and everyone after that arrives by invitation. A second
organisation on the same server is provisioned by the operator:

```bash
drymem-admin org-create "Beta" --owner someone@beta.test --owner-name "Their Name"
```

The owner is created **without a password** and sets their own through *Forgot
password* on the sign-in page. Nobody provisioning an account should choose, see
or transmit a password.

## Email

Four messages leave drymem: a welcome, an invitation, a password reset, and a
notice that a password was changed. All of them are best-effort — the invitation
and reset links are also returned to the admin or written to the server log, so
a server with no mail configured is fully usable.

**There is no activation email, deliberately.** An invitation link is already
proof that somebody holds the mailbox, and the one signup a server ever accepts
is made by the person installing it, who is sitting in front of it — gating that
on a click in an email would lock the owner out of their own server on the
default configuration, which has no mail at all. The welcome takes its place: it
carries `drymem login` and `drymem setup`, the two commands the browser cannot
run for you, and without which a signed-in account is connected to nothing.

Set `RESEND_API_KEY` and `EMAIL_FROM` to turn sending on.

**The sender is the part that catches people out.** The default,
`onboarding@resend.dev`, is Resend's shared test address, and it delivers only
to the address that owns the Resend account:

```
email to someone@acme.test refused: You can only send testing emails to your
own email address (...). To send emails to other recipients, please verify a
domain at resend.com/domains
```

That is enough to check your own reset email and no use at all for inviting a
teammate. Before anyone else is invited, verify a domain at
[resend.com/domains](https://resend.com/domains) and point `EMAIL_FROM` at it.
A refusal is never fatal — it is logged, the flow continues, and the link is
still there to paste — but nobody receives anything.

The letterhead carries the drymem mark as an inline attachment, about two
kilobytes per message. Nothing is fetched: these emails make no request at all,
so there is no image to block, nothing to break on an install nobody outside can
reach, and no way for anyone to learn that a message was opened.

To see what the four look like before changing them:

```bash
pnpm --filter @drymem/api run email:preview /tmp/mail          # writes HTML + text
RESEND_API_KEY=… pnpm --filter @drymem/api run email:preview -- --send you@example.com
```

A browser is not an inbox: Gmail rewrites the markup and Outlook lays it out
with Word, so the `--send` half is the one that counts.

## Upgrading

Alembic owns the schema; the engine runs `alembic upgrade head` on
start, so a normal `docker compose up -d --build` migrates.

One migration must be run by hand, once, on any deployment that predates it:

```bash
drymem-admin migrate-orgs
```

Memory group ids used to be built from the project key alone, so two
organisations tracking the same git remote shared one group. The
new ids include the organisation, which orphans everything already stored until
this has run. It is idempotent.
