# Adaptador Koha: envuelve la lógica REST existente de services/koha.py.
# NO duplica normalización ni resolución de facultad — reutiliza get_patron().

import json
import logging

import httpx

from ...config import settings
from .. import koha
from .base import PersonRecord

logger = logging.getLogger(__name__)


class KohaProvider:
    """Proveedor de identidad respaldado por el Koha REST del cliente.

    - lookup: por `cardnumber` (única credencial que Koha resuelve nativamente
      con /patrons?q). Reutiliza koha.get_patron (caché + fallback incluidos).
    - fetch_all: devuelve [] — Koha no expone un listado masivo canónico; el
      padrón se puebla vía LDAP/CSV o por relleno perezoso desde este lookup.
    """

    def __init__(self, cfg=settings):
        self.name = "koha"
        self.priority = cfg.koha_priority
        self.enabled = cfg.koha_enabled

    def _to_record(self, data: dict) -> PersonRecord:
        cardnumber = data.get("cardnumber", "")
        identifiers = {}
        if cardnumber:
            identifiers["cardnumber"] = str(cardnumber)
        return PersonRecord(
            person_key=f"koha:{cardnumber}",
            full_name=data.get("name") or None,
            first_name=data.get("first_name") or None,
            gender=data.get("gender") or None,
            category=data.get("category") or None,
            faculty=data.get("faculty") or None,
            program=data.get("program") or None,
            source=self.name,
            raw=data,
            identifiers=identifiers,
        )

    async def fetch_all(self):
        # Koha REST no ofrece volcado masivo estándar en este producto.
        return []

    async def lookup(
        self, id_type: str, id_value: str, sede_code: str = ""
    ) -> PersonRecord | None:
        if id_type != "cardnumber":
            return None
        try:
            # sede_code dirige la consulta al Koha del campus correcto
            # (biblioteca-staff/tarapoto/juliaca/cia); "" cae al Koha global.
            data = await koha.get_patron(id_value, sede_code)
        except Exception as e:  # nunca propagar: el aforo no se detiene
            logger.warning(f"KohaProvider.lookup falló para {id_value}: {e}")
            return None
        if not data:
            return None
        return self._to_record(data)

    async def health(self) -> bool:
        url, user, pw = settings.koha_for_sede("")
        if not url:
            return False
        try:
            query = json.dumps({"cardnumber": "__health__"})
            async with httpx.AsyncClient(verify=settings.koha_verify_ssl, timeout=2.0) as client:
                resp = await client.get(f"{url}/patrons", params={"q": query}, auth=(user, pw))
            return resp.status_code < 500
        except Exception:
            return False
