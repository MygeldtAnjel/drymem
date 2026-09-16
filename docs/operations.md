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

## Upgrading

Alembic owns the schema (PLAN.md D41); the engine runs `alembic upgrade head` on
start, so a normal `docker compose up -d --build` migrates.

One migration must be run by hand, once, on any deployment that predates it:

```bash
drymem-admin migrate-orgs
```

Memory group ids used to be built from the project key alone, so two
organisations tracking the same git remote shared one group (PLAN.md D79). The
new ids include the organisation, which orphans everything already stored until
this has run. It is idempotent.
