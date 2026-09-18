#!/usr/bin/env bash
#
# Set drymem up on this machine, by asking rather than by being read about.
#
# Everything here ends as a `.env` next to the compose file. You can write that
# file by hand instead — `.env.example` documents every setting — but the two
# things people get wrong are the embedding dimension and a port that is
# already taken, and both are checked here rather than discovered later.
#
#   ./scripts/install.sh
#
# Nothing is overwritten without being asked, and nothing leaves this machine.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT/.env"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim()  { printf '\033[2m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
die()  { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

# Read an answer, offering a default. Empty input takes the default.
ask() {
  local prompt=$1 default=${2:-} answer
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " answer </dev/tty
    printf '%s' "${answer:-$default}"
  else
    read -r -p "$prompt: " answer </dev/tty
    printf '%s' "$answer"
  fi
}

yes_no() {
  local prompt=$1 default=${2:-y} answer
  read -r -p "$prompt [$([ "$default" = y ] && echo 'Y/n' || echo 'y/N')]: " answer </dev/tty
  answer=${answer:-$default}
  case "$answer" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

port_free() {
  # A port already listening is the failure people spend an evening on, because
  # compose reports it as a container that exited rather than as a busy port.
  ! (command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":$1 ") &&
  ! (command -v lsof >/dev/null && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1)
}

ask_port() {
  local prompt=$1 default=$2 port
  while true; do
    port=$(ask "$prompt" "$default")
    if port_free "$port"; then printf '%s' "$port"; return; fi
    warn "  Port $port is already in use on this machine." >&2
    default=$((port + 1))
  done
}

# ---- before anything --------------------------------------------------------

bold "drymem — setup"
echo

command -v docker >/dev/null || die "Docker is not installed. drymem runs as containers; install Docker first."
docker compose version >/dev/null 2>&1 || die "This Docker has no 'compose' subcommand. Docker Compose v2 is required."
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it and try again."

if [ -f "$ENV_FILE" ]; then
  warn "A .env already exists here."
  yes_no "Replace it?" n || { echo "Left it alone. Nothing changed."; exit 0; }
  cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d%H%M%S)"
  dim "Kept a copy of the old one next to it."
fi
echo

# ---- who is this for --------------------------------------------------------

bold "1. Who will use this?"
dim "A team server has to be reachable by everyone's machine. On your own"
dim "laptop, the default address is right and nothing else needs deciding."
echo
# The two answers are genuinely different deployments, not the same one with a
# different address. On a laptop the containers share the host's network so the
# engine can reach an Ollama on loopback; on a server that would publish
# Postgres and Neo4j on the box's real interfaces, so everything moves to a
# private bridge and only the API is exposed.
COMPOSE=(-f docker-compose.yml)
TEAM=false

if yes_no "Just you, on this machine?" y; then
  PUBLIC_URL="http://127.0.0.1:8080"
  COOKIE_SECURE=false
  dim "  → $PUBLIC_URL"
else
  TEAM=true
  COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml)
  echo
  dim "The address teammates will type. Use https if there is a TLS terminator"
  dim "in front — session cookies travel in the clear otherwise."
  PUBLIC_URL=$(ask "  Address" "https://drymem.example.com")
  case "$PUBLIC_URL" in https://*) COOKIE_SECURE=true ;; *) COOKIE_SECURE=false ;; esac
  if [ "$COOKIE_SECURE" = false ]; then
    warn "  Not https — cookies will not be marked secure. Put a TLS terminator"
    warn "  in front before anybody signs in over a network."
  fi
  dim "  Server layout: only the API is published. The databases stay on a"
  dim "  private network and are not reachable from outside this machine."
fi
echo

# ---- the model --------------------------------------------------------------

bold "2. Which model?"
dim "drymem calls a model twice: to pull entities out of each memory as it is"
dim "saved, and to answer questions in chat. It also needs an embedding model."
echo

EXTRACTOR=ollama
LOCAL_LLM_URL="http://localhost:11434/v1"
LOCAL_LLM_MODEL="qwen3.6:35b-a3b"
EMBEDDING_MODEL="nomic-embed-text"
EMBEDDING_DIM=768
ANTHROPIC_API_KEY=""

if yes_no "Run the model locally, with Ollama?" y; then
  if [ "$TEAM" = true ]; then
    dim "  On a server the containers are on their own network, so an Ollama on"
    dim "  this same host is http://host.docker.internal:11434/v1 — and it must"
    dim "  be listening on more than loopback (OLLAMA_HOST=0.0.0.0) or nothing"
    dim "  will reach it."
    LOCAL_LLM_URL="http://host.docker.internal:11434/v1"
  fi
  LOCAL_LLM_URL=$(ask "  Ollama address" "$LOCAL_LLM_URL")
  base=${LOCAL_LLM_URL%/v1}
  # The address the engine will use is not always one this shell can reach, so
  # a failure to connect from here is a warning rather than a verdict.
  [ "$TEAM" = true ] && base=${base/host.docker.internal/127.0.0.1}

  if curl -fsS --max-time 4 "$base/api/tags" >/dev/null 2>&1; then
    dim "  Reached it."
    installed=$(curl -fsS --max-time 4 "$base/api/tags" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 || true)
    [ -n "$installed" ] && { dim "  Models it already has:"; printf '%s\n' "$installed" | sed 's/^/    /'; }
  else
    warn "  Could not reach Ollama there. Carrying on — start it before drymem."
  fi

  LOCAL_LLM_MODEL=$(ask "  Model for memory and chat" "$LOCAL_LLM_MODEL")
  EMBEDDING_MODEL=$(ask "  Embedding model" "$EMBEDDING_MODEL")

  # Ask the model itself how wide its vectors are. Getting this wrong does not
  # fail at boot — it fails later, when a search returns nothing and nobody
  # knows why, because the stored vectors and the query have different shapes.
  measured=$(curl -fsS --max-time 20 "$base/api/embeddings" \
      -d "{\"model\":\"$EMBEDDING_MODEL\",\"prompt\":\"drymem\"}" 2>/dev/null \
    | tr ',' '\n' | grep -c . || true)
  if [ "${measured:-0}" -gt 64 ]; then
    EMBEDDING_DIM=$measured
    dim "  Measured its embedding width: $EMBEDDING_DIM"
  else
    warn "  Could not measure the embedding width; ask the model's docs."
    EMBEDDING_DIM=$(ask "  Embedding dimensions" "$EMBEDDING_DIM")
  fi
else
  EXTRACTOR=anthropic
  dim "  Memories are summaries your agent wrote — not your source — but they"
  dim "  will be sent to Anthropic's API. Nothing else changes."
  ANTHROPIC_API_KEY=$(ask "  Anthropic API key")
  [ -n "$ANTHROPIC_API_KEY" ] || die "An API key is required when not running a local model."
fi
echo

# Embeddings are separate, and never optional: everything stored gets one,
# whether or not anything was extracted from it.
bold "2b. Embeddings"
dim "Every memory is embedded so it can be searched, even when extraction is"
dim "switched off. This can be the same Ollama, or a hosted provider if this"
dim "machine has no business running a model at all."
echo
if yes_no "Use a local model for embeddings?" "$([ "$EXTRACTOR" = ollama ] && echo y || echo n)"; then
  EMBEDDING_URL=""
  EMBEDDING_API_KEY=""
  if [ "$EXTRACTOR" != ollama ]; then
    LOCAL_LLM_URL=$(ask "  Ollama address, for embeddings" "$LOCAL_LLM_URL")
    EMBEDDING_MODEL=$(ask "  Embedding model" "$EMBEDDING_MODEL")
  fi
else
  dim "  Any OpenAI-compatible embeddings endpoint."
  EMBEDDING_URL=$(ask "  Endpoint" "https://api.openai.com/v1")
  EMBEDDING_API_KEY=$(ask "  API key")
  EMBEDDING_MODEL=$(ask "  Embedding model" "text-embedding-3-small")
  EMBEDDING_DIM=$(ask "  Embedding dimensions" "1536")
  [ -n "$EMBEDDING_API_KEY" ] || die "A hosted embeddings endpoint needs a key."
fi
echo

# ---- ports ------------------------------------------------------------------

bold "3. Databases"
dim "drymem keeps two: Postgres for the index — who wrote what, when, and what"
dim "it was rated — and Neo4j for the memory text itself. Either can run here in"
dim "a container, or be one you already have."
echo

PROFILES=()
DATABASE_URL=""
API_DATABASE_URL=""
NEO4J_URI=""
NEO4J_USER="neo4j"
BUNDLED_PG=true
BUNDLED_NEO=true

if yes_no "Run Postgres here, in a container?" y; then
  PROFILES+=("bundled-postgres")
else
  BUNDLED_PG=false
  dim "  The connection string, e.g. from Neon or RDS."
  pg=$(ask "  Postgres URL" "postgres://user:password@host:5432/drymem")
  # Two drivers, one database: the engine speaks asyncpg, the API speaks libpq.
  API_DATABASE_URL="$pg"
  DATABASE_URL="postgresql+asyncpg://${pg#*://}"
  dim "  The engine will use postgresql+asyncpg://…, the API the plain form."
fi

if yes_no "Run Neo4j here, in a container?" y; then
  PROFILES+=("bundled-neo4j")
else
  BUNDLED_NEO=false
  dim "  A bolt address, e.g. from Neo4j Aura. Aura uses neo4j+s://."
  NEO4J_URI=$(ask "  Neo4j URI" "neo4j+s://xxxxxxxx.databases.neo4j.io")
  NEO4J_USER=$(ask "  Neo4j user" "neo4j")
  NEO4J_PASSWORD_EXTERNAL=$(ask "  Neo4j password")
  [ -n "$NEO4J_PASSWORD_EXTERNAL" ] || die "A managed Neo4j needs its password."
fi
echo

bold "4. Ports"
dim "Only the API is published to the world. The databases are bound to this"
dim "machine so you can inspect them; nothing outside can reach them."
echo
API_PORT=$(ask_port "  API (the console and the CLI)" 8080)
NEO4J_BOLT=7687
NEO4J_HTTP=7474
POSTGRES_PORT=5432
if [ "$BUNDLED_NEO" = true ]; then
  NEO4J_BOLT=$(ask_port "  Neo4j, bolt" 7687)
  NEO4J_HTTP=$(ask_port "  Neo4j, browser" 7474)
fi
[ "$BUNDLED_PG" = true ] && POSTGRES_PORT=$(ask_port "  Postgres" 5432)
echo

# ---- write it ---------------------------------------------------------------

secret() { head -c 24 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_'; }

SERVICE_SECRET=$(secret)
# The databases get their own credentials per install. A password shipped in a
# public repository is a password every drymem on the internet shares, and these
# two listen on loopback for exactly as long as nobody changes that.
POSTGRES_PASSWORD=$(secret)
NEO4J_PASSWORD=$(secret)
# A managed Neo4j has a password already; ours would lock us out of it.
[ "$BUNDLED_NEO" = false ] && NEO4J_PASSWORD=$NEO4J_PASSWORD_EXTERNAL

cat > "$ENV_FILE" <<ENV
# Written by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Every setting is documented in .env.example.

# Signs the token the API hands the memory engine. Generated here; changing it
# invalidates nothing stored, but every signed-in session has to sign in again.
SERVICE_SECRET=$SERVICE_SECRET

# The address people type. Invitation and reset links are built from it.
PUBLIC_URL=$PUBLIC_URL
COOKIE_SECURE=$COOKIE_SECURE

# ---- the model --------------------------------------------------------------
DRYMEM_EXTRACTOR=$EXTRACTOR
LOCAL_LLM_URL=$LOCAL_LLM_URL
LOCAL_LLM_MODEL=$LOCAL_LLM_MODEL
EMBEDDING_MODEL=$EMBEDDING_MODEL
EMBEDDING_DIM=$EMBEDDING_DIM
# Empty means embeddings follow LOCAL_LLM_URL with no key, which is an Ollama.
EMBEDDING_URL=$EMBEDDING_URL
EMBEDDING_API_KEY=$EMBEDDING_API_KEY
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY

# ---- the databases ----------------------------------------------------------
# Which of them run here. Leaving a profile out means drymem expects that
# database to already exist at the URL below.
COMPOSE_PROFILES=$(IFS=,; echo "${PROFILES[*]}")

# Generated for a database we start ourselves; for a managed one this is the
# password it already had. Changing either after the first start orphans the
# data written under the old one.
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
NEO4J_PASSWORD=$NEO4J_PASSWORD

# Empty means "the container started above". Set, they point somewhere else —
# the engine speaks asyncpg and the API speaks libpq, so Postgres appears twice.
DATABASE_URL=$DATABASE_URL
API_DATABASE_URL=$API_DATABASE_URL
NEO4J_URI=$NEO4J_URI
NEO4J_USER=$NEO4J_USER

# ---- ports ------------------------------------------------------------------
PORT=$API_PORT
NEO4J_BOLT_PORT=$NEO4J_BOLT
NEO4J_HTTP_PORT=$NEO4J_HTTP
POSTGRES_PORT=$POSTGRES_PORT

# ---- optional ---------------------------------------------------------------
# Invitations and password resets by email. Without a key the links are handed
# to the admin who made them and written to the server log, which works.
RESEND_API_KEY=
EMAIL_FROM=drymem <onboarding@resend.dev>

# Sign in with GitHub. Off unless both are set.
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Extra patterns the scrubber should refuse, comma separated.
SCRUB_DENYLIST=
ENV

chmod 600 "$ENV_FILE"
bold "Wrote .env"
dim "Readable only by you. It holds the secret that signs sessions."
echo

# ---- start it ---------------------------------------------------------------

if yes_no "Start drymem now?" y; then
  echo
  (cd "$ROOT" && COMPOSE_PROFILES="$(IFS=,; echo "${PROFILES[*]}")" docker compose "${COMPOSE[@]}" up -d --build)
  echo
  dim "Waiting for it to come up…"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1; then
      bold "drymem is running at $PUBLIC_URL"
      echo
      echo "  1. Open it and create the first account — that one owns the organisation."
      echo "  2. In a repository you work in, run: npx drymem@latest setup"
      echo
      exit 0
    fi
    sleep 2
  done
  warn "It did not answer on /healthz within two minutes."
  echo "  docker compose ${COMPOSE[*]} logs -f     # to see why"
  exit 1
fi

echo
echo "When you are ready:"
echo "  docker compose ${COMPOSE[*]} up -d --build"
