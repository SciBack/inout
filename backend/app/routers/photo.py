import httpx
import pymysql
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..config import settings

router = APIRouter()

# Caché en memoria: cardnumber → (bytes, mimetype) para no golpear la DB en cada poll
_photo_cache: dict[str, tuple[bytes, str] | None] = {}


@router.get("/patron-photo/card/{cardnumber}")
async def patron_photo_by_card(cardnumber: str):
    """Foto del patron por cardnumber. Fallback a Koha DB."""
    if cardnumber in _photo_cache:
        result = _photo_cache[cardnumber]
        if result is None:
            raise HTTPException(status_code=404, detail="Foto no disponible")
        return Response(content=result[0], media_type=result[1])

    data = await asyncio.get_event_loop().run_in_executor(
        None, _fetch_photo_by_cardnumber, cardnumber
    )
    _photo_cache[cardnumber] = data  # None = sin foto (también se cachea)
    if data:
        return Response(content=data[0], media_type=data[1])
    raise HTTPException(status_code=404, detail="Foto no disponible")


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
