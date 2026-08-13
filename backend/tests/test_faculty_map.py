"""Resolución de la unidad de desglose (faculty_map.py).

Una institución tiene DOS ejes de pertenencia y una persona puede estar en uno,
en el otro o en ambos: el académico (facultad, solo quien estudia) y el laboral
(unidad organizativa, solo quien trabaja). El desglose del dashboard es único,
así que aquí se decide cuál gana y qué se descarta.
"""

import pytest

from app.services import faculty_map
from app.services.faculty_map import resolve_faculty

FACULTADES = {"FCS", "FIA"}
UNIDADES = {"Dirección de Tecnologías de Información", "Dirección Financiera"}
PROGRAMAS = {"P22": "FCS"}


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setattr(faculty_map, "VALID_FACULTY_CODES", FACULTADES)
    monkeypatch.setattr(faculty_map, "VALID_ORG_UNITS", UNIDADES)
    monkeypatch.setattr(faculty_map, "PROGRAM_TO_FACULTY", PROGRAMAS)


class TestEjeAcademico:
    def test_codigo_de_facultad_declarado_se_usa(self):
        assert resolve_faculty("FCS", None) == "FCS"

    def test_sin_facultad_se_deriva_del_programa(self):
        assert resolve_faculty(None, "P22") == "FCS"

    def test_codigo_no_declarado_se_descarta(self):
        """La whitelist existe para que un código sucio de la fuente no se
        convierta en una categoría propia del dashboard."""
        assert resolve_faculty("XYZ", None) == "Sin Facultad"


class TestEjeLaboral:
    """Caso real (13-ago-2026): un trabajador de la Dirección de TI aparecía en
    'Sin Facultad'. Es cierto —no tiene facultad— pero inútil: su área SÍ está
    en el directorio. 2.332 personas estaban así.
    """

    def test_unidad_declarada_se_usa(self):
        unidad = "Dirección de Tecnologías de Información"
        assert resolve_faculty(unidad, None) == unidad

    def test_unidad_no_declarada_se_descarta(self):
        """Mismo criterio que el eje académico: lo que el catálogo institucional
        no reconoce no entra al desglose."""
        assert resolve_faculty("Área que nadie declaró", None) == "Sin Facultad"

    def test_el_trabajador_hibrido_resuelve_por_su_facultad(self):
        """Quien trabaja Y estudia trae los dos: manda el eje académico, que es
        el que el desglose venía midiendo."""
        assert resolve_faculty("FIA", "P22") == "FIA"


class TestSinNada:
    def test_ni_facultad_ni_programa(self):
        assert resolve_faculty(None, None) == "Sin Facultad"

    def test_cadenas_vacias(self):
        assert resolve_faculty("", "") == "Sin Facultad"


class TestProductoAgnostico:
    """Sin overlay montado no hay catálogo institucional que consultar: lo que
    la fuente informe se acepta tal cual, en vez de borrarlo todo."""

    @pytest.fixture(autouse=True)
    def _sin_config(self, monkeypatch):
        monkeypatch.setattr(faculty_map, "VALID_FACULTY_CODES", set())
        monkeypatch.setattr(faculty_map, "VALID_ORG_UNITS", set())
        monkeypatch.setattr(faculty_map, "PROGRAM_TO_FACULTY", {})

    def test_pasa_el_valor_informado(self):
        assert resolve_faculty("LO-QUE-SEA", None) == "LO-QUE-SEA"

    def test_sin_valor_sigue_siendo_sin_facultad(self):
        assert resolve_faculty(None, "P22") == "Sin Facultad"
