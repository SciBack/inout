"""Registro del escaneo (routers/scan.py).

InOut NO controla acceso: no hay molinete ni agente que restrinja la entrada.
Solo mide ocupación y permanencia. De ahí la regla que fijan estos tests: a
quien no está en ningún padrón se le AVISA, pero su ingreso se registra igual
—está físicamente dentro del edificio y para el aforo (y para una evacuación)
cuenta como cualquier otro.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.models import PresenceLog, Space
from app.services.identity.base import PersonRecord
from app.services.identity.repository import upsert_person


@pytest.fixture
def espacio(db):
    sp = Space(id=1, name="CRAI Test", capacity=100, active=True)
    db.add(sp)
    db.commit()
    return sp


def _scan(db, cardnumber, monkeypatch, persona=None):
    """Llama al endpoint de escaneo con la resolución de identidad simulada."""
    from app.routers import scan as scan_mod
    from app.schemas import ScanRequest

    async def fake_resolve(_db, id_type, id_value, sede_code=""):
        return (persona, "local" if persona else "unidentified")

    monkeypatch.setattr(scan_mod, "resolve_person", fake_resolve)
    return asyncio.run(scan_mod.scan(ScanRequest(cardnumber=cardnumber), db))


class TestDesconocidoSeRegistraIgual:
    def test_queda_registrado_en_presence_log(self, db, espacio, monkeypatch):
        _scan(db, "999999", monkeypatch, persona=None)
        assert db.query(PresenceLog).count() == 1

    def test_cuenta_como_entrada(self, db, espacio, monkeypatch):
        r = _scan(db, "999999", monkeypatch, persona=None)
        assert r.event_type == "entry"

    def test_no_queda_con_categoria_vacia(self, db, espacio, monkeypatch):
        """Con categoría vacía caía en 'OTROS' del dashboard, mezclado con
        códigos legítimos sin mapear — el dato se volvía invisible."""
        _scan(db, "999999", monkeypatch, persona=None)
        log = db.query(PresenceLog).one()
        assert log.patron_category == "visitor"

    def test_la_respuesta_marca_que_no_se_identifico(self, db, espacio, monkeypatch):
        r = _scan(db, "999999", monkeypatch, persona=None)
        assert r.identified is False

    def test_el_mensaje_avisa_pero_no_dice_que_se_rechazo(self, db, espacio, monkeypatch):
        r = _scan(db, "999999", monkeypatch, persona=None)
        assert "visita" in r.message.lower()
        # No debe sugerir que se le negó el paso: InOut no controla acceso.
        for prohibida in ("denegado", "rechazado", "no puede", "prohibido", "acceso"):
            assert prohibida not in r.message.lower()

    def test_la_salida_tambien_se_registra(self, db, espacio, monkeypatch):
        _scan(db, "999999", monkeypatch, persona=None)
        db.query(PresenceLog).one().timestamp  # fuerza carga
        # Segundo escaneo del mismo desconocido → salida.
        import app.routers.scan as scan_mod

        monkeypatch.setattr(scan_mod, "DEBOUNCE_SECONDS", 0)
        r = _scan(db, "999999", monkeypatch, persona=None)
        assert r.event_type == "exit"
        assert db.query(PresenceLog).count() == 2


class TestIdentificadoNoCambia:
    """La conducta de siempre no debe alterarse."""

    def test_persona_conocida_conserva_su_categoria(self, db, espacio, monkeypatch):
        p = upsert_person(
            db,
            PersonRecord(person_key="ldap:1", full_name="Ada Lovelace", source="ldap",
                         category="student", identifiers={"cardnumber": "111"}),
            source="ldap",
        )
        _scan(db, "111", monkeypatch, persona=p)
        log = db.query(PresenceLog).one()
        assert log.patron_category == "student"
        assert log.patron_name == "Ada Lovelace"

    def test_persona_conocida_se_marca_identificada(self, db, espacio, monkeypatch):
        p = upsert_person(
            db,
            PersonRecord(person_key="ldap:1", full_name="Ada", source="ldap",
                         category="student", identifiers={"cardnumber": "111"}),
            source="ldap",
        )
        r = _scan(db, "111", monkeypatch, persona=p)
        assert r.identified is True
        assert "bienvenid" in r.message.lower()


class TestSnapshotHomeSede:
    """patron_home_sede es un SNAPSHOT del campus de origen de la persona al
    momento del evento (igual patrón que patron_category/patron_faculty)."""

    def test_persona_identificada_guarda_su_home_sede_code(self, db, espacio, monkeypatch):
        p = upsert_person(
            db,
            PersonRecord(person_key="ldap:1", full_name="Ada Lovelace", source="ldap",
                         category="student", home_sede_code="JULIACA",
                         identifiers={"cardnumber": "111"}),
            source="ldap",
        )
        _scan(db, "111", monkeypatch, persona=p)
        log = db.query(PresenceLog).one()
        assert log.patron_home_sede == "JULIACA"

    def test_persona_no_identificada_guarda_null(self, db, espacio, monkeypatch):
        _scan(db, "999999", monkeypatch, persona=None)
        log = db.query(PresenceLog).one()
        assert log.patron_home_sede is None


class TestResolucionDeEspacio:
    """El backend ya no adivina el edificio con settings.default_space_id.

    Si hay un único espacio activo, se resuelve solo (institución de un solo
    edificio). Si hay más de uno, el kiosko debe indicar space_id. Un
    space_id inválido o inactivo es rechazado explícitamente.
    """

    def test_un_solo_espacio_activo_no_exige_space_id(self, db, espacio, monkeypatch):
        r = _scan(db, "999999", monkeypatch, persona=None)
        assert r.event_type == "entry"
        log = db.query(PresenceLog).one()
        assert log.space_id == espacio.id

    def test_dos_espacios_activos_sin_space_id_da_400(self, db, monkeypatch):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(Space(id=2, name="CRAI Juliaca", capacity=80, active=True))
        db.commit()

        with pytest.raises(HTTPException) as exc:
            _scan(db, "999999", monkeypatch, persona=None)
        assert exc.value.status_code == 400
        assert exc.value.detail == "space_id_requerido"

    def test_space_id_de_espacio_inactivo_da_400(self, db, monkeypatch):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=False))
        db.commit()

        from app.routers import scan as scan_mod
        from app.schemas import ScanRequest

        async def fake_resolve(_db, id_type, id_value, sede_code=""):
            return (None, "unidentified")

        monkeypatch.setattr(scan_mod, "resolve_person", fake_resolve)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(scan_mod.scan(ScanRequest(cardnumber="999999", space_id=1), db))
        assert exc.value.status_code == 400
        assert exc.value.detail == "space_id_invalido"

    def test_space_id_inexistente_da_400(self, db, monkeypatch):
        from app.routers import scan as scan_mod
        from app.schemas import ScanRequest

        async def fake_resolve(_db, id_type, id_value, sede_code=""):
            return (None, "unidentified")

        monkeypatch.setattr(scan_mod, "resolve_person", fake_resolve)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(scan_mod.scan(ScanRequest(cardnumber="999999", space_id=999), db))
        assert exc.value.status_code == 400
        assert exc.value.detail == "space_id_invalido"

    def test_cero_espacios_activos_da_400(self, db, monkeypatch):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=False))
        db.commit()

        with pytest.raises(HTTPException) as exc:
            _scan(db, "999999", monkeypatch, persona=None)
        assert exc.value.status_code == 400
        assert exc.value.detail == "sin_espacios_activos"
