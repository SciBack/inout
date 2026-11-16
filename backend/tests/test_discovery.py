"""Aviso de marcas a Discovery: firma, contenido mínimo y que nunca rompa el escaneo."""

import hashlib
import hmac
import json
from datetime import datetime, timezone

import httpx

from app.services import discovery


def _config(monkeypatch):
    monkeypatch.setattr(discovery.settings, "discovery_webhook_url", "https://discovery.test/mi/api/interno/inout")
    monkeypatch.setattr(discovery.settings, "discovery_webhook_secreto", "s3creto")


def test_marca_firmada_y_minima(monkeypatch):
    _config(monkeypatch)
    enviado = {}

    def post(url, content, timeout, headers):
        enviado.update(url=url, cuerpo=content, firma=headers["X-InOut-Firma"])
        return httpx.Response(200)

    monkeypatch.setattr(discovery.httpx, "post", post)
    discovery.avisar_marca("Ana@UPeU.edu.pe", "entry", datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc),
                           "CRAI Lima", en_hilo=False)
    datos = json.loads(enviado["cuerpo"])
    assert datos == {"correo": "ana@upeu.edu.pe", "evento": "entry", "momento": "2026-11-16T15:00:00+00:00",
                     "espacio": "CRAI Lima", "forzada": False}
    assert enviado["firma"] == hmac.new(b"s3creto", enviado["cuerpo"], hashlib.sha256).hexdigest()


def test_sin_correo_o_sin_config_no_envia(monkeypatch):
    llamadas = []
    monkeypatch.setattr(discovery.httpx, "post", lambda *a, **k: llamadas.append(1))
    monkeypatch.setattr(discovery.settings, "discovery_webhook_url", "")
    discovery.avisar_marca("ana@upeu.edu.pe", "entry", datetime.now(timezone.utc), None, en_hilo=False)
    _config(monkeypatch)
    discovery.avisar_marca(None, "entry", datetime.now(timezone.utc), None, en_hilo=False)
    assert llamadas == []


def test_discovery_caido_no_rompe(monkeypatch):
    _config(monkeypatch)

    def post(*a, **k):
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(discovery.httpx, "post", post)
    discovery.latido()   # no lanza
