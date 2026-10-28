"""Libros más prestados — datos del dashboard público. Sin autenticación (misma
superficie que /dashboard): solo expone títulos y conteos, nunca personas."""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import MaterialCover, Space
from ..schemas import MaterialItem, MaterialPeriod, MaterialsTopResponse
from ..services import materials as svc

LIMA = ZoneInfo("America/Lima")
router = APIRouter()

TOP_LIMIT = 8


@router.get("/materials/top", response_model=MaterialsTopResponse)
def get_materials_top(space_id: int | None = None, limit: int = TOP_LIMIT, db: Session = Depends(get_db)):
    """Ranking de títulos más prestados por periodo. Si el espacio declara una
    `library_code` solo cuentan los préstamos de esa biblioteca; sin ella, todos.
    Con la función apagada responde `enabled: false` y el cliente oculta la sección."""
    now = datetime.now(LIMA)
    if not settings.materials_enabled:
        return MaterialsTopResponse(enabled=False, as_of=now, periods=[])

    library_code = None
    if space_id is not None:
        space = db.query(Space).filter(Space.id == space_id).first()
        library_code = space.library_code if space else None

    limit = max(1, min(limit, 20))
    starts = svc.period_starts(now)
    periods = []
    for key, label in svc.PERIODS:
        since = starts[key]
        items = [
            MaterialItem(
                rank=t["rank"], biblio_id=t["biblio_id"], title=t["title"], author=t["author"],
                loans=t["loans"], last_loan_at=t["last_loan_at"],
                cover_url=f"/api/materials/cover/{t['biblio_id']}" if t["has_cover"] else None,
            )
            for t in svc.top_titles(db, since, library_code, limit)
        ]
        periods.append(MaterialPeriod(
            key=key, label=label, since=since,
            total_loans=svc.total_loans(db, since, library_code), items=items,
        ))
    return MaterialsTopResponse(
        enabled=True, as_of=now, library_code=library_code, periods=periods,
        synced_at=svc.sync_state["ok_at"], sync_error=svc.sync_state["error"],
    )


@router.get("/materials/cover/{biblio_id}")
def get_material_cover(biblio_id: int, db: Session = Depends(get_db)):
    cover = db.query(MaterialCover).filter(MaterialCover.biblio_id == biblio_id).first()
    if not cover:
        raise HTTPException(status_code=404, detail="Sin portada")
    # Las portadas casi no cambian: el navegador del kiosko las guarda un día.
    return Response(
        content=cover.data, media_type=cover.content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
