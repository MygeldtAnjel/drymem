# syntax=docker/dockerfile:1
# Build context is the repo root, so this stage can reach apps/web.

# ── the browser UI ──────────────────────────────────────────────────────────
# Built here and copied in, so the running image carries no Node and no
# build toolchain.
FROM node:22-slim AS web
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY apps/web/ ./apps/web/
WORKDIR /repo/apps/web
RUN pnpm install --no-frozen-lockfile --ignore-scripts \
 && pnpm exec vite build --outDir /web-dist --emptyOutDir

# ── the server ──────────────────────────────────────────────────────────────
FROM python:3.13-slim AS base

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# Dependencies first: this layer is cached until pyproject or the lock changes.
COPY apps/server/pyproject.toml apps/server/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY apps/server/drymem_server/ ./drymem_server/
COPY apps/server/migrations/ ./migrations/
COPY apps/server/alembic.ini ./
COPY --from=web /web-dist/ ./drymem_server/web/
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 drymem && chown -R drymem:drymem /app
USER drymem

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).status==200 else 1)"

# DRYMEM_BIND defaults to the container-network case; host networking sets it
# to 127.0.0.1 so the server is not published to the LAN.
ENV DRYMEM_BIND=0.0.0.0
# Migrations run on start so a fresh volume is usable without a manual step.
CMD ["sh", "-c", "alembic upgrade head && uvicorn drymem_server.api.app:app --host $DRYMEM_BIND --port 8080"]
