"""Fixtures de test. BD SQLite en memoria: los tests del padrón son de lógica
(reconciliación, precedencia, resolución), no de dialecto SQL."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app import models  # noqa: F401  — registra las tablas en Base.metadata


@pytest.fixture
def db():
    # StaticPool + un solo connection string en memoria: todas las sesiones ven
    # la misma BD (sin esto cada conexión abriría una BD vacía distinta).
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def identity_map(monkeypatch):
    """Instala un identity_map de prueba. El mapa real es data del overlay del
    cliente; el canónico no debe depender de su contenido."""

    def _install(mapping: dict):
        from app.services.identity import mapping as mapping_mod

        monkeypatch.setattr(mapping_mod, "IDENTITY_MAP", mapping)
        return mapping

    return _install
