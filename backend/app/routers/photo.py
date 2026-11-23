import httpx
import pymysql
import asyncio
import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import PersonIdentifier

router = APIRouter()

# Caché en memoria: cardnumber → (momento, (bytes, mimetype) | None) para no golpear la DB en cada poll.
# Caduca (23-nov-2026): antes era para siempre, y quien subía su foto desde Mi CRAI después de haber marcado
# sin foto seguía sin foto en el kiosko hasta reiniciar el backend. «Sin foto» caduca antes que una foto.
_CACHE_CON_FOTO_S = 30 * 60
_CACHE_SIN_FOTO_S = 2 * 60
_photo_cache: dict[str, tuple[float, tuple[bytes, str] | None]] = {}


@router.get("/patron-photo/card/{cardnumber}")
async def patron_photo_by_card(cardnumber: str, db: Session = Depends(get_db)):
    """Foto del patron por cualquiera de sus carnés asociados."""
    guardado = _photo_cache.get(cardnumber)
    if guardado:
        momento, result = guardado
        if time.monotonic() - momento < (_CACHE_CON_FOTO_S if result else _CACHE_SIN_FOTO_S):
            if result is None:
                raise HTTPException(status_code=404, detail="Foto no disponible")
            return Response(content=result[0], media_type=result[1])

    data = None
    for candidate in _photo_card_candidates(db, cardnumber):
        data = await asyncio.get_event_loop().run_in_executor(
            None, _fetch_photo_by_cardnumber, candidate
        )
        if data:
            break

    _photo_cache[cardnumber] = (time.monotonic(), data)  # None = sin foto (también se guarda, menos tiempo)
    if data:
        return Response(content=data[0], media_type=data[1])
    raise HTTPException(status_code=404, detail="Foto no disponible")


def _photo_card_candidates(db: Session, cardnumber: str) -> list[str]:
    """Prioriza el código escaneado y luego los carnés de su identidad."""
    identifier = (
        db.query(PersonIdentifier)
        .filter(
            PersonIdentifier.id_type == "cardnumber",
            PersonIdentifier.id_value == cardnumber,
        )
        .first()
    )
    if identifier is None:
        return [cardnumber]

    aliases = (
        db.query(PersonIdentifier.id_value)
        .filter(
            PersonIdentifier.id_type == "cardnumber",
            PersonIdentifier.person_key == identifier.person_key,
            PersonIdentifier.id_value != cardnumber,
        )
        .order_by(PersonIdentifier.id)
        .all()
    )
    return [cardnumber, *(value for (value,) in aliases)]


def _fetch_photo_by_cardnumber(cardnumber: str) -> tuple[bytes, str] | None:
    from ..config import settings
    if not settings.koha_db_host:
        return None
    try:
        conn = pymysql.connect(
            host=settings.koha_db_host,
            user=settings.koha_db_user,
            password=settings.koha_db_pass,
            database=settings.koha_db_name,
            connect_timeout=3,
        )
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT pi.imagefile, pi.mimetype
                       FROM patronimage pi
                       JOIN borrowers b ON pi.borrowernumber = b.borrowernumber
                       WHERE b.cardnumber = %s LIMIT 1""",
                    (cardnumber,)
                )
                row = cur.fetchone()
        if row:
            return (bytes(row[0]), row[1] or "image/jpeg")
        return None
    except Exception:
        return None


@router.get("/patron-photo/{patron_id}")
async def patron_photo(patron_id: int):
    """Foto del patron: intenta REST API Koha, fallback a DB directa."""

    # Intentar REST API primero
    if settings.koha_api_url:
        try:
            url = f"{settings.koha_api_url}/patrons/{patron_id}/image"
            async with httpx.AsyncClient(verify=settings.koha_verify_ssl, timeout=3.0) as client:
                resp = await client.get(url, auth=(settings.koha_api_user, settings.koha_api_pass))
            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "image/jpeg")
                return Response(content=resp.content, media_type=content_type)
        except (httpx.TimeoutException, httpx.ConnectError):
            pass

    # Fallback: leer directo de la tabla patronimage en MariaDB de Koha
    if settings.koha_db_host:
        image_data = await asyncio.get_event_loop().run_in_executor(
            None, _fetch_photo_from_db, patron_id
        )
        if image_data:
            return Response(content=image_data["imagefile"], media_type=image_data["mimetype"])

    raise HTTPException(status_code=404, detail="Foto no disponible")


def _fetch_photo_from_db(patron_id: int) -> dict | None:
    try:
        conn = pymysql.connect(
            host=settings.koha_db_host,
            user=settings.koha_db_user,
            password=settings.koha_db_pass,
            database=settings.koha_db_name,
            connect_timeout=3,
        )
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT imagefile, mimetype FROM patronimage WHERE borrowernumber = %s",
                    (patron_id,)
                )
                row = cur.fetchone()
        if row:
            return {"imagefile": bytes(row[0]), "mimetype": row[1] or "image/jpeg"}
        return None
    except Exception:
        return None
