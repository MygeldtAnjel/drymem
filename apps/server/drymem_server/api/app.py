"""The FastAPI application."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from drymem_server.api.routes import router
from drymem_server.service import Forbidden

DESCRIPTION = """
drymem's memory engine.

The knowledge graph, the extractor, the scrubber and the distiller. It is
reached only through the control plane, which authenticates the caller and
passes a signed assertion of who they are; nothing here faces the internet.
"""


def create_app() -> FastAPI:
    app = FastAPI(
        title="drymem",
        version="2.1.0",
        description=DESCRIPTION.strip(),
        openapi_url="/openapi.json",
    )
    app.include_router(router)

    # Raised from the service layer, where permissions actually live (D31).
    @app.exception_handler(Forbidden)
    async def forbidden(_: Request, exc: Forbidden) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=403)

    return app


app = create_app()
