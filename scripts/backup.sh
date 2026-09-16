#!/usr/bin/env bash
# Back up and restore a drymem deployment.
#
# Two databases, and the graph holds the only copy of every memory's text —
# Postgres has the index, not the words. A backup covering one and not the other
# restores a product that lists memories it cannot show you.
#
# Both are taken with the stack stopped. Neo4j Community has no online backup,
# and a half-written page file restores worse than no file at all. For a pilot
# on one machine, a minute of downtime is the right trade; needing hot backup
# means Neo4j Enterprise, which is a different decision.
#
#   scripts/backup.sh dump  [dir]     -> dir/drymem-<timestamp>/
#   scripts/backup.sh restore <dir>   -> wipes and reloads both volumes
#
# COMPOSE_PROJECT and COMPOSE_FILE point it at a deployment, so the same script
# backs up production and the rehearsal stack.
set -euo pipefail

PROJECT="${COMPOSE_PROJECT:-drymem}"
FILE="${COMPOSE_FILE:-docker-compose.yml}"
compose() { docker compose -p "$PROJECT" -f "$FILE" "$@"; }

volume_named() { # substring -> full docker volume name
  docker volume ls --format '{{.Name}}' | grep "^${PROJECT}_" | grep "$1" | head -1
}

# A throwaway container with the volume and the destination both mounted: the
# host needs no tools and no permissions on the volume's contents.
archive() { # volume, out.tar.gz
  docker run --rm -v "$1":/from -v "$(cd "$(dirname "$2")" && pwd)":/to alpine \
    tar czf "/to/$(basename "$2")" -C /from . 2>/dev/null
}
extract() { # volume, in.tar.gz
  docker run --rm -v "$1":/to -v "$(cd "$(dirname "$2")" && pwd)":/from alpine \
    sh -c "rm -rf /to/*; tar xzf /from/$(basename "$2") -C /to"
}

case "${1:-}" in
  dump)
    out="${2:-backups}/drymem-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$out"
    echo "Stopping $PROJECT so both stores are consistent..."
    compose stop >/dev/null
    archive "$(volume_named pg_data)" "$out/postgres.tar.gz"
    archive "$(volume_named neo4j_data)" "$out/neo4j.tar.gz"
    compose start >/dev/null
    echo "Wrote $out"
    du -sh "$out"/* | sed 's/^/  /'
    ;;
  restore)
    src="${2:?usage: scripts/backup.sh restore <dir>}"
    [ -f "$src/postgres.tar.gz" ] && [ -f "$src/neo4j.tar.gz" ] || {
      echo "Both postgres.tar.gz and neo4j.tar.gz must be in $src" >&2; exit 1; }
    echo "This replaces every memory in $PROJECT."
    compose stop >/dev/null
    extract "$(volume_named pg_data)" "$src/postgres.tar.gz"
    extract "$(volume_named neo4j_data)" "$src/neo4j.tar.gz"
    compose start >/dev/null
    echo "Restored from $src"
    ;;
  *)
    sed -n '2,18p' "$0" | sed 's/^#\{1,\} \{0,1\}//'
    exit 1
    ;;
esac
