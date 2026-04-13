from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import init_db, SessionLocal
from .routers import scan, dashboard, photo


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _seed_default_space()
    yield


def _seed_default_space():
    from .models import Space
    from .config import settings
    db = SessionLocal()
    try:
        if not db.query(Space).first():
            db.add(Space(
                id=settings.default_space_id,
                name=settings.default_space_name,
                capacity=settings.default_space_capacity,
                location="Lima",
            ))
            db.commit()
    finally:
        db.close()


app = FastAPI(
    title="InOut — Gestión de Aforo",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scan.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(photo.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}
