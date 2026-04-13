from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import init_db, SessionLocal
from .routers import scan, dashboard, photo
from .routers import admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _run_migrations()
    _seed_default_space()
    _seed_admin_user()
    yield


def _run_migrations():
    """Agrega columnas nuevas sin Alembic. Idempotente gracias a IF NOT EXISTS."""
    from sqlalchemy import text
    from .database import engine
    migrations = [
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS open_time TIME",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS close_time TIME",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS address VARCHAR(200)",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            conn.execute(text(stmt))
        conn.commit()


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


def _seed_admin_user():
    from .models import AdminUser
    from .config import settings
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db = SessionLocal()
    try:
        if not db.query(AdminUser).first():
            db.add(AdminUser(
                username="admin",
                password_hash=pwd_context.hash(settings.admin_initial_password),
                role="superadmin",
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
app.include_router(admin.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}
