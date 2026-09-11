# Non-root, no build toolchain in the final image.
FROM python:3.13-slim AS base

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# Dependencies first: this layer is cached until pyproject or the lock changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY drymem_server/ ./drymem_server/
COPY migrations/ ./migrations/
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 drymem && chown -R drymem:drymem /app
USER drymem

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).status==200 else 1)"

# Migrations run on start so a fresh volume is usable without a manual step.
# DRYMEM_BIND defaults to the container-network case; host networking sets it
# to 127.0.0.1 so the server is not published to the LAN.
ENV DRYMEM_BIND=0.0.0.0
CMD ["sh", "-c", "alembic upgrade head && uvicorn drymem_server.api.app:app --host $DRYMEM_BIND --port 8080"]
