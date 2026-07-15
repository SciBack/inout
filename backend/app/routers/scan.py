from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime, timezone

from ..database import get_db
from ..models import PresenceLog, Space, Sede
from ..schemas import ScanRequest, ScanResponse, PatronInfo
from ..services.identity import resolve_person
from ..config import settings

router = APIRouter()

DEBOUNCE_SECONDS = 8


def _infer_id_type(value: str) -> str:
    """Tipo de credencial escaneada. El canónico asume 'cardnumber' (agnóstico).

    Heurísticas por país (p. ej. DNI peruano de 8 dígitos) son data de la capa
    país/overlay, no del canónico: aquí meterlas rompía la resolución de
    cardnumbers numéricos de 8 dígitos (quedaban 'Sin identificar').
    """
    return "cardnumber"


@router.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest, db: Session = Depends(get_db)):
    cardnumber = req.cardnumber.strip()
    if not cardnumber:
        raise HTTPException(status_code=400, detail="cardnumber requerido")

    # Resolver espacio y sede del kiosko (campus/edificio del INGRESO)
    space_id = req.space_id or settings.default_space_id
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        space_id = None

    sede_code = settings.default_sede_code  # fallback (vacío → Koha global)
    if space and space.sede_id:
        sede = db.query(Sede).filter(Sede.id == space.sede_id).first()
        if sede:
            sede_code = sede.code

    # Resolver identidad vía el padrón local + proveedores (relleno perezoso).
    # NUNCA lanza: si nada responde/encuentra devuelve (None, "unidentified")
    # y el aforo se registra igual. Ya NO se lanza 404 por carnet desconocido.
    id_type = _infer_id_type(cardnumber)
    person, origin = await resolve_person(db, id_type, cardnumber)

    # Snapshot de datos para el evento y la respuesta.
    if person is not None:
        patron_name = person.full_name or "Sin identificar"
        patron_category = person.category or ""
        gender = person.gender or ""
        faculty = person.faculty or None
        program = person.program or None
        name_parts = (person.full_name or "").split()
        first_name = person.first_name or (
            name_parts[0].capitalize() if name_parts else ""
        )
        person_key = person.person_key
    else:
        patron_name = "Sin identificar"
        patron_category = ""
        gender = ""
        faculty = None
        program = None
        first_name = ""
        person_key = None

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

    # Registrar evento (siempre, aun sin identificar — el aforo no se detiene)
    log = PresenceLog(
        cardnumber=cardnumber,
        person_key=person_key,
        patron_name=patron_name,
        patron_category=patron_category,
        patron_gender=gender or None,
        patron_faculty=faculty,
        patron_program=program,
        event_type=event_type,
        space_id=space_id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    duration = None
    if event_type == "entry":
        greeting = "Bienvenida" if gender == "F" else "Bienvenido"
        message = f"{greeting}, {first_name}" if first_name else greeting
    else:
        message = f"Hasta luego, {first_name}" if first_name else "Hasta luego"
        duration = _format_duration(last.timestamp) if last else None

    patron = PatronInfo(
        cardnumber=cardnumber,
        name=patron_name,
        firstname=first_name,
        first_name=first_name,
        surname="",
        gender=gender,
        category=patron_category,
        patron_id=None,
        faculty=faculty or "",
        program=program or "",
    )

    return ScanResponse(
        event_type=event_type,
        patron=patron,
        timestamp=log.timestamp or datetime.now(timezone.utc),
        message=message,
        duration=duration,
        from_cache=(origin == "local"),
    )


def _format_duration(entry_ts: datetime) -> str | None:
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
        return f"{minutes}:{seconds:02d}"
    except Exception:
        return None
