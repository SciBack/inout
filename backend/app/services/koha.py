import httpx
import time
import logging
from ..config import settings

logger = logging.getLogger(__name__)

# Caché en memoria: {(sede_code, cardnumber): (patron_data, timestamp)}
_cache: dict[tuple[str, str], tuple[dict, float]] = {}
CACHE_TTL = 1800  # 30 minutos


async def get_patron(cardnumber: str, sede_code: str = "BUL") -> dict | None:
    """
    Busca un patron en el Koha correspondiente a la sede.
    Usa caché de 30 minutos por (sede, cardnumber).
    Si Koha no responde en 2s usa caché aunque haya expirado.
    Devuelve None si no existe.
    """
    cache_key = (sede_code.upper(), cardnumber)
    cached = _cache.get(cache_key)
    cache_fresh = cached and (time.time() - cached[1]) < CACHE_TTL

    if cache_fresh:
        return cached[0]

    koha_url, koha_user, koha_pass = settings.koha_for_sede(sede_code)

    if not koha_url:
        logger.warning(f"Koha no configurado para sede {sede_code} — modo demo")
        return _demo_patron(cardnumber)

    try:
        import json
        query = json.dumps({"cardnumber": cardnumber})

        async with httpx.AsyncClient(
            verify=settings.koha_verify_ssl,
            timeout=2.0
        ) as client:
            resp = await client.get(
                f"{koha_url}/patrons",
                params={"q": query},
                auth=(koha_user, koha_pass)
            )

        if resp.status_code == 200:
            data = resp.json()
            if data:
                patron = _normalize(data[0])
                _cache[cache_key] = (patron, time.time())
                return patron
            return None

        logger.error(f"Koha {sede_code} API error {resp.status_code} para {cardnumber}")
        return cached[0] if cached else None

    except (httpx.TimeoutException, httpx.ConnectError) as e:
        logger.warning(f"Koha {sede_code} no disponible ({e}) — usando caché")
        return cached[0] if cached else None


def _normalize(raw: dict) -> dict:
    firstname = raw.get("firstname") or ""
    surname = raw.get("surname") or ""
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
