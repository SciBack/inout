# Adaptador Koha por BD directa: lee patrons desde la base MariaDB de Koha
# (tabla borrowers), sin pasar por el REST. Útil cuando el REST no está
# disponible/poblado o su puerto está bloqueado por firewall, pero la BD sí es
# alcanzable (mismo canal que ya se usa para las fotos de patrons).
#
# Reutiliza settings.koha_db_for_sede() (config por sede) y resolve_faculty().

import asyncio
import logging

import pymysql
from pymysql.cursors import DictCursor

from ...config import settings
from ..faculty_map import resolve_faculty
from .base import PersonRecord

logger = logging.getLogger(__name__)

# Columnas mínimas necesarias del borrower.
_COLS = "cardnumber, firstname, surname, sex, categorycode, sort1, sort2"


class KohaDbProvider:
    """Proveedor de identidad respaldado por la BD Koha (tabla borrowers).

    - lookup: por `cardnumber` (WHERE cardnumber = ...).
    - fetch_all: volcado completo del padrón (paginado) para el sync.
    - Todo el I/O bloqueante corre en asyncio.to_thread (hot path async).
    """

    def __init__(self, cfg=settings):
        self.name = "koha_db"
        self.priority = cfg.koha_db_priority
        self.enabled = cfg.koha_db_enabled

    def _connect(self, sede_code: str):
        host, user, pw, name = settings.koha_db_for_sede(sede_code)
        if not host or not name:
            return None
        return pymysql.connect(
            host=host, user=user, password=pw, database=name,
            connect_timeout=3, read_timeout=4, cursorclass=DictCursor,
        )

    def _row_to_record(self, r: dict) -> PersonRecord:
        firstname = (r.get("firstname") or "").strip()
        surname = (r.get("surname") or "").strip()
        card = str(r.get("cardnumber") or "")
        first = firstname.split()[0].capitalize() if firstname else ""
        return PersonRecord(
            person_key=f"koha:{card}",
            full_name=f"{firstname} {surname}".strip() or None,
            first_name=first or None,
            gender=(r.get("sex") or None),
            category=(r.get("categorycode") or None),
            faculty=resolve_faculty(r.get("sort1"), r.get("sort2")) or None,
            program=(r.get("sort2") or None),
            source=self.name,
            raw={k: (str(v) if v is not None else None) for k, v in r.items()},
            identifiers={"cardnumber": card} if card else {},
        )

    async def lookup(
        self, id_type: str, id_value: str, sede_code: str = ""
    ) -> PersonRecord | None:
        if id_type != "cardnumber":
            return None

        def run():
            conn = self._connect(sede_code)
            if conn is None:
                return None
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT {_COLS} FROM borrowers WHERE cardnumber=%s LIMIT 1",
                        (id_value,),
                    )
                    return cur.fetchone()
            finally:
                conn.close()

        try:
            row = await asyncio.to_thread(run)
        except Exception as e:  # nunca propagar: el aforo no se detiene
            logger.warning(f"KohaDbProvider.lookup falló para {id_value}: {e}")
            return None
        return self._row_to_record(row) if row else None

    async def fetch_all(self):
        """Volcado completo del padrón, paginado (para el sync programado)."""
        def run():
            conn = self._connect("")
            if conn is None:
                return []
            out = []
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT {_COLS} FROM borrowers "
                        "WHERE cardnumber IS NOT NULL AND cardnumber <> ''"
                    )
                    out = cur.fetchall()
            finally:
                conn.close()
            return out

        try:
            rows = await asyncio.to_thread(run)
        except Exception as e:
            logger.warning(f"KohaDbProvider.fetch_all falló: {e}")
            return []
        return [self._row_to_record(r) for r in rows]

    async def health(self) -> bool:
        def run():
            conn = self._connect("")
            if conn is None:
                return False
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
                return True
            finally:
                conn.close()

        try:
            return await asyncio.to_thread(run)
        except Exception:
            return False
