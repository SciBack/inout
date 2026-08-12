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
            "instDocumentNumber": "document_number",
            "instTitle": "role",
            "instOrgUnit": "escuela",
        },
        "identifiers": {
            "uid": "cardnumber",
            "instDocumentNumber": "document_number",
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

    def test_multivalor_fuera_de_la_precedencia_es_determinista(self):
        """Ninguno está en la precedencia declarada: se elige por orden estable,
        NO por el que la fuente puso primero."""
        out = map_fields("ldap", {"eduPersonAffiliation": ["rarito", "otro"]})
        assert out["category"] == "otro"


class TestMultivalorSinPrecedencia:
    """Un directorio no garantiza el orden de un atributo multivalor. Sin este
    colapso estable, el mismo registro resolvía distinto entre dos sincronizaciones
    y la persona parecía cambiar de programa sola.

    Caso real que lo motivó: el código de programa institucional es multivalor
    porque los programas recodificados llevan el histórico y el vigente.
    """

    def test_mismo_resultado_sea_cual_sea_el_orden_de_la_fuente(self):
        campo = "instFacultyCode"  # sin precedencia declarada en LDAP_MAP
        a = map_fields("ldap", {campo: ["FIA", "FCS", "EPG"]})
        b = map_fields("ldap", {campo: ["EPG", "FIA", "FCS"]})
        c = map_fields("ldap", {campo: ["FCS", "EPG", "FIA"]})
        assert a["faculty"] == b["faculty"] == c["faculty"]

    def test_un_solo_valor_en_lista_se_desenvuelve(self):
        assert map_fields("ldap", {"instFacultyCode": ["FIA"]})["faculty"] == "FIA"

    def test_lista_vacia_no_produce_campo(self):
        assert "faculty" not in map_fields("ldap", {"instFacultyCode": []})


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
        assert out == {"cardnumber": "201913085", "document_number": "40390492"}

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
        assert rec.identifiers == {"cardnumber": "201913085", "document_number": "40390492"}

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


class TestValorDemasiadoLargoNoTumbaALaPersona:
    """Las fuentes guardan texto descriptivo donde el padrón declara códigos.
    Medido en producción (2026-08-11): `ou` de LDAP llega con 128 caracteres,
    `title` con 80 y `sort2` de Koha con 64.

    Sin esta guarda el INSERT reventaba y se perdía la PERSONA COMPLETA por un
    campo accesorio: 141 registros por corrida, de los cuales ~18 nunca llegaron
    a existir en el padrón y ~123 dejaron de actualizarse. El mismo valor rompía
    además el escaneo en vivo, que escribe el programa en cada evento.
    """

    # Caso real de producción: 80 caracteres para role, que admite 150 hoy
    # pero admitía 50 cuando esto reventaba.
    CARGO_LARGO = "Asistente de Laboratorio Centro de Investigacion de Ciencia de Alimentos (CICAL)"

    def _limite(self, campo):
        from app.services.identity.mapping import FIELD_MAX_LEN
        return FIELD_MAX_LEN[campo]

    def test_descarta_el_campo_que_no_cabe(self):
        excesivo = "x" * (self._limite("role") + 1)
        out = map_fields("ldap", {"cn": "Ada", "instTitle": excesivo})
        assert "role" not in out, "un valor que no cabe debe descartarse, no propagarse"

    def test_conserva_al_resto_de_la_persona(self):
        """Lo que de verdad importa: la persona sigue entrando al padrón."""
        excesivo = "x" * (self._limite("escuela") + 1)
        out = map_fields("ldap", {
            "cn": "Ada Lovelace", "instFacultyCode": "FIA", "instOrgUnit": excesivo,
        })
        assert out["full_name"] == "Ada Lovelace"
        assert out["faculty"] == "FIA"
        assert "escuela" not in out

    def test_no_recorta(self):
        """Un código truncado es otro código y podría chocar con uno real."""
        excesivo = "Diplomatura en " + "y" * self._limite("escuela")
        out = map_fields("ldap", {"cn": "Ada", "instOrgUnit": excesivo})
        assert "escuela" not in out
        assert excesivo[: self._limite("escuela")] not in out.values()

    def test_el_valor_que_si_cabe_pasa_intacto(self):
        out = map_fields("ldap", {"cn": "Ada", "instTitle": self.CARGO_LARGO})
        assert out["role"] == self.CARGO_LARGO

    def test_justo_en_el_limite_pasa(self):
        exacto = "z" * self._limite("role")
        assert map_fields("ldap", {"instTitle": exacto})["role"] == exacto

    def test_los_limites_salen_del_modelo(self):
        """Si mañana se ensancha una columna, el límite la sigue solo."""
        from app.models import Person
        from app.services.identity.mapping import FIELD_MAX_LEN

        for col in Person.__table__.columns:
            if getattr(col.type, "length", None):
                assert FIELD_MAX_LEN[col.name] == col.type.length
