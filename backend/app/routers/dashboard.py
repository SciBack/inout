from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, text
from datetime import datetime, date, timedelta, timezone

from ..database import get_db
from ..models import PresenceLog, Space
from ..schemas import DashboardStats, PresenceEntry, CategoryCount
from ..config import settings

router = APIRouter()

CATEGORY_LABELS = {
    "ESTUDI": "Estudiantes",
    "DOCEN": "Docentes",
    "ADMIN": "Administrativos",
}


@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard(space_id: int = None, db: Session = Depends(get_db)):
    sid = space_id or settings.default_space_id
    space = db.query(Space).filter(Space.id == sid).first()

    space_name = space.name if space else settings.default_space_name
    capacity = space.capacity if space else settings.default_space_capacity

    today = date.today()
    yesterday = today - timedelta(days=1)

    # Entradas de hoy
    entries_today = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
            )
        )
        .scalar() or 0
    )

    # Salidas de hoy
    exits_today = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "exit",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
            )
        )
        .scalar() or 0
    )

    # Ocupación actual = entradas - salidas (solo de hoy)
    current_occupancy = max(0, entries_today - exits_today)
    occupancy_percent = round((current_occupancy / capacity) * 100, 1) if capacity > 0 else 0.0

    # Últimos 8 eventos
    recent = (
        db.query(PresenceLog)
        .filter(PresenceLog.space_id == sid)
        .order_by(PresenceLog.timestamp.desc())
        .limit(8)
        .all()
    )

    # Visitantes únicos hoy (solo entries)
    unique_visitors_today = (
        db.query(func.count(func.distinct(PresenceLog.cardnumber)))
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
            )
        )
        .scalar() or 0
    )

    # Entradas de ayer
    entries_yesterday = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == yesterday,
                PresenceLog.space_id == sid,
            )
        )
        .scalar() or 0
    )

    # Hora pico: hora con más entradas hoy
    peak_hour_row = (
        db.query(
            func.extract("hour", PresenceLog.timestamp).label("hour"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
            )
        )
        .group_by(func.extract("hour", PresenceLog.timestamp))
        .order_by(func.count(PresenceLog.id).desc())
        .first()
    )
    peak_hour = int(peak_hour_row.hour) if peak_hour_row else None

    # Permanencia promedio: para cada exit de hoy, buscar el último entry
    # del mismo cardnumber antes de ese exit, calcular diferencia en segundos
    exits_today_rows = (
        db.query(PresenceLog)
        .filter(
            and_(
                PresenceLog.event_type == "exit",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
            )
        )
        .all()
    )

    durations = []
    for exit_ev in exits_today_rows:
        last_entry = (
            db.query(PresenceLog)
            .filter(
                and_(
                    PresenceLog.event_type == "entry",
                    PresenceLog.cardnumber == exit_ev.cardnumber,
                    PresenceLog.space_id == sid,
                    PresenceLog.timestamp < exit_ev.timestamp,
                )
            )
            .order_by(PresenceLog.timestamp.desc())
            .first()
        )
        if last_entry:
            diff = (exit_ev.timestamp - last_entry.timestamp).total_seconds()
            if diff > 0:
                durations.append(diff)

    avg_stay_seconds = int(sum(durations) / len(durations)) if durations else None

    # Visitantes únicos por categoría (solo entries de hoy)
    category_rows = (
        db.query(
            PresenceLog.patron_category,
            func.count(func.distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
            )
        )
        .group_by(PresenceLog.patron_category)
        .all()
    )

    category_breakdown = [
        CategoryCount(
            category=row.patron_category or "OTROS",
            label=CATEGORY_LABELS.get(row.patron_category or "", row.patron_category or "Otros"),
            count=row.cnt,
        )
        for row in category_rows
    ]

    return DashboardStats(
        space_name=space_name,
        capacity=capacity,
        current_occupancy=current_occupancy,
        occupancy_percent=min(100.0, occupancy_percent),
        entries_today=entries_today,
        exits_today=exits_today,
        recent_events=[PresenceEntry.model_validate(r) for r in recent],
        unique_visitors_today=unique_visitors_today,
        avg_stay_seconds=avg_stay_seconds,
        peak_hour=peak_hour,
        category_breakdown=category_breakdown,
        entries_yesterday=entries_yesterday,
    )
