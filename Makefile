# One command per task, so two package managers never become two workflows.
SERVER := apps/server

.PHONY: help dev test types build fmt db-up db-down
help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'

dev: db-up          ## Start Neo4j + Postgres, then the server in reload mode
	uv --directory $(SERVER) run python -m drymem_server.server

test:               ## Python tests, then TypeScript tests
	uv --directory $(SERVER) run pytest
	pnpm --filter drymem run test
	pnpm --filter @drymem/web run test

types:              ## Regenerate packages/api-types from the server's OpenAPI schema
	@DRYMEM_EXTRACTOR=fake uv --directory $(SERVER) run python -c \
	  "import json; from drymem_server.api.app import create_app; print(json.dumps(create_app().openapi(), indent=2))" \
	  > packages/api-types/openapi.json
	@pnpm --filter @drymem/api-types run generate
	@git diff --quiet packages/api-types || \
	  (echo "api-types changed — commit the regenerated schema"; exit 1)

build:              ## Bundle the CLI (base skills included)
	pnpm --filter drymem run build

fmt:                ## Format everything
	uv --directory $(SERVER) run ruff format .

db-up:              ## Start the local databases
	docker compose up -d

db-down:            ## Stop them
	docker compose down
