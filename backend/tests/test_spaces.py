"""GET /api/spaces (routers/dashboard.py) — contrato congelado.

Sin autenticación (el kiosko público no puede loguearse). Devuelve solo
espacios activos, ordenados por sede_code y luego por name, con la forma
exacta que consume el selector del kiosko.
"""

from app.models import Sede, Space
from app.routers.dashboard import get_spaces
from app.schemas import PublicSpaceResponse


class TestGetSpaces:
    def test_solo_devuelve_espacios_activos(self, db):
        db.add(Space(id=1, name="CRAI Lima", capacity=100, active=True))
        db.add(Space(id=2, name="CRAI Cerrado", capacity=50, active=False))
        db.commit()

        result = get_spaces(db)
        assert len(result) == 1
        assert result[0].id == 1

    def test_forma_exacta_del_contrato(self, db):
        sede = Sede(id=1, name="Lima", code="LIMA")
        db.add(sede)
        db.commit()
        db.add(Space(id=1, name="CRAI Lima", capacity=847, active=True, sede_id=sede.id))
        db.commit()

        result = get_spaces(db)
        assert len(result) == 1
        r = result[0]
        assert isinstance(r, PublicSpaceResponse)
        assert r.model_dump() == {
            "id": 1,
            "name": "CRAI Lima",
            "capacity": 847,
            "sede_code": "LIMA",
            "sede_name": "Lima",
        }

    def test_space_sin_sede_no_se_descarta_y_va_con_null(self, db):
        db.add(Space(id=1, name="CRAI Huerfano", capacity=30, active=True, sede_id=None))
        db.commit()

        result = get_spaces(db)
        assert len(result) == 1
        assert result[0].sede_code is None
        assert result[0].sede_name is None

    def test_no_expone_campos_internos(self, db):
        sede = Sede(id=1, name="Lima", code="LIMA")
        db.add(sede)
        db.commit()
        db.add(Space(
            id=1, name="CRAI Lima", capacity=100, active=True, sede_id=sede.id,
            library_code="BUL", address="Av. Falsa 123", description="secreto",
        ))
        db.commit()

        result = get_spaces(db)
        dumped = result[0].model_dump()
        for campo_prohibido in ("library_code", "address", "description"):
            assert campo_prohibido not in dumped

    def test_orden_por_sede_code_luego_name(self, db):
        lima = Sede(id=1, name="Lima", code="LIMA")
        juliaca = Sede(id=2, name="Juliaca", code="JULIACA")
        db.add_all([lima, juliaca])
        db.commit()

        db.add_all([
            Space(id=1, name="CRAI Lima", capacity=847, active=True, sede_id=lima.id),
            Space(id=3, name="CRAI CIA", capacity=60, active=True, sede_id=lima.id),
            Space(id=2, name="CRAI Juliaca", capacity=80, active=True, sede_id=juliaca.id),
        ])
        db.commit()

        result = get_spaces(db)
        ids_en_orden = [r.id for r in result]
        # "JULIACA" < "LIMA" alfabéticamente, y dentro de LIMA: "CRAI CIA" < "CRAI Lima"
        assert ids_en_orden == [2, 3, 1]
