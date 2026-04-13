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
    _seed_sedes()
    _seed_default_space()
    _seed_admin_user()
    yield


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
        # Columnas de admin_users
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
    ]
    with engine.connect() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
        conn.commit()


def _seed_sedes():
    """Crea las sedes por defecto si no existen."""
    from .models import Sede
    db = SessionLocal()
    try:
        sedes = [
            {"code": "BUL", "name": "Lima",      "city": "Lima"},
            {"code": "BUT", "name": "Tarapoto",  "city": "Tarapoto"},
            {"code": "BUJ", "name": "Juliaca",   "city": "Juliaca"},
            {"code": "CIA", "name": "CIA",        "city": "Ñaña"},
        ]
        for s in sedes:
            if not db.query(Sede).filter(Sede.code == s["code"]).first():
                db.add(Sede(**s))
        db.commit()
    finally:
        db.close()


def _seed_default_space():
    """Crea el espacio CRAI Lima si no existe ningún espacio."""
    from .models import Space, Sede
    from .config import settings
    db = SessionLocal()
    try:
        if not db.query(Space).first():
            sede = db.query(Sede).filter(Sede.code == "BUL").first()
            db.add(Space(
                id=settings.default_space_id,
                name=settings.default_space_name,
                capacity=settings.default_space_capacity,
                location="Lima",
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
