"""Registro de proveedores (providers.py).

El canónico arranca agnóstico: sin config no hay ninguna fuente habilitada y el
sistema degrada a "Sin identificar" en vez de romper.
"""

import pytest

from app.config import Settings
from app.services.identity.ldap_provider import LdapProvider
from app.services.identity.providers import build_enabled_providers


def settings(**kw):
    # Settings lee del entorno; los kwargs explícitos ganan.
    base = dict(
        koha_enabled=False, koha_db_enabled=False, ldap_enabled=False, csv_enabled=False
    )
    base.update(kw)
    return Settings(**base)


class TestHabilitacion:
    def test_sin_config_no_hay_proveedores(self):
        assert build_enabled_providers(settings()) == []

    def test_solo_los_habilitados(self):
        ps = build_enabled_providers(settings(ldap_enabled=True))
        assert [p.name for p in ps] == ["ldap"]

    def test_varios_a_la_vez(self):
        ps = build_enabled_providers(settings(ldap_enabled=True, koha_db_enabled=True))
        assert {p.name for p in ps} == {"ldap", "koha_db"}


class TestPrioridad:
    def test_ordena_ascendente(self):
        """Menor priority = se consulta antes. El orden es el contrato del
        fallback: primario primero, respaldo después."""
        ps = build_enabled_providers(
            settings(ldap_enabled=True, ldap_priority=30, koha_db_enabled=True, koha_db_priority=40)
        )
        assert [p.name for p in ps] == ["ldap", "koha_db"]

    def test_el_orden_lo_manda_la_prioridad_no_el_codigo(self):
        """Invertir las prioridades invierte el orden: nada está cableado."""
        ps = build_enabled_providers(
            settings(ldap_enabled=True, ldap_priority=90, koha_db_enabled=True, koha_db_priority=10)
        )
        assert [p.name for p in ps] == ["koha_db", "ldap"]


class TestConfigLdap:
    def test_toma_base_dn_y_filtro_de_settings(self):
        ps = build_enabled_providers(
            settings(
                ldap_enabled=True,
                ldap_base_dn="ou=people,dc=ejemplo,dc=edu",
                ldap_user_filter="(eduPersonAffiliation=member)",
            )
        )
        assert ps[0].base_dn == "ou=people,dc=ejemplo,dc=edu"
        assert ps[0].user_filter == "(eduPersonAffiliation=member)"

    def test_filtro_por_defecto_si_no_se_declara(self):
        ps = build_enabled_providers(settings(ldap_enabled=True))
        assert ps[0].user_filter == "(objectClass=person)"


class TestRawExclude:
    """Un sistema de aforo no necesita fotos ni credenciales, y no debe
    custodiarlas. Se descartan al leer, antes de tocar el padrón."""

    def _provider(self, **kw):
        from app.services.identity.ldap_provider import LdapProvider

        return LdapProvider(settings(ldap_enabled=True, ldap_base_dn="ou=x,dc=y", **kw))

    def test_descarta_la_foto_y_deja_lo_demas(self):
        raw = self._provider()._flatten(
            {"uid": "9610165", "cn": "Ada", "jpegPhoto": b"\xff\xd8\xff" * 2000}
        )
        assert "jpegPhoto" not in raw
        assert raw == {"uid": "9610165", "cn": "Ada"}

    @pytest.mark.parametrize(
        "attr", ["userPassword", "userCertificate", "thumbnailPhoto", "userPKCS12"]
    )
    def test_descarta_credenciales_y_binarios(self, attr):
        raw = self._provider()._flatten({"uid": "1", attr: b"secreto"})
        assert attr not in raw

    def test_es_case_insensitive(self):
        """El directorio puede servir 'jpegphoto' o 'JPEGPHOTO'."""
        raw = self._provider()._flatten({"uid": "1", "JPEGPHOTO": b"x", "jpegphoto": b"y"})
        assert list(raw) == ["uid"]

    def test_la_lista_es_configurable(self):
        raw = self._provider(ldap_raw_exclude="mobile,schacDateOfBirth")._flatten(
            {"uid": "1", "mobile": "999", "schacDateOfBirth": "19780621", "cn": "Ada"}
        )
        assert raw == {"uid": "1", "cn": "Ada"}

    def test_vaciar_la_lista_guarda_todo(self):
        """Decisión explícita del cliente: sin exclusiones se guarda lo que
        sirva el directorio."""
        raw = self._provider(ldap_raw_exclude="")._flatten({"uid": "1", "jpegPhoto": b"x"})
        assert "jpegPhoto" in raw

    def test_no_rompe_el_aplanado_normal(self):
        raw = self._provider()._flatten(
            {"uid": ["9610165"], "eduPersonAffiliation": ["staff", "alum", "member"]}
        )
        assert raw["uid"] == "9610165"
        assert raw["eduPersonAffiliation"] == ["staff", "alum", "member"]


ALUMNI = (
    '[{"name": "ldap-alumni", "base_dn": "ou=alumni,dc=ejemplo,dc=edu", '
    '"user_filter": "(eduPersonAffiliation=alum)", "priority": 35}]'
)


def con_ramas(branches, **kw):
    return settings(
        ldap_enabled=True,
        ldap_priority=30,
        ldap_host="ldap.ejemplo.edu",
        ldap_bind_dn="cn=reader",
        ldap_base_dn="ou=people,dc=ejemplo,dc=edu",
        ldap_user_filter="(eduPersonAffiliation=member)",
        ldap_id_attrs="uid,docNumber",
        ldap_branches=branches,
        **kw,
    )


class TestRamasLdap:
    """Un directorio servido en varias ramas (activos / egresados): cada una es
    una instancia con su base_dn y filtro, compartiendo host, bind y mapeo."""

    def test_sin_ramas_declaradas_solo_la_principal(self):
        ps = build_enabled_providers(con_ramas(""))
        assert [p.name for p in ps] == ["ldap"]

    def test_cada_rama_es_una_instancia(self):
        ps = build_enabled_providers(con_ramas(ALUMNI))
        assert [p.name for p in ps] == ["ldap", "ldap-alumni"]

    def test_la_rama_tiene_su_base_dn_y_filtro(self):
        alumni = build_enabled_providers(con_ramas(ALUMNI))[1]
        assert alumni.base_dn == "ou=alumni,dc=ejemplo,dc=edu"
        assert alumni.user_filter == "(eduPersonAffiliation=alum)"

    def test_la_rama_no_contamina_a_la_principal(self):
        principal = build_enabled_providers(con_ramas(ALUMNI))[0]
        assert principal.base_dn == "ou=people,dc=ejemplo,dc=edu"
        assert principal.user_filter == "(eduPersonAffiliation=member)"

    def test_la_rama_hereda_host_bind_y_credenciales(self):
        """Mismo directorio: no se duplica la config de conexión."""
        alumni = build_enabled_providers(con_ramas(ALUMNI))[1]
        assert alumni.host == "ldap.ejemplo.edu"
        assert alumni.bind_dn == "cn=reader"
        assert alumni.id_attrs == ["uid", "docNumber"]

    def test_las_ramas_comparten_el_namespace_del_person_key(self):
        """Clave: ambas ramas usan el mismo map_key, así la misma persona
        deriva el mismo person_key y colapsa a una fila del padrón en vez de
        duplicarse. Los nombres SÍ difieren, para trazar de qué rama vino."""
        principal, alumni = build_enabled_providers(con_ramas(ALUMNI))
        assert principal.map_key == alumni.map_key == "ldap"
        assert principal.name != alumni.name

    def test_la_rama_se_ordena_por_su_prioridad(self):
        """La afiliación activa debe ganar: la rama de egresados se consulta
        después de la principal."""
        ps = build_enabled_providers(con_ramas(ALUMNI, koha_db_enabled=True, koha_db_priority=40))
        assert [p.name for p in ps] == ["ldap", "ldap-alumni", "koha_db"]

    def test_las_ramas_no_se_construyen_si_ldap_esta_apagado(self):
        s = con_ramas(ALUMNI)
        s.ldap_enabled = False
        assert build_enabled_providers(s) == []


class TestRamasMalDeclaradas:
    """Una rama secundaria mal configurada no puede tumbar el arranque ni la
    rama principal: se ignora con warning."""

    def test_json_invalido_se_ignora(self):
        ps = build_enabled_providers(con_ramas("{no es json"))
        assert [p.name for p in ps] == ["ldap"]

    def test_json_que_no_es_lista_se_ignora(self):
        ps = build_enabled_providers(con_ramas('{"name": "x", "base_dn": "y"}'))
        assert [p.name for p in ps] == ["ldap"]

    def test_rama_sin_base_dn_se_ignora(self):
        ps = build_enabled_providers(con_ramas('[{"name": "ldap-alumni"}]'))
        assert [p.name for p in ps] == ["ldap"]

    def test_rama_sin_nombre_se_ignora(self):
        ps = build_enabled_providers(con_ramas('[{"base_dn": "ou=alumni,dc=x"}]'))
        assert [p.name for p in ps] == ["ldap"]

    def test_una_rama_invalida_no_anula_a_las_validas(self):
        ps = build_enabled_providers(
            con_ramas('[{"name": "rota"}, {"name": "ldap-alumni", "base_dn": "ou=alumni,dc=x"}]')
        )
        assert [p.name for p in ps] == ["ldap", "ldap-alumni"]


class TestUnidadOrganizativa:
    """El directorio publica el área del trabajador partida en dos: la persona
    trae un código en departmentNumber y el nombre vive en el árbol de
    organización. Sin juntarlos, un administrativo aparece sin área aunque el
    dato exista (2.332 personas medidas el 13-ago-2026).
    """

    CATALOGO = {"18": "Dirección de Tecnologías de Información", "13": "Dirección Financiera"}

    def _resolver(self, raw):
        LdapProvider._resolver_unidad(raw, self.CATALOGO)
        return raw

    def test_traduce_el_codigo_a_su_nombre(self):
        assert self._resolver({"departmentNumber": "18"})["_unidad"] == \
            "Dirección de Tecnologías de Información"

    def test_codigo_fuera_del_catalogo_no_produce_unidad(self):
        """Hueco de la fuente: 56 códigos usados no existen en el árbol. Mejor
        sin unidad que inventar una."""
        assert "_unidad" not in self._resolver({"departmentNumber": "9999"})

    def test_sin_atributo_no_produce_unidad(self):
        assert "_unidad" not in self._resolver({"uid": "1"})

    def test_multivalor_conserva_todas_las_reconocidas(self):
        """225 personas pertenecen a 2-3 unidades. Tratarlo como escalar perdía
        el dato entero: str(['18','13']) no casa con ningún código."""
        out = self._resolver({"departmentNumber": ["18", "13"]})
        assert sorted(out["_unidad"]) == ["Dirección Financiera",
                                          "Dirección de Tecnologías de Información"]

    def test_multivalor_descarta_solo_lo_desconocido(self):
        out = self._resolver({"departmentNumber": ["9999", "18"]})
        assert out["_unidad"] == "Dirección de Tecnologías de Información"

    def test_multivalor_todo_desconocido_no_produce_unidad(self):
        assert "_unidad" not in self._resolver({"departmentNumber": ["9999", "8888"]})

    def test_catalogo_vacio_no_produce_unidad(self):
        """Sin LDAP_ORG_BASE_DN configurado el catálogo llega vacío: se degrada
        al comportamiento previo, no se rompe."""
        raw = {"departmentNumber": "18"}
        LdapProvider._resolver_unidad(raw, {})
        assert "_unidad" not in raw
