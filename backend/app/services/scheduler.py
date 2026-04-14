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
from sqlalchemy import and_, func, select

from ..database import SessionLocal
from ..models import PresenceLog, Space

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

        # Subquery: id del último evento registrado por cardnumber en este space
        subq = (
            select(
                PresenceLog.cardnumber,
                func.max(PresenceLog.id).label("last_id"),
            )
            .where(PresenceLog.space_id == space_id)
            .group_by(PresenceLog.cardnumber)
            .subquery()
        )

        # Personas cuyo último evento fue 'entry' → siguen "dentro"
        still_inside = (
            db.query(PresenceLog)
            .join(
                subq,
                and_(
                    PresenceLog.cardnumber == subq.c.cardnumber,
                    PresenceLog.id == subq.c.last_id,
                ),
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

    scheduler.start()
    logger.info("[scheduler] iniciado.")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[scheduler] detenido.")
