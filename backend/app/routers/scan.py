from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime, timezone, timedelta

from ..database import get_db
from ..models import PresenceLog, Space
from ..schemas import ScanRequest, ScanResponse, PatronInfo
from ..services import koha
from ..config import settings

router = APIRouter()

DEBOUNCE_SECONDS = 8  # ignorar re-escaneo del mismo carnet en este intervalo


@router.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest, db: Session = Depends(get_db)):
    cardnumber = req.cardnumber.strip()
    if not cardnumber:
        raise HTTPException(status_code=400, detail="cardnumber requerido")

    # Buscar patron en Koha
    patron_data = await koha.get_patron(cardnumber)
    if not patron_data:
        raise HTTPException(status_code=404, detail="Carnet no encontrado en Koha")

    # Determinar si es entrada o salida
    last = (
        db.query(PresenceLog)
        .filter(PresenceLog.cardnumber == cardnumber)
        .order_by(desc(PresenceLog.timestamp))
        .first()
    )

    # Debounce: ignorar si el último evento fue hace menos de DEBOUNCE_SECONDS
    if last:
        last_ts = last.timestamp
        if last_ts.tzinfo is None:
            last_ts = last_ts.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - last_ts).total_seconds()
        if elapsed < DEBOUNCE_SECONDS:
            raise HTTPException(status_code=429, detail="duplicate_scan")

    event_type = "exit" if (last and last.event_type == "entry") else "entry"

    # Verificar espacio
    space_id = req.space_id or settings.default_space_id
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        space_id = None

    # Registrar evento
    log = PresenceLog(
        cardnumber=cardnumber,
        patron_name=patron_data["name"],
        patron_category=patron_data["category"],
        patron_gender=patron_data.get("gender") or None,
        patron_faculty=patron_data.get("faculty") or None,
        patron_program=patron_data.get("program") or None,
        event_type=event_type,
        space_id=space_id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    gender = patron_data.get("gender", "")
    first_name = patron_data.get("first_name") or patron_data["firstname"].split()[0].capitalize()
    duration = None
    if event_type == "entry":
        greeting = "Bienvenida" if gender == "F" else "Bienvenido"
        message = f"{greeting}, {first_name}"
    else:
        message = f"Hasta luego, {first_name}"
        duration = _format_duration(last.timestamp) if last else None

    return ScanResponse(
        event_type=event_type,
        patron=PatronInfo(**patron_data),
        timestamp=log.timestamp or datetime.now(timezone.utc),
        message=message,
        duration=duration,
        from_cache=False,
    )


def _format_duration(entry_ts: datetime) -> str | None:
    """Devuelve duración exacta en formato H:MM:SS o MM:SS."""
    try:
        now = datetime.now(timezone.utc)
        if entry_ts.tzinfo is None:
            entry_ts = entry_ts.replace(tzinfo=timezone.utc)
        total = int((now - entry_ts).total_seconds())
        if total < 0:
            return None
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        else:
            return f"{minutes}:{seconds:02d}"
    except Exception:
        return None
