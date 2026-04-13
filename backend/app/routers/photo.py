import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..config import settings

router = APIRouter()


@router.get("/patron-photo/{patron_id}")
async def patron_photo(patron_id: int):
    """Proxy de la foto del patron desde Koha."""
    if not settings.koha_api_url:
        raise HTTPException(status_code=404, detail="Koha no configurado")

    url = f"{settings.koha_api_url}/patrons/{patron_id}/image"
    try:
        async with httpx.AsyncClient(
            verify=settings.koha_verify_ssl,
            timeout=3.0
        ) as client:
            resp = await client.get(
                url,
                auth=(settings.koha_api_user, settings.koha_api_pass)
            )

        if resp.status_code == 200:
            content_type = resp.headers.get("content-type", "image/jpeg")
            return Response(content=resp.content, media_type=content_type)

        raise HTTPException(status_code=404, detail="Foto no disponible")

    except (httpx.TimeoutException, httpx.ConnectError):
        raise HTTPException(status_code=404, detail="Koha no disponible")
