"""Registro de proveedores (providers.py).

El canónico arranca agnóstico: sin config no hay ninguna fuente habilitada y el
sistema degrada a "Sin identificar" en vez de romper.
"""

from app.config import Settings
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
