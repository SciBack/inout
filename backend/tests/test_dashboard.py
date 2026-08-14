"""cross_campus_breakdown en GET /api/dashboard (routers/dashboard.py).

Mide cuánta gente que vive/pertenece a OTRO campus visita el edificio de un
campus dado. patron_home_sede es un SNAPSHOT tomado en el momento del evento
(igual que patron_category/patron_faculty/patron_gender) — no una relación.

Se prueba directo contra `_compute_cross_campus_breakdown`, no contra
`get_dashboard`: el resto del endpoint usa func.extract/func.timezone
(específicas de PostgreSQL) que SQLite no compila, y esa función no las
necesita — se probó a propósito sin esa dependencia.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import PresenceLog, Sede, Space
from app.routers.dashboard import _compute_cross_campus_breakdown

LIMA = ZoneInfo("America/Lima")


def _entry(space_id, cardnumber, home_sede, ts=None):
    return PresenceLog(
        cardnumber=cardnumber,
        patron_name="Test",
        patron_category="student",
        patron_home_sede=home_sede,
        event_type="entry",
        space_id=space_id,
        timestamp=ts or datetime.now(LIMA),
    )


def _run(db, sid=1, own_sede_code=None):
    hoy_ini = datetime.now(LIMA).replace(hour=0, minute=0, second=0, microsecond=0)
    hoy_fin = hoy_ini + timedelta(days=1)
    return _compute_cross_campus_breakdown(db, sid, hoy_ini, hoy_fin, own_sede_code)


def _by_code(breakdown):
    return {h.home_sede_code: h for h in breakdown}


class TestVisitantesCruzados:
    def test_origen_distinto_a_la_sede_del_space_aparece(self, db):
        juliaca = Sede(id=2, name="Juliaca", code="JULIACA")
        db.add(juliaca)
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(_entry(1, "111", "JULIACA"))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert "JULIACA" in by_code
        assert by_code["JULIACA"].count == 1
        assert by_code["JULIACA"].label == "Juliaca"

    def test_origen_igual_a_la_sede_del_space_no_aparece(self, db):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(_entry(1, "111", "LIMA"))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert "LIMA" not in by_code

    def test_origen_null_aparece_como_no_registrado_y_nunca_se_oculta(self, db):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(_entry(1, "111", None))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert None in by_code
        assert by_code[None].label == "Origen no registrado"
        assert by_code[None].count == 1

    def test_origen_null_tampoco_se_oculta_cuando_hay_visitantes_cruzados(self, db):
        juliaca = Sede(id=2, name="Juliaca", code="JULIACA")
        db.add(juliaca)
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add_all([
            _entry(1, "111", "JULIACA"),
            _entry(1, "222", None),
            _entry(1, "333", "LIMA"),  # local, se excluye
        ])
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert set(by_code.keys()) == {"JULIACA", None}

    def test_space_sin_sede_no_excluye_nada(self, db):
        juliaca = Sede(id=2, name="Juliaca", code="JULIACA")
        db.add(juliaca)
        db.add(Space(id=1, name="CRAI Sin Sede", capacity=100, active=True, sede_id=None))
        # Como el space no tiene sede propia, no hay base de comparación:
        # ni siquiera un origen "JULIACA" se excluye.
        db.add(_entry(1, "111", "JULIACA"))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code=None))
        assert "JULIACA" in by_code
        assert by_code["JULIACA"].count == 1

    def test_label_de_codigo_conocido_es_el_nombre_real_de_la_sede(self, db):
        tarapoto = Sede(id=3, name="Tarapoto", code="TARAPOTO")
        db.add(tarapoto)
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(_entry(1, "111", "TARAPOTO"))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert by_code["TARAPOTO"].label == "Tarapoto"

    def test_codigo_huerfano_usa_el_codigo_crudo_como_label_sin_crashear(self, db):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(_entry(1, "111", "FANTASMA"))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert by_code["FANTASMA"].label == "FANTASMA"

    def test_se_cuenta_por_cardnumber_unico_no_por_evento(self, db):
        juliaca = Sede(id=2, name="Juliaca", code="JULIACA")
        db.add(juliaca)
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))

        now = datetime.now(LIMA)
        # Misma persona entra, sale y vuelve a entrar hoy: no debe duplicarse.
        db.add(_entry(1, "111", "JULIACA", ts=now))
        db.add(PresenceLog(
            cardnumber="111", patron_name="Test", patron_category="student",
            patron_home_sede="JULIACA", event_type="exit", space_id=1,
            timestamp=now + timedelta(minutes=30),
        ))
        db.add(_entry(1, "111", "JULIACA", ts=now + timedelta(minutes=60)))
        db.commit()

        by_code = _by_code(_run(db, sid=1, own_sede_code="LIMA"))
        assert by_code["JULIACA"].count == 1

    def test_ordenado_de_mayor_a_menor(self, db):
        juliaca = Sede(id=2, name="Juliaca", code="JULIACA")
        tarapoto = Sede(id=3, name="Tarapoto", code="TARAPOTO")
        db.add_all([juliaca, tarapoto])
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add_all([
            _entry(1, "1", "JULIACA"),
            _entry(1, "2", "JULIACA"),
            _entry(1, "3", "JULIACA"),
            _entry(1, "4", "TARAPOTO"),
        ])
        db.commit()

        breakdown = _run(db, sid=1, own_sede_code="LIMA")
        counts = [h.count for h in breakdown]
        assert counts == sorted(counts, reverse=True)
        assert breakdown[0].home_sede_code == "JULIACA"


class TestVisitanteUnicoEsLaPersona:
    """Alguien lleva varias credenciales —carné de trabajador, carné de alumno,
    DNI— y las usa indistintamente. Agrupando por el código escaneado, la misma
    humana entra dos veces en el desglose y el aforo del día suma de más. Caso
    real (13-ago-2026): un trabajador que además estudió salía dos veces en
    "Sin Facultad", una por cada carné.

    Se prueba sobre _compute_cross_campus_breakdown por el mismo motivo que el
    resto del módulo: es el agregado por visitante único que SQLite sí compila.
    """

    def _entrada(self, db, card, person_key, home_sede="BUT"):
        ev = _entry(1, card, home_sede)
        ev.person_key = person_key
        db.add(ev)
        db.commit()

    def test_dos_credenciales_de_la_misma_persona_cuentan_una_vez(self, db):
        self._entrada(db, "9610165", "ldap:10867326")
        self._entrada(db, "10867326", "ldap:10867326")
        assert _by_code(_run(db))["BUT"].count == 1

    def test_dos_personas_distintas_siguen_contando_dos(self, db):
        self._entrada(db, "111", "ldap:111")
        self._entrada(db, "222", "ldap:222")
        assert _by_code(_run(db))["BUT"].count == 2

    def test_sin_persona_se_cuenta_por_su_codigo(self, db):
        """Una visita externa no está en el padrón y aun así ocupa el edificio:
        se cuenta, agrupada por el código que presentó."""
        self._entrada(db, "visita-1", None)
        self._entrada(db, "visita-1", None)
        self._entrada(db, "visita-2", None)
        assert _by_code(_run(db))["BUT"].count == 2

    def test_la_persona_manda_sobre_el_codigo(self, db):
        """Dos códigos distintos con la misma persona no son dos visitantes,
        aunque los códigos no se parezcan en nada."""
        self._entrada(db, "carne-trabajador", "ldap:1")
        self._entrada(db, "dni", "ldap:1")
        assert _by_code(_run(db))["BUT"].count == 1
