"""Agrupación del script de fusión por credencial global (sin base de datos)."""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "fusion", Path(__file__).resolve().parents[1] / "scripts" / "fusionar_por_credencial_global.py")
fusion = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fusion)

FUENTE = {"ldap:A": "ldap", "koha:15922": "koha_db", "ldap:B": "ldap", "koha:777": "koha_db", "ldap:C": "ldap"}
PREC = ["ldap", "ldap-alumni", "koha_db"]


def test_une_por_valor_compartido_si_un_lado_es_global():
    creds = [("ldap:A", "unique_id", "15922"), ("ldap:A", "cardnumber", "9610165"),
             ("koha:15922", "cardnumber", "15922")]
    assert fusion.agrupar(creds, {"unique_id"}, FUENTE) == [["koha:15922", "ldap:A"]]


def test_dos_carnes_locales_iguales_no_unen_a_nadie():
    creds = [("ldap:B", "cardnumber", "777"), ("koha:777", "cardnumber", "777")]
    assert fusion.agrupar(creds, {"unique_id", "document_number"}, FUENTE) == []


def test_superviviente_es_la_fuente_con_mas_autoridad():
    assert fusion.ordenar(["koha:15922", "ldap:A"], FUENTE, PREC)[0] == "ldap:A"


def test_dos_filas_del_directorio_con_el_mismo_valor_es_dudoso():
    creds = [("ldap:B", "unique_id", "500"), ("ldap:C", "unique_id", "500"), ("koha:777", "cardnumber", "500")]
    [g] = fusion.agrupar(creds, {"unique_id"}, FUENTE)
    assert fusion.dudoso(g, FUENTE, PREC) is True
    assert fusion.dudoso(["koha:15922", "ldap:A"], FUENTE, PREC) is False
