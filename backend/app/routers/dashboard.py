from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, date, timezone

from ..database import get_db
from ..models import PresenceLog, Space
from ..schemas import DashboardStats, PresenceEntry
from ..config import settings

router = APIRouter()


@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard(space_id: int = None, db: Session = Depends(get_db)):
    sid = space_id or settings.default_space_id
    space = db.query(Space).filter(Space.id == sid).first()

    space_name = space.name if space else settings.default_space_name
    capacity = space.capacity if space else settings.default_space_capacity

    today = date.today()

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

    # Últimos 10 eventos
    recent = (
        db.query(PresenceLog)
        .filter(PresenceLog.space_id == sid)
        .order_by(PresenceLog.timestamp.desc())
        .limit(10)
        .all()
    )

    return DashboardStats(
        space_name=space_name,
        capacity=capacity,
        current_occupancy=current_occupancy,
        occupancy_percent=min(100.0, occupancy_percent),
        entries_today=entries_today,
        exits_today=exits_today,
        recent_events=[PresenceEntry.model_validate(r) for r in recent],
    )
