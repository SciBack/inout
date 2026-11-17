"""Búsqueda en vivo en LDAP con plantillas por atributo (lookup_templates)."""

import asyncio
from types import SimpleNamespace

from app.services.identity.ldap_provider import LdapProvider


def _proveedor(id_attrs):
    cfg = SimpleNamespace(
        ldap_enabled=True, ldap_host="ldap://x", ldap_port=389, ldap_use_ssl=False,
        ldap_bind_dn="", ldap_bind_pass="", ldap_raw_exclude="", ldap_base_dn="dc=x", ldap_user_filter="(objectClass=person)",
        ldap_id_attrs=id_attrs, ldap_page_size=100, ldap_priority=10,
    )
    return LdapProvider(cfg)


def test_plantilla_arma_el_valor_como_lo_guarda_el_directorio(identity_map, monkeypatch):
    identity_map({"ldap": {"lookup_templates": {"eduPersonUniqueId": "{valor}@inst.edu"}}})
    p = _proveedor("uid,eduPersonUniqueId")
    vistos = []
    monkeypatch.setattr(p, "_search", lambda f: vistos.append(f) or [])
    asyncio.run(p.lookup("cardnumber", "12345"))
    assert vistos == ["(&(objectClass=person)(|(uid=12345)(eduPersonUniqueId=12345@inst.edu)))"]


def test_sin_plantilla_el_valor_va_tal_cual(identity_map, monkeypatch):
    identity_map({"ldap": {}})
    p = _proveedor("uid")
    vistos = []
    monkeypatch.setattr(p, "_search", lambda f: vistos.append(f) or [])
    asyncio.run(p.lookup("cardnumber", "12345"))
    assert vistos == ["(&(objectClass=person)(uid=12345))"]
