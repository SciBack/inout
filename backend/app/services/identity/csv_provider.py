# Adaptador CSV: lee un CSV con cabeceras desde settings.csv_path (volumen
# /config). Incluido en Fase 1 para testing sin LDAP real y para clientes sin
# directorio. Mapea columnas vía mapping.py (o passthrough por nombre estándar).

import asyncio
import csv
import logging
import os

from ...config import settings
from .base import PersonRecord
from .mapping import record_from_raw

logger = logging.getLogger(__name__)


class CsvProvider:
    def __init__(self, cfg=settings):
        self.name = "csv"
        self.priority = cfg.csv_priority
        self.enabled = cfg.csv_enabled
        self.path = cfg.csv_path

    def _read_rows(self) -> list[dict]:
        if not self.path or not os.path.exists(self.path):
            logger.warning(f"CsvProvider: archivo no encontrado ({self.path})")
            return []
        with open(self.path, encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))

    def _records(self) -> list[PersonRecord]:
        records = []
        for row in self._read_rows():
            rec = record_from_raw(self.name, row, self.name)
            if rec is not None:
                records.append(rec)
        return records

    async def fetch_all(self):
        # No se captura: un CSV ilegible o corrupto debe marcar la corrida en
        # 'error', no reportar 'ok' con 0 registros. Ver nota en base.py.
        return await asyncio.to_thread(self._records)

    async def lookup(
        self, id_type: str, id_value: str, sede_code: str = ""
    ) -> PersonRecord | None:
        try:
            records = await asyncio.to_thread(self._records)
        except Exception as e:
            logger.warning(f"CsvProvider.lookup falló: {e}")
            return None
        for rec in records:
            if rec.identifiers.get(id_type) == id_value:
                return rec
        return None

    async def health(self) -> bool:
        return bool(self.path and os.path.exists(self.path))
