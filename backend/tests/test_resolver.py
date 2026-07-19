"""Resolución de identidad en el escaneo (resolver.py).

Regla dura del producto: el conteo de aforo NUNCA se detiene. Un proveedor caído,
lento o que devuelve basura degrada a "Sin identificar", jamás propaga excepción.
"""

import asyncio

import pytest

from app.services.identity import resolver as resolver_mod
from app.services.identity.base import PersonRecord
from app.services.identity.repository import upsert_person
from app.services.identity.resolver import resolve_person


class FakeProvider:
    """Proveedor de prueba con comportamiento inyectable."""

    def __init__(self, name, priority, record=None, *, raises=False, hangs=False):
        self.name = name
        self.priority = priority
        self.enabled = True
        self._record = record
        self._raises = raises
        self._hangs = hangs
        self.lookups = []

    async def lookup(self, id_type, id_value, sede_code=""):
        self.lookups.append((id_type, id_value, sede_code))
        if self._raises:
            raise RuntimeError("fuente caída")
        if self._hangs:
            await asyncio.sleep(60)
        return self._record

    async def fetch_all(self):
        return []

    async def health(self):
        return True


@pytest.fixture
def con_proveedores(monkeypatch):
    def _install(*providers):
        monkeypatch.setattr(
            resolver_mod, "build_enabled_providers", lambda settings=None: list(providers)
        )
        return providers

    return _install


def registro(person_key="ldap:40390492", **kw):
    kw.setdefault("full_name", "Ada")
    kw.setdefault("identifiers", {"cardnumber": "201913085", "dni": "40390492"})
    return PersonRecord(person_key=person_key, source="ldap", **kw)


class TestPadronLocalPrimero:
    def test_resuelve_local_sin_tocar_proveedores(self, db, con_proveedores):
        p = FakeProvider("ldap", 30, registro())
        con_proveedores(p)
        upsert_person(db, registro(), source="ldap")

        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))

        assert origen == "local"
        assert person.full_name == "Ada"
        assert p.lookups == []  # no se salió a la red

    def test_local_resuelve_por_cualquier_credencial(self, db, con_proveedores):
        con_proveedores(FakeProvider("ldap", 30, registro()))
        upsert_person(db, registro(), source="ldap")

        _, origen_carne = asyncio.run(resolve_person(db, "cardnumber", "201913085"))
        _, origen_dni = asyncio.run(resolve_person(db, "dni", "40390492"))

        assert origen_carne == origen_dni == "local"


class TestRellenoPerezoso:
    def test_consulta_en_vivo_y_persiste(self, db, con_proveedores):
        con_proveedores(FakeProvider("ldap", 30, registro()))

        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))

        assert origen == "ldap"
        assert person.full_name == "Ada"
        # Quedó en el padrón: el siguiente escaneo ya no sale a la red.
        _, origen2 = asyncio.run(resolve_person(db, "cardnumber", "201913085"))
        assert origen2 == "local"

    def test_respeta_el_orden_de_prioridad(self, db, con_proveedores):
        primario = FakeProvider("ldap", 30, registro(full_name="Desde LDAP"))
        respaldo = FakeProvider("koha_db", 40, registro(full_name="Desde Koha"))
        con_proveedores(primario, respaldo)

        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))

        assert origen == "ldap"
        assert person.full_name == "Desde LDAP"
        assert respaldo.lookups == []  # no se consulta si el primario resolvió

    def test_cae_al_respaldo_si_el_primario_no_encuentra(self, db, con_proveedores):
        primario = FakeProvider("ldap", 30, None)
        respaldo = FakeProvider("koha_db", 40, registro(full_name="Desde Koha"))
        con_proveedores(primario, respaldo)

        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))

        assert origen == "koha_db"
        assert person.full_name == "Desde Koha"

    def test_indexa_la_credencial_consultada(self, db, con_proveedores):
        """Aunque la fuente no la devuelva entre sus identifiers, la credencial
        escaneada debe quedar indexada o el próximo escaneo repetiría la red."""
        con_proveedores(FakeProvider("ldap", 30, registro(identifiers={"dni": "40390492"})))

        asyncio.run(resolve_person(db, "cardnumber", "201913085"))

        _, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))
        assert origen == "local"


class TestElAforoNuncaSeDetiene:
    def test_ningun_proveedor_encuentra(self, db, con_proveedores):
        con_proveedores(FakeProvider("ldap", 30, None))
        person, origen = asyncio.run(resolve_person(db, "cardnumber", "999"))
        assert person is None
        assert origen == "unidentified"

    def test_sin_proveedores_habilitados(self, db, con_proveedores):
        con_proveedores()
        person, origen = asyncio.run(resolve_person(db, "cardnumber", "999"))
        assert person is None
        assert origen == "unidentified"

    def test_proveedor_que_revienta_no_propaga(self, db, con_proveedores):
        con_proveedores(FakeProvider("ldap", 30, raises=True))
        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))
        assert person is None
        assert origen == "unidentified"

    def test_proveedor_que_revienta_no_bloquea_al_siguiente(self, db, con_proveedores):
        con_proveedores(
            FakeProvider("ldap", 30, raises=True),
            FakeProvider("koha_db", 40, registro(full_name="Desde Koha")),
        )
        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))
        assert origen == "koha_db"
        assert person.full_name == "Desde Koha"

    def test_proveedor_colgado_no_congela_el_kiosko(self, db, con_proveedores, monkeypatch):
        """El timeout es del hot path: si la fuente no responde, se sigue."""
        monkeypatch.setattr(resolver_mod, "LOOKUP_TIMEOUT", 0.05)
        con_proveedores(
            FakeProvider("ldap", 30, hangs=True),
            FakeProvider("koha_db", 40, registro(full_name="Desde Koha")),
        )
        person, origen = asyncio.run(resolve_person(db, "cardnumber", "201913085"))
        assert origen == "koha_db"

    @pytest.mark.parametrize("valor", ["", "   ", None])
    def test_valor_vacio_no_sale_a_la_red(self, db, con_proveedores, valor):
        p = FakeProvider("ldap", 30, registro())
        con_proveedores(p)
        person, origen = asyncio.run(resolve_person(db, "cardnumber", valor))
        assert person is None
        assert origen == "unidentified"
        assert p.lookups == []

    def test_una_colision_de_identidad_no_tumba_el_escaneo(self, db, con_proveedores):
        """Si la fuente trae a dos personas con el mismo documento, el upsert
        rechaza la fusión — y el kiosko debe seguir contando, degradando a
        'Sin identificar' en vez de registrar a alguien como otra persona."""
        from app.services.identity.repository import upsert_person

        upsert_person(
            db,
            PersonRecord(
                person_key="ldap:14586255", full_name="Yasmani", source="ldap",
                identifiers={"cardnumber": "323100145", "dni": "14586255"},
            ),
            source="ldap",
        )
        # El proveedor devuelve otra persona con el MISMO documento.
        con_proveedores(
            FakeProvider("ldap", 30, PersonRecord(
                person_key="ldap:14586255", full_name="Otra", source="ldap",
                identifiers={"cardnumber": "202211927", "dni": "14586255"},
            ))
        )
        person, origen = asyncio.run(resolve_person(db, "cardnumber", "202211927"))
        assert person is None
        assert origen == "unidentified"
        # Y Yasmani sigue intacto.
        from app.models import Person

        assert db.query(Person).count() == 1

    def test_propaga_la_sede_al_proveedor(self, db, con_proveedores):
        """Las fuentes multi-sede necesitan saber desde qué campus se escanea."""
        p = FakeProvider("ldap", 30, registro())
        con_proveedores(p)
        asyncio.run(resolve_person(db, "cardnumber", "201913085", sede_code="LIMA"))
        assert p.lookups == [("cardnumber", "201913085", "LIMA")]
