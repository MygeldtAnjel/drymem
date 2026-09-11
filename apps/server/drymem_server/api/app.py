"""The FastAPI application."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from drymem_server.api.auth_routes import router as auth_router
from drymem_server.api.routes import router
from drymem_server.auth import AuthError
from drymem_server.service import Forbidden

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

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
    app.include_router(auth_router)
    app.include_router(router)

    # Raised from the service layer, where permissions actually live (D31).
    @app.exception_handler(Forbidden)
    async def forbidden(_: Request, exc: Forbidden) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(AuthError)
    async def auth_error(_: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=400)

    _serve_web(app)
    return app


def _serve_web(app: FastAPI) -> None:
    """Serve the browser UI from this same origin.

    One origin means no CORS, no second deployment, and no third-party host —
    which matters for a product whose pitch is that nothing leaves the network.
    Mounted last so it can never shadow an API route.
    """
    if not WEB_DIR.is_dir():
        return  # server running without a built UI; the API still works

    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon() -> FileResponse:
        return FileResponse(WEB_DIR / "favicon.svg", media_type="image/svg+xml")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")


app = create_app()
