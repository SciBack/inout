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
