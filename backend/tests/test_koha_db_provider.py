"""KohaDbProvider por biblioteca (library_code).

UPeU tiene 4 bibliotecas Koha distintas (BUL y CIA en el campus Lima, BUT en
Tarapoto, BUJ en Juliaca) — no 4 campus. Bug real (2026-07-18): scan.py pasaba
el código de SEDE (LIMA/JULIACA/TARAPOTO) a koha_db_for_sede, que solo declara
overrides por BIBLIOTECA (koha_but_*, koha_buj_*, koha_cia_*) → Tarapoto y
Juliaca siempre consultaban la BD global (BUL, Lima), nunca la propia.

Medido contra las 3 BDs reales: hay carnés que se repiten entre bibliotecas
para personas DISTINTAS (no solo variantes de tilde de la misma persona). Por
eso una rama con library_code debe rehusarse a responder si el código de
enrutamiento pide otra biblioteca — evita conectar a la BD equivocada y, más
importante, evita que un carné ajeno resuelva por coincidencia.
"""

import asyncio

import pytest

from app.config import Settings
from app.services.identity.koha_db_provider import KohaDbProvider


def provider(branch=None, **kw):
    cfg = Settings(koha_db_enabled=True, koha_db_host="host-global", koha_db_name="koha_bul", **kw)
    return KohaDbProvider(cfg, branch=branch)


class TestInstanciaPorDefecto:
    """Sin branch: compatibilidad histórica, responde a cualquier código."""

    def test_nombre_por_defecto(self):
        assert provider().name == "koha_db"
        assert provider().library_code is None

    def test_lookup_procede_sin_importar_el_codigo(self, monkeypatch):
        p = provider()
        llamado = {}

        def fake_connect(sede_code):
            llamado["sede_code"] = sede_code
            return None  # sin conexión real, solo probamos que se INTENTÓ

        monkeypatch.setattr(p, "_connect", fake_connect)
        asyncio.run(p.lookup("cardnumber", "1", sede_code="BUT"))
        assert llamado["sede_code"] == "BUT"

    def test_fetch_all_usa_config_global(self, monkeypatch):
        p = provider()
        llamado = {}

        def fake_connect(sede_code):
            llamado["sede_code"] = sede_code
            return None

        monkeypatch.setattr(p, "_connect", fake_connect)
        asyncio.run(p.fetch_all())
        assert llamado["sede_code"] == ""


class TestRamaPorBiblioteca:
    def test_nombre_y_codigo_de_la_rama(self):
        p = provider(branch={"name": "koha_db_but", "library_code": "BUT"})
        assert p.name == "koha_db_but"
        assert p.library_code == "BUT"

    def test_rehusa_responder_a_otra_biblioteca(self, monkeypatch):
        """El caso que motivó el fix: un escaneo en Juliaca (BUJ) no debe ni
        conectar a la BD de Tarapoto (BUT).

        OJO: lookup() atrapa CUALQUIER excepción a propósito (el escaneo no
        debe tumbarse). Por eso NO se puede probar "no debió llamarse" con una
        excepción dentro de _connect — quedaría indistinguible de un fallo real
        y el resultado sería None de todos modos, enmascarando el gating roto.
        Se usa una bandera mutable en su lugar."""
        p = provider(branch={"name": "koha_db_but", "library_code": "BUT"})
        llamado = {"conectó": False}

        def _no_deberia_llamarse(sede_code):
            llamado["conectó"] = True
            return None

        monkeypatch.setattr(p, "_connect", _no_deberia_llamarse)
        result = asyncio.run(p.lookup("cardnumber", "202211258", sede_code="BUJ"))
        assert result is None
        assert llamado["conectó"] is False, "el gating no bloqueó la conexión a otra biblioteca"

    def test_responde_a_su_propia_biblioteca(self, monkeypatch):
        p = provider(branch={"name": "koha_db_but", "library_code": "BUT"})
        llamado = {}

        def fake_connect(sede_code):
            llamado["ok"] = True
            return None

        monkeypatch.setattr(p, "_connect", fake_connect)
        asyncio.run(p.lookup("cardnumber", "1", sede_code="BUT"))
        assert llamado.get("ok") is True

    def test_sin_codigo_de_enrutamiento_procede(self, monkeypatch):
        """Producto agnóstico / caller que no sabe la biblioteca: no se puede
        gatear sin dato, así que se intenta (comportamiento histórico)."""
        p = provider(branch={"name": "koha_db_cia", "library_code": "CIA"})
        llamado = {}
        monkeypatch.setattr(p, "_connect", lambda sede_code: llamado.setdefault("ok", True))
        asyncio.run(p.lookup("cardnumber", "1", sede_code=""))
        assert llamado.get("ok") is True

    def test_fetch_all_conecta_a_su_propia_biblioteca(self, monkeypatch):
        p = provider(branch={"name": "koha_db_buj", "library_code": "BUJ"})
        llamado = {}

        def fake_connect(sede_code):
            llamado["sede_code"] = sede_code
            return None

        monkeypatch.setattr(p, "_connect", fake_connect)
        asyncio.run(p.fetch_all())
        assert llamado["sede_code"] == "BUJ"


class TestConnectResuelveLaBibliotecaCorrecta:
    """_connect debe preferir el library_code de LA RAMA sobre el que llegue
    por parámetro — la rama sabe mejor a qué biblioteca pertenece."""

    def test_ignora_el_sede_code_del_llamador_si_tiene_su_propio_codigo(self):
        cfg = Settings(
            koha_db_enabled=True,
            koha_db_host="host-bul", koha_db_name="koha_bul",
            koha_but_db_host="host-but", koha_but_db_name="koha_but",
        )
        p = KohaDbProvider(cfg, branch={"name": "koha_db_but", "library_code": "BUT"})
        host, user, pw, name = cfg.koha_db_for_sede(p.library_code or "otra-cosa")
        assert name == "koha_but"
