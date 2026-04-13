import httpx
import time
import logging
from ..config import settings

logger = logging.getLogger(__name__)

# Caché en memoria: {cardnumber: (patron_data, timestamp)}
_cache: dict[str, tuple[dict, float]] = {}
CACHE_TTL = 1800  # 30 minutos


async def get_patron(cardnumber: str) -> dict | None:
    """
    Busca un patron en Koha por cardnumber.
    Usa caché de 30 minutos. Si Koha no responde en 2s, usa caché aunque haya expirado.
    Devuelve None si no existe.
    """
    cached = _cache.get(cardnumber)
    cache_fresh = cached and (time.time() - cached[1]) < CACHE_TTL

    if cache_fresh:
        return cached[0]

    if not settings.koha_api_url:
        logger.warning("KOHA_API_URL no configurado — modo demo")
        return _demo_patron(cardnumber)

    try:
        import json
        query = json.dumps({"cardnumber": cardnumber})
        url = f"{settings.koha_api_url}/patrons"

        async with httpx.AsyncClient(
            verify=settings.koha_verify_ssl,
            timeout=2.0
        ) as client:
            resp = await client.get(
                url,
                params={"q": query},
                auth=(settings.koha_api_user, settings.koha_api_pass)
            )

        if resp.status_code == 200:
            data = resp.json()
            if data:
                patron = _normalize(data[0])
                _cache[cardnumber] = (patron, time.time())
                return patron
            return None

        logger.error(f"Koha API error {resp.status_code} para cardnumber {cardnumber}")
        return cached[0] if cached else None

    except (httpx.TimeoutException, httpx.ConnectError) as e:
        logger.warning(f"Koha no disponible ({e}) — usando caché")
        return cached[0] if cached else None


def _normalize(raw: dict) -> dict:
    firstname = raw.get("firstname") or ""
    surname = raw.get("surname") or ""
    # Primer nombre: primera palabra del firstname en title case
    first_name = firstname.split()[0].capitalize() if firstname else ""
    return {
        "cardnumber": raw.get("cardnumber", ""),
        "name": f"{firstname} {surname}".strip(),
        "firstname": firstname,
        "first_name": first_name,
        "surname": surname,
        "gender": raw.get("gender") or "",
        "category": raw.get("category_id") or raw.get("categorycode") or "",
        "expiry_date": raw.get("expiry_date") or "",
        "patron_id": raw.get("patron_id"),
        "faculty": raw.get("statistics_1") or "",
        "program": raw.get("statistics_2") or "",
    }


def _demo_patron(cardnumber: str) -> dict:
    """Patron de demo cuando Koha no está configurado."""
    return {
        "cardnumber": cardnumber,
        "name": "Usuario Demo",
        "firstname": "Usuario",
        "first_name": "Usuario",
        "surname": "Demo",
        "gender": "M",
        "category": "ESTUDI",
        "expiry_date": "2099-12-31",
        "patron_id": None,
        "faculty": "",
        "program": "",
    }
