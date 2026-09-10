# One command per task, so two package managers never become two workflows.
SERVER := apps/server

.PHONY: help dev test types build fmt db-up db-down
help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'

dev: db-up          ## Start Neo4j + Postgres, then the server in reload mode
	uv --directory $(SERVER) run python -m drymem_server.server

test:               ## Python tests, then TypeScript tests
	uv --directory $(SERVER) run pytest
	@[ -f pnpm-lock.yaml ] && pnpm -r test || echo "(no TS packages yet)"

types:              ## Regenerate packages/api-types from the server's OpenAPI schema
	@echo "not yet — arrives with the FastAPI server in step 2A"

build:              ## Bundle the CLI (base skills included)
	@echo "not yet — arrives with the TypeScript client in step 2A"

fmt:                ## Format everything
	uv --directory $(SERVER) run ruff format .

db-up:              ## Start the local databases
	docker compose up -d

db-down:            ## Stop them
	docker compose down
