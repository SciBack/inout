from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import init_db, SessionLocal
from .routers import scan, dashboard, photo
from .routers import admin
from .services.scheduler import setup_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _run_migrations()
    _seed_sedes()
    _seed_default_space()
    _seed_admin_user()
    setup_scheduler()
    yield
    stop_scheduler()


def _run_migrations():
    """Agrega columnas/tablas nuevas sin Alembic. Idempotente."""
    from sqlalchemy import text
    from .database import engine
    stmts = [
        # Tabla sedes (nueva)
        """
        CREATE TABLE IF NOT EXISTS sedes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            code VARCHAR(20) UNIQUE NOT NULL,
            city VARCHAR(100),
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """,
        # Columna sede_id en spaces
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS sede_id INTEGER REFERENCES sedes(id)",
        # Columnas de spaces agregadas en versión anterior
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS open_time TIME",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS close_time TIME",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS address VARCHAR(200)",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
        # Columna sort2 de Koha (código programa/escuela)
        "ALTER TABLE presence_log ADD COLUMN IF NOT EXISTS patron_program VARCHAR(20)",
        # Columnas de admin_users
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
    ]
    with engine.connect() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
        conn.commit()


def _seed_sedes():
    """Crea las sedes definidas por el overlay de la institución, si las hay.
    Sin sedes_config_path (producto agnóstico) no siembra nada."""
    import json
    import os
    from .models import Sede
    from .config import settings

    path = settings.sedes_config_path
    if not path or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        sedes = json.load(fh)

    db = SessionLocal()
    try:
        for s in sedes:
            if not db.query(Sede).filter(Sede.code == s["code"]).first():
                db.add(Sede(
                    code=s["code"],
                    name=s.get("name", s["code"]),
                    city=s.get("city"),
                ))
        db.commit()
    finally:
        db.close()


def _seed_default_space():
    """Crea el espacio por defecto si no existe ningún espacio.
    Se ancla a la sede default_sede_code del overlay, si está definida."""
    from .models import Space, Sede
    from .config import settings
    db = SessionLocal()
    try:
        if not db.query(Space).first():
            sede = None
            if settings.default_sede_code:
                sede = db.query(Sede).filter(
                    Sede.code == settings.default_sede_code
                ).first()
            db.add(Space(
                id=settings.default_space_id,
                name=settings.default_space_name,
                capacity=settings.default_space_capacity,
                location=sede.city if sede else None,
                sede_id=sede.id if sede else None,
            ))
            db.commit()
    finally:
        db.close()


def _seed_admin_user():
    from .models import AdminUser
    from .config import settings
    import bcrypt as _bcrypt
    db = SessionLocal()
    try:
        if not db.query(AdminUser).first():
            pw_hash = _bcrypt.hashpw(settings.admin_initial_password.encode(), _bcrypt.gensalt()).decode()
            db.add(AdminUser(
                username="admin",
                password_hash=pw_hash,
                role="superadmin",
            ))
            db.commit()
    finally:
        db.close()


app = FastAPI(
    title="InOut — Gestión de Aforo",
    version="1.0.0",
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
    return {"status": "ok", "version": "1.0.0"}
