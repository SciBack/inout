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
        event_type=event_type,
        space_id=space_id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    gender = patron_data.get("gender", "")
    first_name = patron_data.get("first_name") or patron_data["firstname"].split()[0].capitalize()
    if event_type == "entry":
        greeting = "Bienvenida" if gender == "F" else "Bienvenido"
        message = f"{greeting}, {first_name}"
    else:
        duration_str = _format_duration(last.timestamp) if last else None
        if duration_str:
            message = f"Hasta luego, {first_name}. Estuviste {duration_str}"
        else:
            message = f"Hasta luego, {first_name}"

    return ScanResponse(
        event_type=event_type,
        patron=PatronInfo(**patron_data),
        timestamp=log.timestamp or datetime.now(timezone.utc),
        message=message,
        from_cache=False,
    )


def _format_duration(entry_ts: datetime) -> str | None:
    """Devuelve texto natural con la duración desde entry_ts hasta ahora."""
    try:
        now = datetime.now(timezone.utc)
        if entry_ts.tzinfo is None:
            entry_ts = entry_ts.replace(tzinfo=timezone.utc)
        delta = now - entry_ts
        total = int(delta.total_seconds())
        if total < 60:
            return None  # menos de 1 minuto — no decir nada
        hours, remainder = divmod(total, 3600)
        minutes = remainder // 60
        if hours > 0 and minutes > 0:
            return f"{hours} hora{'s' if hours > 1 else ''} y {minutes} minuto{'s' if minutes > 1 else ''}"
        elif hours > 0:
            return f"{hours} hora{'s' if hours > 1 else ''}"
        else:
            return f"{minutes} minuto{'s' if minutes > 1 else ''}"
    except Exception:
        return None
