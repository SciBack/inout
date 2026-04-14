from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LIMA = ZoneInfo("America/Lima")

from ..database import get_db
from ..models import PresenceLog, Space
from collections import defaultdict
from ..schemas import DashboardStats, PresenceEntry, CategoryCount, FacultyCount, HourlyCount, FacultyTimeline, FacultyEvent
from ..config import settings

router = APIRouter()

CATEGORY_LABELS = {
    "ESTUDI":  "Estudiantes",
    "DOCEN":   "Docentes",
    "VISITA":  "Visitantes",
    "INVESTI": "Investigadores",
    "STAFF":   "Personal biblioteca",
    "ADMIN":   "Administrativos",
}

FACULTY_LABELS: dict[str, str] = {}


def _lima_day_bounds() -> tuple[datetime, datetime, datetime, datetime]:
    """
    Devuelve (hoy_inicio, hoy_fin, ayer_inicio, ayer_fin) como datetimes
    timezone-aware en Lima, para usarlos directamente en comparaciones con
    columnas TIMESTAMPTZ de PostgreSQL sin ambigüedad de zona horaria.

    Ejemplo a las 20:38 Lima (01:38 UTC del día siguiente):
      hoy_inicio  = 2026-04-13 00:00:00-05:00
      hoy_fin     = 2026-04-14 00:00:00-05:00
      ayer_inicio = 2026-04-12 00:00:00-05:00
      ayer_fin    = 2026-04-13 00:00:00-05:00
    """
    now_lima = datetime.now(LIMA)
    hoy_inicio  = now_lima.replace(hour=0, minute=0, second=0, microsecond=0)
    hoy_fin     = hoy_inicio + timedelta(days=1)
    ayer_inicio = hoy_inicio - timedelta(days=1)
    ayer_fin    = hoy_inicio
    return hoy_inicio, hoy_fin, ayer_inicio, ayer_fin


@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard(space_id: int = None, db: Session = Depends(get_db)):
    sid = space_id or settings.default_space_id
    space = db.query(Space).filter(Space.id == sid).first()

    space_name = space.name if space else settings.default_space_name
    capacity = space.capacity if space else settings.default_space_capacity

    # Límites del día en hora Lima — todas las queries usan este mismo rango
    hoy_ini, hoy_fin, ayer_ini, ayer_fin = _lima_day_bounds()

    # ── Entradas de hoy ──────────────────────────────────────────────────────
    entries_today = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .scalar() or 0
    )

    # ── Salidas de hoy ───────────────────────────────────────────────────────
    exits_today = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "exit",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .scalar() or 0
    )

    # ── Ocupación actual ─────────────────────────────────────────────────────
    current_occupancy = max(0, entries_today - exits_today)
    occupancy_percent = round((current_occupancy / capacity) * 100, 1) if capacity > 0 else 0.0

    # ── Últimos 20 eventos de hoy ────────────────────────────────────────────
    recent = (
        db.query(PresenceLog)
        .filter(
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .order_by(PresenceLog.id.desc())
        .limit(20)
        .all()
    )

    # ── Visitantes únicos hoy ────────────────────────────────────────────────
    unique_visitors_today = (
        db.query(func.count(func.distinct(PresenceLog.cardnumber)))
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .scalar() or 0
    )

    # ── Entradas de ayer ─────────────────────────────────────────────────────
    entries_yesterday = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= ayer_ini,
            PresenceLog.timestamp < ayer_fin,
        )
        .scalar() or 0
    )

    # ── Hora pico hoy (en hora Lima) ─────────────────────────────────────────
    peak_hour_row = (
        db.query(
            func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)).label("hour"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .group_by(func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)))
        .order_by(func.count(PresenceLog.id).desc())
        .first()
    )
    peak_hour = int(peak_hour_row.hour) if peak_hour_row else None

    # ── Hora punta típica (histórico mismo día de semana) ────────────────────
    pg_isodow = datetime.now(LIMA).isoweekday()  # 1=lun … 7=dom
    typical_peak_row = (
        db.query(
            func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)).label("hour"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp < hoy_ini,   # excluir hoy
            func.extract("isodow", func.timezone("America/Lima", PresenceLog.timestamp)) == pg_isodow,
        )
        .group_by(func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)))
        .order_by(func.count(PresenceLog.id).desc())
        .first()
    )
    typical_peak_hour = int(typical_peak_row.hour) if typical_peak_row else None

    # ── Permanencia promedio hoy ─────────────────────────────────────────────
    exits_today_rows = (
        db.query(PresenceLog)
        .filter(
            PresenceLog.event_type == "exit",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .all()
    )

    durations = []
    for exit_ev in exits_today_rows:
        last_entry = (
            db.query(PresenceLog)
            .filter(
                PresenceLog.event_type == "entry",
                PresenceLog.cardnumber == exit_ev.cardnumber,
                PresenceLog.space_id == sid,
                PresenceLog.timestamp >= hoy_ini,
                PresenceLog.timestamp < exit_ev.timestamp,
            )
            .order_by(PresenceLog.timestamp.desc())
            .first()
        )
        if last_entry:
            diff = (exit_ev.timestamp - last_entry.timestamp).total_seconds()
            if diff > 0:
                durations.append(diff)

    avg_stay_seconds = int(sum(durations) / len(durations)) if durations else None

    # ── Perfiles (categorías) hoy ────────────────────────────────────────────
    category_rows = (
        db.query(
            PresenceLog.patron_category,
            func.count(func.distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
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

    # ── Género: aforo actual y total acumulado hoy ───────────────────────────
    male_entries = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_gender == "M",
        )
        .scalar() or 0
    )
    male_exits = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "exit",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_gender == "M",
        )
        .scalar() or 0
    )
    current_male = max(0, male_entries - male_exits)

    female_entries = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_gender == "F",
        )
        .scalar() or 0
    )
    female_exits = (
        db.query(func.count(PresenceLog.id))
        .filter(
            PresenceLog.event_type == "exit",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_gender == "F",
        )
        .scalar() or 0
    )
    current_female = max(0, female_entries - female_exits)

    # ── Top facultades hoy ───────────────────────────────────────────────────
    faculty_rows = (
        db.query(
            PresenceLog.patron_faculty,
            func.count(func.distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_faculty.isnot(None),
            PresenceLog.patron_faculty != "",
        )
        .group_by(PresenceLog.patron_faculty)
        .order_by(func.count(func.distinct(PresenceLog.cardnumber)).desc())
        .limit(5)
        .all()
    )

    faculty_breakdown = [
        FacultyCount(
            faculty=row.patron_faculty,
            label=FACULTY_LABELS.get(row.patron_faculty, row.patron_faculty),
            count=row.cnt,
        )
        for row in faculty_rows
    ]

    # ── Entradas por hora hoy (Lima) ─────────────────────────────────────────
    hourly_rows = (
        db.query(
            func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)).label("hour"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
        )
        .group_by(func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)))
        .order_by(func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)))
        .all()
    )
    hourly_entries = [HourlyCount(hour=int(r.hour), count=r.cnt) for r in hourly_rows]

    # ── Entradas por facultad × hora hoy ─────────────────────────────────────
    faculty_hourly_rows = (
        db.query(
            PresenceLog.patron_faculty,
            func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)).label("hour"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(
            PresenceLog.event_type == "entry",
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_faculty.isnot(None),
            PresenceLog.patron_faculty != "",
        )
        .group_by(PresenceLog.patron_faculty, func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)))
        .order_by(PresenceLog.patron_faculty, func.extract("hour", func.timezone("America/Lima", PresenceLog.timestamp)))
        .all()
    )

    fac_hours: dict[str, list] = defaultdict(list)
    for row in faculty_hourly_rows:
        fac_hours[row.patron_faculty].append(HourlyCount(hour=int(row.hour), count=row.cnt))

    faculty_timelines = [
        FacultyTimeline(
            faculty=fac,
            label=FACULTY_LABELS.get(fac, fac),
            data=hours,
        )
        for fac, hours in fac_hours.items()
    ]

    # ── Eventos por facultad hoy (para curva acumulada) ──────────────────────
    raw_faculty_events = (
        db.query(
            PresenceLog.patron_faculty,
            PresenceLog.event_type,
            PresenceLog.timestamp,
        )
        .filter(
            PresenceLog.space_id == sid,
            PresenceLog.timestamp >= hoy_ini,
            PresenceLog.timestamp < hoy_fin,
            PresenceLog.patron_faculty.isnot(None),
            PresenceLog.patron_faculty != "",
        )
        .order_by(PresenceLog.timestamp)
        .all()
    )
    faculty_events = [
        FacultyEvent(
            faculty=row.patron_faculty,
            label=FACULTY_LABELS.get(row.patron_faculty, row.patron_faculty),
            event_type=row.event_type,
            ts=row.timestamp.isoformat(),
        )
        for row in raw_faculty_events
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
        typical_peak_hour=typical_peak_hour,
        category_breakdown=category_breakdown,
        entries_yesterday=entries_yesterday,
        current_male=current_male,
        current_female=current_female,
        total_male_today=male_entries,
        total_female_today=female_entries,
        faculty_breakdown=faculty_breakdown,
        hourly_entries=hourly_entries,
        faculty_timelines=faculty_timelines,
        faculty_events=faculty_events,
    )
