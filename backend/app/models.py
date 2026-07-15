from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Time, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class Sede(Base):
    __tablename__ = "sedes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)       # "Lima", "Tarapoto"
    code = Column(String(20), unique=True, nullable=False)  # "BUL", "BUT", "BUJ", "CIA"
    city = Column(String(100))
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Space(Base):
    __tablename__ = "spaces"

    id = Column(Integer, primary_key=True, index=True)
    sede_id = Column(Integer, ForeignKey("sedes.id"), nullable=True)
    sede = relationship("Sede", lazy="select")
    name = Column(String(100), nullable=False)
    capacity = Column(Integer, nullable=False)
    location = Column(String(100))
    active = Column(Boolean, default=True)
    open_time = Column(Time, nullable=True)
    close_time = Column(Time, nullable=True)
    description = Column(Text, nullable=True)
    address = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PresenceLog(Base):
    __tablename__ = "presence_log"

    id = Column(Integer, primary_key=True, index=True)
    cardnumber = Column(String(50), nullable=False, index=True)
    patron_name = Column(String(200))
    patron_category = Column(String(50))
    patron_gender = Column(String(1))   # 'M' | 'F' | None
    patron_faculty = Column(String(20)) # sort1 de Koha (facultad)
    patron_program = Column(String(20)) # sort2 de Koha (código escuela/programa)
    person_key = Column(String(100), nullable=True, index=True)  # FK lógica al padrón local (persons)
    event_type = Column(String(10), nullable=False)  # 'entry' | 'exit'
    space_id = Column(Integer, ForeignKey("spaces.id"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="admin")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Person(Base):
    """Padrón local de identidades sincronizado desde los proveedores.
    Capa de resolución rápida del escaneo (sin red en el hot path)."""
    __tablename__ = "persons"

    id = Column(Integer, primary_key=True, index=True)
    person_key = Column(String(100), unique=True, nullable=False, index=True)  # clave estable del padrón
    full_name = Column(String(200))
    first_name = Column(String(100))
    gender = Column(String(1))          # 'M' | 'F' | None
    category = Column(String(50))
    faculty = Column(String(20))        # facultad de pertenencia
    program = Column(String(20))        # código escuela/programa
    escuela = Column(String(100))       # nombre de la escuela/programa
    role = Column(String(50))           # rol/estamento (docente, alumno, etc.)
    dni = Column(String(20))
    email = Column(String(200))
    home_sede_code = Column(String(20))  # campus de pertenencia
    home_building = Column(String(100))  # edificio de pertenencia
    source = Column(String(50))          # proveedor de origen
    raw = Column(JSON)                   # payload original del proveedor
    synced_at = Column(DateTime(timezone=True))
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PersonIdentifier(Base):
    """Índice de credenciales → person_key. Resuelve el escaneo sea cual sea
    la credencial leída (cardnumber, uid, samaccountname, dni, email)."""
    __tablename__ = "person_identifiers"

    id = Column(Integer, primary_key=True, index=True)
    id_type = Column(String(50), nullable=False)   # 'cardnumber' | 'uid' | 'samaccountname' | 'dni' | 'email'
    id_value = Column(String(200), nullable=False, index=True)
    person_key = Column(String(100), nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint("id_type", "id_value", name="uq_person_identifier"),
    )


class ProviderSyncRun(Base):
    """Auditoría de cada corrida de sincronización por proveedor."""
    __tablename__ = "provider_sync_runs"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True))
    created = Column(Integer, default=0)   # altas
    updated = Column(Integer, default=0)   # cambios
    errors = Column(Integer, default=0)
    status = Column(String(20))            # 'running' | 'ok' | 'error'
