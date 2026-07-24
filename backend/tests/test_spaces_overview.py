"""GET /api/spaces/overview (routers/dashboard.py) — contrato congelado.

Agregado de TODOS los edificios activos a la vez para el dashboard público de
inicio. Sin autenticación (misma superficie pública que /spaces). Una sola
pasada agregada — nunca N+1 aunque haya 100 edificios.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import PresenceLog, Sede, Space
from app.routers.dashboard import get_spaces_overview
from app.schemas import SpacesOverviewResponse

LIMA = ZoneInfo("America/Lima")


def _entry(space_id, cardnumber, ts=None):
    return PresenceLog(
        cardnumber=cardnumber, patron_name="Test", event_type="entry",
        space_id=space_id, timestamp=ts or datetime.now(LIMA),
    )


def _exit(space_id, cardnumber, ts=None):
    return PresenceLog(
        cardnumber=cardnumber, patron_name="Test", event_type="exit",
        space_id=space_id, timestamp=ts or datetime.now(LIMA),
    )


class TestSpacesOverview:
    def test_forma_exacta_del_contrato(self, db):
        sede = Sede(id=1, name="Lima", code="LIMA")
        db.add(sede)
        db.commit()
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True, sede_id=sede.id))
        db.commit()
        db.add(_entry(1, "111"))
        db.commit()

        result = get_spaces_overview(db)
        assert isinstance(result, SpacesOverviewResponse)
        assert result.totals.buildings == 1
        assert result.totals.capacity == 100
        assert result.totals.current_occupancy == 1
        assert result.totals.occupancy_percent == 1.0
        b = result.buildings[0]
        assert b.id == 1 and b.name == "CRAI Lima"
        assert b.sede_code == "LIMA" and b.sede_name == "Lima"
        assert b.capacity == 100
        assert b.current_occupancy == 1
        assert b.entries_today == 1
        assert b.exits_today == 0

    def test_ocupacion_es_entradas_menos_salidas_nunca_negativa(self, db):
        db.add(Space(id=1, name="CRAI", capacity=50, active=True))
        db.commit()
        db.add_all([_entry(1, "1"), _exit(1, "1"), _exit(1, "2")])  # 1 entrada, 2 salidas
        db.commit()

        result = get_spaces_overview(db)
        assert result.buildings[0].current_occupancy == 0  # max(0, 1-2), nunca negativo

    def test_ignora_espacios_inactivos(self, db):
        db.add_all([
            Space(id=1, name="Activo", capacity=10, active=True),
            Space(id=2, name="Cerrado", capacity=10, active=False),
        ])
        db.commit()

        result = get_spaces_overview(db)
        assert result.totals.buildings == 1
        assert result.buildings[0].name == "Activo"

    def test_no_es_n_mas_uno_una_query_de_conteo_para_todos_los_espacios(self, db, monkeypatch):
        """Con 3 espacios activos, la agregación de presence_log debe salir en
        UNA sola query agrupada, no una por espacio."""
        db.add_all([
            Space(id=1, name="A", capacity=10, active=True),
            Space(id=2, name="B", capacity=10, active=True),
            Space(id=3, name="C", capacity=10, active=True),
        ])
        db.commit()
        db.add_all([_entry(1, "1"), _entry(2, "2"), _entry(3, "3")])
        db.commit()

        from sqlalchemy.orm import Query
        original_all = Query.all
        call_count = {"n": 0}

        def counting_all(self):
            call_count["n"] += 1
            return original_all(self)

        monkeypatch.setattr(Query, "all", counting_all)
        get_spaces_overview(db)
        # Dos queries de datos (spaces+sedes, y el agregado de presence_log),
        # no una por espacio -- con 3 espacios, N+1 daría 5 (2 + 3).
        assert call_count["n"] <= 2

    def test_ignora_eventos_de_dias_anteriores(self, db):
        db.add(Space(id=1, name="CRAI", capacity=10, active=True))
        db.commit()
        ayer = datetime.now(LIMA) - timedelta(days=1)
        db.add(_entry(1, "1", ts=ayer))
        db.commit()

        result = get_spaces_overview(db)
        assert result.buildings[0].current_occupancy == 0

    def test_sin_espacios_activos_totales_en_cero(self, db):
        result = get_spaces_overview(db)
        assert result.totals.buildings == 0
        assert result.totals.capacity == 0
        assert result.totals.current_occupancy == 0
        assert result.totals.occupancy_percent == 0.0
        assert result.buildings == []
