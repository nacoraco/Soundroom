from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import (
    admin_settings,
    admin_users,
    auth,
    discover,
    editor_imports,
    health,
    import_jobs,
    playlists,
    queue,
    radio,
    tracks,
)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(admin_users.router)
    app.include_router(admin_settings.router)
    app.include_router(import_jobs.router)
    app.include_router(editor_imports.router)
    app.include_router(discover.router)
    app.include_router(radio.router)
    app.include_router(queue.router)
    app.include_router(playlists.router)
    app.include_router(tracks.router)
    return app


app = create_app()
