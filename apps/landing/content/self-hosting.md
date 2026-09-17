# Self-hosting

drymem is the same software whether we run it or you do. If your rules say the
memory lives on your hardware, this is what that takes.

## What you are running

Four things, from one `docker compose`:

| Part | What it is |
|---|---|
| API | The only published port. Identity, projects, skills, audit, and it serves the console. |
| Engine | Memory: scrubbing, storing, searching, answering. Never published. |
| Postgres | The index — who wrote what, when, which project, and what it was rated. |
| Neo4j | The only copy of each memory's text, and the graph over it. |

Plus a model. Point `LOCAL_LLM_URL` at an Ollama on your own network, or set
`DRYMEM_EXTRACTOR=anthropic` with a key if sending summaries to an API is
acceptable to you.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Put a TLS terminator in front of the API and set `COOKIE_SECURE=true`, or
session cookies travel in the clear.

## The first account

`POST /auth/signup` works exactly once: the first account creates the
organisation, and everyone after it arrives by invitation. That is deliberate —
a server left open on a network would otherwise hand ownership to whoever found
it first.

A second organisation on the same server is provisioned from a shell:

```bash
drymem-admin org-create "Their Company" --owner them@example.com
```

The owner is created **without a password** and sets their own through *Forgot
password*. Nobody provisioning an account should choose, see or transmit a
password.

## Backups

**Both databases, or neither.** Postgres holds the index; Neo4j holds the only
copy of the memory text. Back up one and not the other and you restore a product
that lists memories it cannot show you.

```bash
scripts/backup.sh dump backups/
scripts/backup.sh restore backups/drymem-20260916T203135Z
```

It stops the stack while it runs: Neo4j Community has no online backup, and half
a page file restores worse than no file. Restore replaces everything in both
volumes — there is no merge, and no undo.

Test yours on a copy before you need it. A backup that has never been restored
is a hypothesis.

## Email

Set `RESEND_API_KEY` and `EMAIL_FROM` to turn sending on. Four messages leave
drymem: a welcome, an invitation, a password reset, and a notice that a password
changed.

Without a key nothing is blocked — invitation and reset links are returned to
the admin who created them, and written to the server log. That is a perfectly
usable way to run a small team.

**The sender catches people out.** Resend's shared test address delivers only to
the address that owns the Resend account, which is no use for inviting a
teammate. Verify a domain and point `EMAIL_FROM` at it before anyone else is
invited.

## Keeping an eye on it

- `GET /healthz` reports both stores. `{"status":"degraded"}` means the API is up
  and the engine is not.
- `drymem-admin stats --days 14` prints what is actually being used.
- The audit trail records every shared change, and every save the scrubber
  refused.

## Upgrading

The engine migrates its own schema on start, so `docker compose up -d --build`
is the upgrade. Take a backup first anyway.
