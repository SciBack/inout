"""Mapeo declarativo fuente→padrón (mapping.py).

El canónico es agnóstico: sin identity_map montado debe seguir funcionando por
passthrough. Con mapa, la semántica que importa es colapsar multivalores de forma
determinista y no inventar valores que la fuente no trajo.
"""

import pytest

from app.services.identity.mapping import (
    map_fields,
    map_identifiers,
    record_from_raw,
)

# Mapa equivalente al contrato LDAP de una institución (forma, no datos reales).
LDAP_MAP = {
    "ldap": {
        "fields": {
            "cn": "full_name",
            "eduPersonAffiliation": "category",
            "schacGender": "gender",
            "instFacultyCode": "faculty",
            "instDocumentNumber": "dni",
        },
        "identifiers": {
            "uid": "cardnumber",
            "instDocumentNumber": "dni",
        },
        "value_maps": {"gender": {"1": "M", "2": "F"}},
        "precedence": {"category": ["faculty", "staff", "student", "alum", "member"]},
    }
}


@pytest.fixture(autouse=True)
def _map(identity_map):
    identity_map(LDAP_MAP)


class TestMapFields:
    def test_renombra_segun_el_mapa(self):
        out = map_fields("ldap", {"cn": "Ada Lovelace", "instFacultyCode": "FIA"})
        assert out == {"full_name": "Ada Lovelace", "faculty": "FIA"}

    def test_atributo_ausente_no_aparece(self):
        """Caso real: entries sin facultad traen el atributo AUSENTE, no
        'UNKNOWN'. Debe quedar vacío, nunca inventarse un código."""
        out = map_fields("ldap", {"cn": "Ada Lovelace"})
        assert "faculty" not in out

    def test_string_vacio_se_descarta(self):
        out = map_fields("ldap", {"cn": "Ada", "instFacultyCode": ""})
        assert "faculty" not in out

    def test_campo_fuente_desconocido_se_ignora(self):
        out = map_fields("ldap", {"cn": "Ada", "atributoQueNadieMapeo": "x"})
        assert out == {"full_name": "Ada"}

    def test_passthrough_sin_mapa(self, identity_map):
        """Producto agnóstico: sin overlay se toman las claves que ya se llaman
        como un campo del padrón."""
        identity_map({})
        out = map_fields("ldap", {"full_name": "Ada", "faculty": "FIA", "ruido": "x"})
        assert out == {"full_name": "Ada", "faculty": "FIA"}


class TestPrecedencia:
    def test_colapsa_multivalor_por_precedencia(self):
        """Una persona híbrida (docente que además estudia) debe resolver
        siempre igual, no según el orden que devolvió la fuente."""
        out = map_fields("ldap", {"eduPersonAffiliation": ["student", "faculty"]})
        assert out["category"] == "faculty"

    def test_es_estable_ante_el_orden_de_la_fuente(self):
        a = map_fields("ldap", {"eduPersonAffiliation": ["student", "faculty"]})
        b = map_fields("ldap", {"eduPersonAffiliation": ["faculty", "student"]})
        assert a["category"] == b["category"] == "faculty"

    def test_valor_unico_no_se_toca(self):
        out = map_fields("ldap", {"eduPersonAffiliation": "alum"})
        assert out["category"] == "alum"

    def test_multivalor_fuera_de_la_precedencia_toma_el_primero(self):
        out = map_fields("ldap", {"eduPersonAffiliation": ["rarito", "otro"]})
        assert out["category"] == "rarito"


class TestValueMaps:
    def test_traduce_valor_declarado(self):
        assert map_fields("ldap", {"schacGender": "1"})["gender"] == "M"
        assert map_fields("ldap", {"schacGender": "2"})["gender"] == "F"

    @pytest.mark.parametrize("code", ["0", "9"])
    def test_valor_fuera_del_mapa_se_descarta(self, code):
        """ISO 5218 0=no conocido / 9=no aplica: mejor sin género que forzar M/F."""
        assert "gender" not in map_fields("ldap", {"schacGender": code})


class TestIdentificadores:
    def test_extrae_los_declarados(self):
        out = map_identifiers("ldap", {"uid": "201913085", "instDocumentNumber": "40390492"})
        assert out == {"cardnumber": "201913085", "dni": "40390492"}

    def test_coacciona_a_str(self):
        assert map_identifiers("ldap", {"uid": 12345})["cardnumber"] == "12345"

    def test_credencial_ausente_no_aparece(self):
        assert map_identifiers("ldap", {"uid": "201913085"}) == {"cardnumber": "201913085"}


class TestRecordFromRaw:
    def test_deriva_person_key_del_dni(self):
        """Sin person_key explícito se deriva del identificador de mayor
        prioridad (dni) → la misma persona colapsa a una sola clave."""
        rec = record_from_raw(
            "ldap",
            {"cn": "Ada", "uid": "201913085", "instDocumentNumber": "40390492"},
            source="ldap",
        )
        assert rec.person_key == "ldap:40390492"
        assert rec.full_name == "Ada"
        assert rec.identifiers == {"cardnumber": "201913085", "dni": "40390492"}

    def test_sin_dni_cae_al_carne(self):
        rec = record_from_raw("ldap", {"cn": "Ada", "uid": "201913085"}, source="ldap")
        assert rec.person_key == "ldap:201913085"

    def test_sin_credenciales_devuelve_none(self):
        """No se puede indexar a alguien sin ninguna credencial: mejor None que
        una fila huérfana en el padrón."""
        assert record_from_raw("ldap", {"cn": "Ada"}, source="ldap") is None

    def test_conserva_el_raw_para_auditoria(self):
        raw = {"cn": "Ada", "uid": "1", "eduPersonAffiliation": ["student", "faculty"]}
        rec = record_from_raw("ldap", raw, source="ldap")
        # El set completo de afiliaciones se preserva aunque category se colapse.
        assert rec.raw["eduPersonAffiliation"] == ["student", "faculty"]
        assert rec.category == "faculty"
