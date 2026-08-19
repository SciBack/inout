"""
Scheduler de cierre diario.

Por cada space activo con close_time definido, programa un job que al llegar
esa hora inserta un registro 'exit' forzado para cada persona que sigue con
'entry' activo (es decir, entró pero no registró salida).

Esto garantiza que al día siguiente el aforo empiece en 0 y ningún registro
quede como "dentro del edificio" de forma indefinida.
"""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import func, select

from ..config import settings
from ..database import SessionLocal
from ..models import PresenceLog, Space
from .sync import sync_all
from .visitantes import visitante_unico

LIMA = ZoneInfo("America/Lima")
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone=LIMA)


def _auto_exit_space(space_id: int, close_hour: int, close_minute: int):
    """
    Inserta exit forzado para todos los que quedaron con entry activo
    al momento del cierre del space indicado.

    El timestamp del exit se fija a la hora exacta de cierre (no a la hora
    en que corre el job, que puede tener algún desfase de segundos).
    """
    db = SessionLocal()
    try:
        now_lima = datetime.now(LIMA)
        close_dt = now_lima.replace(
            hour=close_hour,
            minute=close_minute,
            second=0,
            microsecond=0,
        )

        # Subquery: último evento por PERSONA en este space. `person_key` une
        # DNI, carné laboral y código académico; el cardnumber queda como
        # respaldo únicamente para visitas no identificadas.
        visitor = visitante_unico()
        subq = (
            select(
                visitor,
                func.max(PresenceLog.id).label("last_id"),
            )
            .where(PresenceLog.space_id == space_id)
            .group_by(visitor)
            .subquery()
        )

        # Personas cuyo último evento fue 'entry' → siguen "dentro"
        still_inside = (
            db.query(PresenceLog)
            .join(
                subq,
                PresenceLog.id == subq.c.last_id,
            )
            .filter(PresenceLog.event_type == "entry")
            .all()
        )

        if not still_inside:
            logger.info("[auto-exit] space=%d: nadie dentro al cierre, nada que hacer.", space_id)
            return

        for entry_ev in still_inside:
            db.add(PresenceLog(
                cardnumber=entry_ev.cardnumber,
                patron_name=entry_ev.patron_name,
                patron_category=entry_ev.patron_category,
                patron_gender=entry_ev.patron_gender,
                patron_faculty=entry_ev.patron_faculty,
                patron_program=entry_ev.patron_program,
                patron_home_sede=entry_ev.patron_home_sede,
                person_key=entry_ev.person_key,
                event_type="exit",
                space_id=space_id,
                timestamp=close_dt,
            ))

        db.commit()
        logger.info(
            "[auto-exit] space=%d: %d salidas forzadas a las %02d:%02d Lima.",
            space_id, len(still_inside), close_hour, close_minute,
        )

    except Exception:
        logger.exception("[auto-exit] error en space=%d", space_id)
        db.rollback()
    finally:
        db.close()


async def _daily_sync():
    """
    Job programado: sincroniza el padrón local desde los proveedores
    habilitados. Agnóstico y tolerante a fallos (sync_all no lanza; si no hay
    proveedores habilitados, no hace nada).
    """
    try:
        runs = await sync_all()
        logger.info("[sync-job] sincronización diaria completada: %d proveedores.", len(runs))
    except Exception:
        logger.exception("[sync-job] error en la sincronización diaria del padrón")


def setup_scheduler():
    """
    Lee close_time de cada space activo y registra un CronTrigger diario.
    Llamar desde el lifespan de FastAPI antes del yield.
    """
    db = SessionLocal()
    try:
        spaces = (
            db.query(Space)
            .filter(Space.active.is_(True), Space.close_time.isnot(None))
            .all()
        )
        for space in spaces:
            ct = space.close_time  # datetime.time sin tzinfo, hora Lima
            scheduler.add_job(
                _auto_exit_space,
                trigger=CronTrigger(
                    hour=ct.hour,
                    minute=ct.minute,
                    timezone=LIMA,
                ),
                args=[space.id, ct.hour, ct.minute],
                id=f"auto_exit_space_{space.id}",
                replace_existing=True,
                name=f"Auto-exit {space.name} {ct.strftime('%H:%M')} Lima",
            )
            logger.info(
                "[scheduler] auto-exit programado: '%s' a las %s Lima",
                space.name, ct.strftime("%H:%M"),
            )
    finally:
        db.close()

    # Job diario de sincronización del padrón de identidad (hora configurable,
    # default 03:00 America/Lima). Agnóstico: si no hay proveedores habilitados
    # el job corre pero no hace nada.
    sync_hour = getattr(settings, "sync_hour", 3)
    sync_minute = getattr(settings, "sync_minute", 0)
    scheduler.add_job(
        _daily_sync,
        trigger=CronTrigger(hour=sync_hour, minute=sync_minute, timezone=LIMA),
        id="daily_identity_sync",
        replace_existing=True,
        name=f"Sync padrón identidad {sync_hour:02d}:{sync_minute:02d} Lima",
    )
    logger.info(
        "[scheduler] sync de padrón programado diario a las %02d:%02d Lima",
        sync_hour, sync_minute,
    )

    scheduler.start()
    logger.info("[scheduler] iniciado.")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[scheduler] detenido.")
