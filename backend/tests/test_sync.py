"""Sync del padrón (sync.py).

Un padrón silenciosamente incompleto es peor que un fallo declarado: si la
fuente falla o trunca, la corrida debe quedar en 'error' y NO reportar éxito
con 0 registros.
"""

import asyncio

import pytest

from app.services.identity.base import PersonRecord
from app.services.sync import sync_provider


class FakeProvider:
    def __init__(self, name="fuente", records=None, *, raises=None):
        self.name = name
        self.priority = 30
        self.enabled = True
        self._records = records or []
        self._raises = raises

    async def fetch_all(self):
        if self._raises:
            raise self._raises
        return self._records

    async def lookup(self, id_type, id_value, sede_code=""):
        return None

    async def health(self):
        return True


def registro(person_key, **kw):
    kw.setdefault("identifiers", {"dni": person_key.split(":")[-1]})
    return PersonRecord(person_key=person_key, source="fuente", **kw)


class TestCorridaFeliz:
    def test_cuenta_altas(self, db):
        p = FakeProvider(records=[registro("ldap:1", full_name="Ada"), registro("ldap:2", full_name="Grace")])
        run = asyncio.run(sync_provider(db, p))
        assert (run.status, run.created, run.updated, run.errors) == ("ok", 2, 0, 0)

    def test_segunda_corrida_cuenta_cambios_no_altas(self, db):
        p = FakeProvider(records=[registro("ldap:1", full_name="Ada")])
        asyncio.run(sync_provider(db, p))
        run = asyncio.run(sync_provider(db, p))
        assert (run.status, run.created, run.updated) == ("ok", 0, 1)


class TestFalloDeclarado:
    """Lo que este módulo no puede hacer nunca: decir 'ok' cuando la fuente
    falló. El operador lee el status para saber si el padrón está completo."""

    def test_fuente_que_falla_marca_error(self, db):
        p = FakeProvider(raises=RuntimeError("LDAP sizeLimitExceeded: se truncó en 10000 entries"))
        run = asyncio.run(sync_provider(db, p))
        assert run.status == "error"
        assert run.errors == 1

    def test_fuente_que_falla_no_reporta_exito_vacio(self, db):
        p = FakeProvider(raises=RuntimeError("conexión caída"))
        run = asyncio.run(sync_provider(db, p))
        assert run.status != "ok"

    def test_fuente_vacia_de_verdad_es_ok(self, db):
        """Vacío legítimo ≠ fallo: un proveedor sin volcado masivo reporta ok."""
        run = asyncio.run(sync_provider(db, FakeProvider(records=[])))
        assert (run.status, run.created, run.errors) == ("ok", 0, 0)

    def test_registra_el_nombre_de_la_instancia(self, db):
        """Con varias ramas del mismo directorio, la corrida debe decir de cuál
        vino para poder auditarlas por separado."""
        run = asyncio.run(sync_provider(db, FakeProvider(name="ldap-alumni")))
        assert run.provider == "ldap-alumni"


class TestFetchAllPropagaElFallo:
    """El sync es la capa que tiene dónde registrar el error; el proveedor no
    debe tragárselo y devolver [] (eso se lee como 'ok, 0 registros')."""

    def test_ldap_propaga_el_truncado(self, monkeypatch):
        from app.config import Settings
        from app.services.identity.ldap_provider import LdapProvider

        p = LdapProvider(Settings(ldap_enabled=True, ldap_base_dn="ou=x,dc=y"))

        def _boom(search_filter):
            raise RuntimeError("LDAP sizeLimitExceeded: la búsqueda se truncó en 10000 entries")

        monkeypatch.setattr(p, "_search", _boom)

        with pytest.raises(RuntimeError, match="sizeLimitExceeded"):
            asyncio.run(p.fetch_all())

    def test_ldap_lookup_en_cambio_nunca_lanza(self, monkeypatch):
        """El escaneo es el hot path del kiosko: ahí sí se degrada en silencio."""
        from app.config import Settings
        from app.services.identity.ldap_provider import LdapProvider

        p = LdapProvider(Settings(ldap_enabled=True, ldap_base_dn="ou=x,dc=y", ldap_id_attrs="uid"))

        def _boom(search_filter):
            raise RuntimeError("conexión caída")

        monkeypatch.setattr(p, "_search", _boom)

        assert asyncio.run(p.lookup("cardnumber", "1")) is None
