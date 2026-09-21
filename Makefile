# One command per task, so two package managers never become two workflows.
SERVER := apps/server
TOUR_DIR ?= $(CURDIR)/tour

# The databases take their credentials from .env, and so must anything that
# talks to them directly — the test harness makes its scratch databases on the
# same Postgres `make db-up` started.
ifneq (,$(wildcard .env))
-include .env
export
endif

# `tour` writes into a directory called tour/, so without this make decides
# the target is already built and does nothing.
.PHONY: help dev test types build eval fmt migrate up db-up db-down rehearsal test-e2e tour backup diagrams
help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'

dev: db-up          ## Databases, then the engine and the API in one terminal
	@echo "engine  -> http://127.0.0.1:8090   (internal)"
	@echo "api+web -> http://127.0.0.1:8080   (open this)"
	@trap 'kill 0' EXIT; \
	  ( cd $(SERVER) && DRYMEM_PORT=8090 .venv/bin/uvicorn drymem_server.api.app:app \
	      --host 127.0.0.1 --port 8090 --reload ) & \
	  pnpm --filter @drymem/api run dev & \
	  wait

test:               ## Every suite: engine, control plane, cli, web
	uv --directory $(SERVER) run pytest
	pnpm --filter @drymem/api run test
	pnpm --filter drymem run test
	pnpm --filter @drymem/web run test

test-e2e:           ## The suites that need real Neo4j and Ollama, not the doubles
	@DRYMEM_E2E=1 uv --directory $(SERVER) run pytest -m e2e

rehearsal:          ## A team using drymem on a throwaway stack, start to finish
# Torn down first as well as last: the script's opening check is that the first
# signup creates the organisation, which a stack left running from a previous
# run fails with a 409 that looks like a product bug and is not.
	@docker compose -p drymem-rehearsal -f docker-compose.rehearsal.yml down -v 2>/dev/null || true
	@docker compose -p drymem-rehearsal -f docker-compose.rehearsal.yml up -d --build
	@uv --directory $(SERVER) run python scripts/rehearsal.py; status=$$?; \
	  docker compose -p drymem-rehearsal -f docker-compose.rehearsal.yml down -v; \
	  exit $$status

tour:               ## Record a video of the product being used, end to end
# The rehearsal builds the world the video needs — a team, memories, a skill —
# so the recording is the last thing it does rather than a fixture of its own.
	@mkdir -p $(TOUR_DIR)
	@docker compose -p drymem-rehearsal -f docker-compose.rehearsal.yml down -v 2>/dev/null || true
	@docker compose -p drymem-rehearsal -f docker-compose.rehearsal.yml up -d --build
	@DRYMEM_TOUR=$(TOUR_DIR) uv --directory $(SERVER) run python scripts/rehearsal.py; status=$$?; \
	  docker compose -p drymem-rehearsal -f docker-compose.rehearsal.yml down -v; \
	  command -v ffmpeg >/dev/null 2>&1 && [ -f $(TOUR_DIR)/drymem-tour.webm ] && \
	    ffmpeg -y -loglevel error -i $(TOUR_DIR)/drymem-tour.webm \
	      -c:v libx264 -pix_fmt yuv420p -movflags +faststart $(TOUR_DIR)/drymem-tour.mp4 && \
	    echo "mp4: $(TOUR_DIR)/drymem-tour.mp4"; \
	  exit $$status

backup:             ## Dump both databases (stops the stack for a moment)
	@scripts/backup.sh dump backups/

migrate:            ## Apply the schema. Alembic is the single authority.
	cd $(SERVER) && .venv/bin/alembic upgrade head

# The *engine's* schema, not the whole API. Since the split (D40) identity,
# people, projects, skills and audit live in Express, which has no OpenAPI
# document — so this covers memories, the graph, ask, discover and distill.
types:              ## Regenerate packages/api-types from the engine's OpenAPI schema
	@DRYMEM_EXTRACTOR=fake uv --directory $(SERVER) run python -c \
	  "import json; from drymem_server.api.app import create_app; print(json.dumps(create_app().openapi(), indent=2))" \
	  > packages/api-types/openapi.json
	@pnpm --filter @drymem/api-types run generate
	@git diff --quiet packages/api-types || \
	  (echo "api-types changed — commit the regenerated schema"; exit 1)

eval:               ## Grade the answers: run real questions against the real model
	@DRYMEM_TOKEN="$$(node apps/cli/dist/cli.js token)" \
	 DRYMEM_PROJECT="$$(node apps/cli/dist/cli.js whoami | head -1 | cut -d' ' -f2)" \
	 uv --directory $(SERVER) run python scripts/eval_ask.py $(if $(CASE),--case $(CASE),)

diagrams:           ## Validate and render docs/diagrams with archify (pinned)
	@sh scripts/diagrams.sh

build:              ## Bundle the CLI (base skills included)
	pnpm --filter drymem run build

fmt:                ## Format everything
	uv --directory $(SERVER) run ruff format .

up:                 ## Build and run the whole thing in Docker
	docker compose up -d --build

db-up:              ## Start the local databases
# The databases sit in profiles so a deployment can point at managed ones
# instead; development always wants both here.
	COMPOSE_PROFILES=bundled-neo4j,bundled-postgres docker compose up -d

db-down:            ## Stop them
	docker compose down
