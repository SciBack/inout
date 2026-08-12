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
        # Código de instancia Koha (biblioteca), distinto de sede_id: una sede
        # puede tener más de una biblioteca (p. ej. Lima: BUL y CIA).
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS library_code VARCHAR(20)",
        "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
        # Columna sort2 de Koha (código programa/escuela)
        "ALTER TABLE presence_log ADD COLUMN IF NOT EXISTS patron_program VARCHAR(20)",
        # FK lógica al padrón local (nullable — el aforo no depende de la identidad)
        "ALTER TABLE presence_log ADD COLUMN IF NOT EXISTS person_key VARCHAR(100)",
        "CREATE INDEX IF NOT EXISTS ix_presence_log_person_key ON presence_log (person_key)",
        # Snapshot del campus de origen de la persona al momento del evento
        # (visitantes cruzados entre campus). NULL = no identificado.
        "ALTER TABLE presence_log ADD COLUMN IF NOT EXISTS patron_home_sede VARCHAR(20)",
        # Ensanchado de campos que reciben texto libre de la fuente.
        # LDAP y Koha guardan descripciones donde InOut declaraba códigos cortos:
        # ou llega con 128 caracteres ("Curso Taller de elaboración de tesis…"),
        # title con 80 ("Asistente de Laboratorio … (CICAL)") y sort2 de Koha con
        # 64 ("Diplomatura en Liderazgo, Gestión Educativa…"). Al no caber, el
        # INSERT/UPDATE entero fallaba y la persona no se replicaba —141 por
        # corrida—, y el mismo valor rompía también el escaneo en vivo, que
        # escribe patron_program. ALTER TYPE a un tamaño mayor no reescribe datos
        # ni pierde nada; es idempotente porque repetirlo deja el mismo tipo.
        "ALTER TABLE persons ALTER COLUMN program TYPE VARCHAR(100)",
        "ALTER TABLE persons ALTER COLUMN escuela TYPE VARCHAR(255)",
        "ALTER TABLE persons ALTER COLUMN role TYPE VARCHAR(150)",
        "ALTER TABLE presence_log ALTER COLUMN patron_program TYPE VARCHAR(100)",
        # Columnas de admin_users
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
        # Padrón local de identidades (nueva)
        """
        CREATE TABLE IF NOT EXISTS persons (
            id SERIAL PRIMARY KEY,
            person_key VARCHAR(100) UNIQUE NOT NULL,
            full_name VARCHAR(200),
            first_name VARCHAR(100),
            gender VARCHAR(1),
            category VARCHAR(50),
            faculty VARCHAR(20),
            program VARCHAR(20),
            escuela VARCHAR(100),
            role VARCHAR(50),
            document_number VARCHAR(20),
            email VARCHAR(200),
            home_sede_code VARCHAR(20),
            home_building VARCHAR(100),
            source VARCHAR(50),
            raw JSONB,
            synced_at TIMESTAMPTZ,
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_persons_person_key ON persons (person_key)",
        # Índice de credenciales → person_key (nueva)
        """
        CREATE TABLE IF NOT EXISTS person_identifiers (
            id SERIAL PRIMARY KEY,
            id_type VARCHAR(50) NOT NULL,
            id_value VARCHAR(200) NOT NULL,
            person_key VARCHAR(100) NOT NULL,
            CONSTRAINT uq_person_identifier UNIQUE (id_type, id_value)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_person_identifiers_id_value ON person_identifiers (id_value)",
        "CREATE INDEX IF NOT EXISTS ix_person_identifiers_person_key ON person_identifiers (person_key)",
        # Auditoría de sincronización por proveedor (nueva)
        """
        CREATE TABLE IF NOT EXISTS provider_sync_runs (
            id SERIAL PRIMARY KEY,
            provider VARCHAR(50) NOT NULL,
            started_at TIMESTAMPTZ DEFAULT now(),
            finished_at TIMESTAMPTZ,
            created INTEGER DEFAULT 0,
            updated INTEGER DEFAULT 0,
            errors INTEGER DEFAULT 0,
            status VARCHAR(20)
        )
        """,
        # "dni" era mal nombre: el campo guarda DNI, carné de extranjería o
        # pasaporte indistintamente, no solo DNI peruano. Renombrado a
        # document_number. DO block condicional (no un ALTER simple) porque
        # esta migración corre en cada arranque: en instalaciones ya migradas
        # la columna "dni" ya no existe, y un ALTER RENAME sin guarda
        # reventaría al repetirse.
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='persons' AND column_name='dni')
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='persons' AND column_name='document_number')
            THEN
                ALTER TABLE persons RENAME COLUMN dni TO document_number;
            END IF;
        END $$;
        """,
        # Alinea las filas viejas de person_identifiers con el id_type nuevo.
        # No es cosmético: _sync_identifiers (repository.py) busca credenciales
        # existentes por (id_type, id_value) juntos. Si el código nuevo escribe
        # identifiers con clave "document_number" pero las filas viejas siguen
        # con id_type='dni', no las reconoce como la misma fila y crea una
        # DUPLICADA (no viola el unique constraint porque (id_type,id_value) es
        # una combinación distinta) — mismo valor, dos filas, una basura
        # acumulándose. Este UPDATE cierra esa ventana. Es un UPDATE con WHERE
        # exacto sobre un valor tipo-enum, no sobre dato de usuario.
        "UPDATE person_identifiers SET id_type = 'document_number' WHERE id_type = 'dni'",
        # Coordenadas de sede (modo día/noche real por ubicación geográfica).
        "ALTER TABLE sedes ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION",
        "ALTER TABLE sedes ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION",
        # Identificador de cliente para reenvío idempotente de la cola offline
        # del kiosko (Fase 4): reenviar el mismo evento dos veces no lo duplica.
        "ALTER TABLE presence_log ADD COLUMN IF NOT EXISTS client_event_id VARCHAR(64)",
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_presence_log_client_event_id'
            ) THEN
                ALTER TABLE presence_log
                ADD CONSTRAINT uq_presence_log_client_event_id UNIQUE (client_event_id);
            END IF;
        END $$;
        """,
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
