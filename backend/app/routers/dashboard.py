from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, text, literal_column
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

LIMA = ZoneInfo("America/Lima")

from ..database import get_db
from ..models import PresenceLog, Space
from collections import defaultdict
from ..schemas import DashboardStats, PresenceEntry, CategoryCount, FacultyCount, HourlyCount, FacultyTimeline, FacultyEvent
from ..config import settings

router = APIRouter()

CATEGORY_LABELS = {
    "ESTUDI": "Estudiantes",
    "DOCEN": "Docentes",
    "ADMIN": "Administrativos",
}

FACULTY_LABELS = {
    "FCS": "Salud",
    "FCE": "Cs. Empresariales",
    "FIA": "Ingeniería",
    "FACTEO": "Teología",
    "FACIHED": "Humanidades",
    "EPG": "Posgrado",
    "COLEGIO": "Colegio Unión",
}


@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard(space_id: int = None, db: Session = Depends(get_db)):
    sid = space_id or settings.default_space_id
    space = db.query(Space).filter(Space.id == sid).first()

    space_name = space.name if space else settings.default_space_name
    capacity = space.capacity if space else settings.default_space_capacity

    # Fecha en hora Lima (UTC-5) — el contenedor Docker corre en UTC
    today = datetime.now(LIMA).date()
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

    # Ocupación actual por género (entries hoy - exits hoy, mínimo 0)
    male_entries = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_gender == "M",
            )
        )
        .scalar() or 0
    )
    male_exits = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "exit",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_gender == "M",
            )
        )
        .scalar() or 0
    )
    current_male = max(0, male_entries - male_exits)

    female_entries = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_gender == "F",
            )
        )
        .scalar() or 0
    )
    female_exits = (
        db.query(func.count(PresenceLog.id))
        .filter(
            and_(
                PresenceLog.event_type == "exit",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_gender == "F",
            )
        )
        .scalar() or 0
    )
    current_female = max(0, female_entries - female_exits)

    # Top 5 facultades por visitantes únicos hoy (solo entries)
    faculty_rows = (
        db.query(
            PresenceLog.patron_faculty,
            func.count(func.distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_faculty.isnot(None),
                PresenceLog.patron_faculty != "",
            )
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

    # Entradas por hora hoy (para histograma)
    hourly_rows = (
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
        .order_by(func.extract("hour", PresenceLog.timestamp))
        .all()
    )
    hourly_entries = [HourlyCount(hour=int(r.hour), count=r.cnt) for r in hourly_rows]

    # Entradas por facultad × hora (para gráfico de líneas)
    faculty_hourly_rows = (
        db.query(
            PresenceLog.patron_faculty,
            func.extract("hour", PresenceLog.timestamp).label("hour"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(
            and_(
                PresenceLog.event_type == "entry",
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_faculty.isnot(None),
                PresenceLog.patron_faculty != "",
            )
        )
        .group_by(PresenceLog.patron_faculty, func.extract("hour", PresenceLog.timestamp))
        .order_by(PresenceLog.patron_faculty, func.extract("hour", PresenceLog.timestamp))
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

    # Eventos individuales de hoy con facultad (para curva de ocupación acumulada)
    raw_faculty_events = (
        db.query(
            PresenceLog.patron_faculty,
            PresenceLog.event_type,
            PresenceLog.timestamp,
        )
        .filter(
            and_(
                func.date(PresenceLog.timestamp) == today,
                PresenceLog.space_id == sid,
                PresenceLog.patron_faculty.isnot(None),
                PresenceLog.patron_faculty != "",
            )
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
        category_breakdown=category_breakdown,
        entries_yesterday=entries_yesterday,
        current_male=current_male,
        current_female=current_female,
        faculty_breakdown=faculty_breakdown,
        hourly_entries=hourly_entries,
        faculty_timelines=faculty_timelines,
        faculty_events=faculty_events,
    )
