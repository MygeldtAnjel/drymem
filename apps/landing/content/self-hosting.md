# Self-hosting

drymem is the same software whether we run it or you do. If your rules say the
memory lives on your hardware, this is what that takes.

## Installing it

```bash
git clone https://github.com/MygeldtAnjel/drymem.git
cd drymem
./scripts/install.sh
```

It asks who will use it, which model to call, and which ports to take — checking
each port is actually free rather than letting Docker discover it later — then
writes a `.env`, generates the secret that signs sessions, and offers to start
everything.

If you would rather write the config by hand, copy `.env.example` to `.env` and
fill it in; every setting is documented there.

## What it needs

drymem is four containers and, usually, a model. The model is the part that
decides the numbers.

| | Without a local model | With a local model |
|---|---|---|
| RAM | 4 GB | 24 GB, or a GPU with 16 GB+ |
| CPU | 2 cores | 4 cores, more is better |
| Disk | 10 GB to start | 10 GB, plus the model |

**Without a local model** means embeddings run locally — those are small — and
the reasoning goes to an API. That fits comfortably on the cheapest VPS worth
buying, and on any laptop.

**With a local model** means an Ollama on the same machine. The default
(`qwen3.6:35b-a3b`) wants around 24 GB; a smaller model runs in far less and is
worth trying first. On a machine with a GPU, use it — extraction runs on every
save, and on CPU alone each one takes a noticeable while.

Disk grows with how much the team writes. A year of a busy team's memory is
measured in hundreds of megabytes, not gigabytes — drymem stores summaries, not
transcripts.

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

On your own machine, `./scripts/install.sh` uses the development layout: the
containers share the host's network so the engine can reach an Ollama on
loopback. That is wrong on a server, where it would put Postgres and Neo4j on
the box's real interfaces — so answering "no" to *just you* deploys a different
topology instead:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Everything moves onto a private network and **only the API is published**. This
has been run end to end: sign-up, saving a memory and reading it back all work,
and `docker compose ps` shows the databases with no host ports at all.

### Reaching a model from a server

This is the step people lose an afternoon to. On a private network the host's
loopback is not the container's, so a model running on the same box needs both:

```bash
# in .env
LOCAL_LLM_URL=http://host.docker.internal:11434/v1
```

```bash
# and Ollama itself, listening on more than loopback
OLLAMA_HOST=0.0.0.0 ollama serve
```

Miss the second and nothing announces it: saves still succeed, because
extraction is allowed to fail rather than lose a memory, and every memory is
stored with no entities until somebody notices search is empty. `docker compose
logs engine` says `Error in generating LLM response` when this is happening.

### TLS

The API speaks plain HTTP and expects something in front of it. Anything that
terminates TLS will do — Caddy is the shortest:

```
drymem.your-company.com {
    reverse_proxy 127.0.0.1:8080
}
```

Then set `PUBLIC_URL` to the https address and `COOKIE_SECURE=true`. Without
that second one, session cookies are sent in the clear and the sign-in is worth
nothing on a network you do not own.

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
