"""
Motor de sincronización del padrón local.

Recorre los proveedores de identidad habilitados, vuelca sus registros
(`fetch_all`) y los persiste (upsert idempotente) en `persons` /
`person_identifiers`. Cada corrida por proveedor queda auditada en
`provider_sync_runs` (altas, cambios, errores, estado).

Diseño:
- Idempotente: correr `sync_all()` dos veces no crea duplicados (el upsert
  resuelve por `person_key` y las credenciales por `(id_type, id_value)`).
- Tolerante a fallos por proveedor: si un proveedor falla, se registra su
  error en `provider_sync_runs` y el resto de proveedores igual corre.
- Agnóstico: sin proveedores habilitados, `sync_all()` no hace nada y no rompe.

Los métodos del proveedor son async (el hot path del escaneo lo es); por eso
`sync_provider`/`sync_all` son coroutines. El scheduler y el endpoint admin
las corren con `asyncio.run(...)` desde su propio contexto.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import Person, ProviderSyncRun
from .identity import build_enabled_providers, upsert_person
from .identity.base import IdentityProvider

logger = logging.getLogger(__name__)


async def sync_provider(db: Session, provider: IdentityProvider) -> ProviderSyncRun:
    """Sincroniza el padrón desde un proveedor y registra la corrida.

    Recorre `provider.fetch_all()`, hace upsert de cada registro y cuenta
    altas/cambios. Nunca lanza: cualquier excepción se captura, se cuenta
    como error y la corrida queda marcada 'error'. Devuelve la fila
    `ProviderSyncRun` persistida.
    """
    run = ProviderSyncRun(
        provider=provider.name,
        started_at=datetime.now(timezone.utc),
        created=0,
        updated=0,
        errors=0,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    created = 0
    updated = 0
    errors = 0
    status = "ok"

    try:
        records = await provider.fetch_all()
        for rec in records:
            try:
                # ¿Ya existía en el padrón? Determina si es alta o cambio.
                exists = (
                    db.query(Person.id)
                    .filter(Person.person_key == rec.person_key)
                    .first()
                    is not None
                )
                upsert_person(db, rec, source=provider.name)
                if exists:
                    updated += 1
                else:
                    created += 1
            except Exception:
                errors += 1
                # Rollback obligatorio: en PostgreSQL un error de SQL aborta la
                # transacción entera, y sin esto TODO lo que sigue falla —
                # incluido el commit final que guarda el estado de la corrida,
                # que quedaría congelada en 'running' y el padrón sin replicar.
                # Un registro malo debe costar ese registro, no la corrida.
                try:
                    db.rollback()
                except Exception:
                    logger.exception("[sync] proveedor=%s: rollback falló", provider.name)
                logger.exception(
                    "[sync] proveedor=%s: error al upsertar record person_key=%s",
                    provider.name, getattr(rec, "person_key", "?"),
                )
    except Exception:
        # Fallo global del proveedor (fetch_all no debería lanzar, pero por si acaso).
        errors += 1
        status = "error"
        logger.exception("[sync] proveedor=%s: fallo en fetch_all", provider.name)

    if errors > 0 and status != "error":
        # Hubo altas/cambios pero también errores parciales.
        status = "error"

    run.finished_at = datetime.now(timezone.utc)
    run.created = created
    run.updated = updated
    run.errors = errors
    run.status = status
    db.commit()
    db.refresh(run)

    logger.info(
        "[sync] proveedor=%s: %d altas, %d cambios, %d errores (%s)",
        provider.name, created, updated, errors, status,
    )
    return run


async def sync_all(db: Session | None = None) -> list[ProviderSyncRun]:
    """Sincroniza todos los proveedores habilitados, en orden de prioridad.

    Un proveedor que falla no aborta el resto. Devuelve la lista de corridas.
    Si no se pasa sesión, abre y cierra una propia (uso desde scheduler).
    """
    own_session = db is None
    if own_session:
        db = SessionLocal()

    runs: list[ProviderSyncRun] = []
    try:
        providers = build_enabled_providers()
        if not providers:
            logger.info("[sync] no hay proveedores habilitados, nada que sincronizar.")
            return runs

        for provider in providers:
            try:
                run = await sync_provider(db, provider)
                runs.append(run)
            except Exception:
                # Blindaje extra: sync_provider ya captura, pero por si acaso.
                logger.exception("[sync] proveedor=%s: fallo no capturado", provider.name)
                db.rollback()
    finally:
        if own_session:
            db.close()

    return runs
