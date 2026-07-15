# Adaptador LDAP/AD (ldap3, pure-python). Mismo adaptador para OpenLDAP y AD.
# - fetch_all: búsqueda paginada por ldap_base_dn + ldap_user_filter.
# - lookup:    filtro por el atributo que mapea al id_type consultado.
# Mapea atributos (eduPerson/SCHAC/AD) → padrón vía mapping.py.
# Ante conexión caída devuelve [] / None y health()=False, sin lanzar.

import asyncio
import logging

from ...config import settings
from .base import PersonRecord
from .mapping import provider_map, record_from_raw

logger = logging.getLogger(__name__)

# Atributo LDAP por defecto para cada tipo de credencial, si el mapa del
# overlay no define uno explícito en identity_map.json → ldap → identifiers.
_DEFAULT_ATTR_FOR_ID_TYPE = {
    "uid": "uid",
    "samaccountname": "sAMAccountName",
    "dni": "employeeNumber",
    "cardnumber": "employeeNumber",
    "email": "mail",
}


class LdapProvider:
    def __init__(self, cfg=settings):
        self.name = "ldap"
        self.priority = cfg.ldap_priority
        self.enabled = cfg.ldap_enabled
        self.host = cfg.ldap_host
        self.bind_dn = cfg.ldap_bind_dn
        self.bind_pass = cfg.ldap_bind_pass
        self.base_dn = cfg.ldap_base_dn
        self.user_filter = cfg.ldap_user_filter or "(objectClass=person)"
        self.page_size = cfg.ldap_page_size

    # ── helpers de mapeo ────────────────────────────────────────────────
    def _attr_for_id_type(self, id_type: str) -> str | None:
        id_map = provider_map(self.name).get("identifiers", {})
        for attr, mapped_type in id_map.items():
            if mapped_type == id_type:
                return attr
        return _DEFAULT_ATTR_FOR_ID_TYPE.get(id_type)

    @staticmethod
    def _flatten(entry_attrs: dict) -> dict:
        """Aplana valores LDAP (listas) a str; coacciona no-serializables."""
        raw = {}
        for key, val in entry_attrs.items():
            if isinstance(val, list):
                val = val[0] if len(val) == 1 else [str(v) for v in val]
            if isinstance(val, (bytes, bytearray)):
                val = val.decode("utf-8", errors="replace")
            raw[key] = val if isinstance(val, (str, list)) else str(val)
        return raw

    # ── operaciones de red (bloqueantes, se corren en thread) ───────────
    def _connect(self):
        import ldap3

        server = ldap3.Server(self.host, get_info=ldap3.NONE)
        conn = ldap3.Connection(
            server,
            user=self.bind_dn or None,
            password=self.bind_pass or None,
            auto_bind=True,
        )
        return conn

    def _search(self, search_filter: str) -> list[PersonRecord]:
        import ldap3

        records: list[PersonRecord] = []
        conn = None
        try:
            conn = self._connect()
            entries = conn.extend.standard.paged_search(
                search_base=self.base_dn,
                search_filter=search_filter,
                attributes=ldap3.ALL_ATTRIBUTES,
                paged_size=self.page_size,
                generator=True,
            )
            for entry in entries:
                if entry.get("type") != "searchResEntry":
                    continue
                raw = self._flatten(entry.get("attributes", {}))
                rec = record_from_raw(self.name, raw, self.name)
                if rec is not None:
                    records.append(rec)
        finally:
            if conn is not None:
                try:
                    conn.unbind()
                except Exception:
                    pass
        return records

    # ── interfaz IdentityProvider ───────────────────────────────────────
    async def fetch_all(self):
        try:
            return await asyncio.to_thread(self._search, self.user_filter)
        except Exception as e:
            logger.warning(f"LdapProvider.fetch_all falló: {e}")
            return []

    async def lookup(self, id_type: str, id_value: str) -> PersonRecord | None:
        attr = self._attr_for_id_type(id_type)
        if not attr:
            return None
        # Escapar el valor para evitar romper el filtro LDAP.
        try:
            from ldap3.utils.conv import escape_filter_chars

            safe = escape_filter_chars(id_value)
        except Exception:
            safe = id_value
        search_filter = f"(&{self.user_filter}({attr}={safe}))"
        try:
            records = await asyncio.to_thread(self._search, search_filter)
        except Exception as e:
            logger.warning(f"LdapProvider.lookup falló para {id_type}={id_value}: {e}")
            return None
        return records[0] if records else None

    async def health(self) -> bool:
        def _ping() -> bool:
            conn = None
            try:
                conn = self._connect()
                return bool(conn.bound)
            except Exception:
                return False
            finally:
                if conn is not None:
                    try:
                        conn.unbind()
                    except Exception:
                        pass

        try:
            return await asyncio.to_thread(_ping)
        except Exception:
            return False
