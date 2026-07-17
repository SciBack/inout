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
