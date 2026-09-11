"""The FastAPI application."""

from __future__ import annotations

from fastapi import FastAPI

from drymem_server.api.routes import router

DESCRIPTION = """
Shared long-term memory for AI coding agents.

Every memory belongs to a project, identified by its normalised git remote, and
to the person who saved it. Memories are private until explicitly promoted.
"""


def create_app() -> FastAPI:
    app = FastAPI(
        title="drymem",
        version="2.1.0",
        description=DESCRIPTION.strip(),
        openapi_url="/openapi.json",
    )
    app.include_router(router)
    return app


app = create_app()
