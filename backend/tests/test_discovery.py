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


def test_sin_correo_avisa_por_sus_codigos(monkeypatch):
    """Quien no tiene correo en el padrón también llega a Discovery, por su código (23-nov-2026)."""
    _config(monkeypatch)
    enviado = {}
    monkeypatch.setattr(discovery.httpx, "post",
                        lambda url, content, timeout, headers: enviado.update(cuerpo=content) or httpx.Response(200))
    discovery.avisar_marca(None, "entry", datetime(2026, 11, 23, 15, 40, tzinfo=timezone.utc), "CRAI Lima",
                           en_hilo=False, codigos=["91133", "202410300", " ", "91133"])
    datos = json.loads(enviado["cuerpo"])
    assert datos["correo"] is None and datos["codigos"] == ["202410300", "91133"] and datos["evento"] == "entry"


def test_codigos_de_no_incluye_el_dni(db):
    from app.models import PersonIdentifier
    for tipo, valor in (("cardnumber", "202410300"), ("cardnumber", "91133"), ("unique_id", "91133"),
                        ("document_number", "60803440")):
        db.add(PersonIdentifier(id_type=tipo, id_value=valor, person_key="ldap:1"))
    db.commit()
    assert sorted(set(discovery.codigos_de(db, ["ldap:1"])["ldap:1"])) == ["202410300", "91133"]


def test_marca_que_no_llega_se_reenvia_con_el_latido(monkeypatch):
    """23-nov-2026: una entrada se perdió mientras Discovery se recreaba (502). Queda pendiente y sale con
    el siguiente latido que llegue, en orden."""
    _config(monkeypatch)
    discovery._pendientes.clear()
    estado = {"codigo": 502}
    recibidas = []

    def post(url, content, timeout, headers):
        cuerpo = json.loads(content)
        if estado["codigo"] == 200:
            recibidas.append(cuerpo["evento"])
        return httpx.Response(estado["codigo"])

    monkeypatch.setattr(discovery.httpx, "post", post)
    ahora = datetime.now(timezone.utc)
    discovery.avisar_marca("ana@upeu.edu.pe", "entry", ahora, None, en_hilo=False)
    discovery.avisar_marca("ana@upeu.edu.pe", "exit", ahora, None, en_hilo=False)
    discovery.latido()                      # Discovery sigue caído: nada se pierde
    assert len(discovery._pendientes) == 2 and recibidas == []
    estado["codigo"] = 200
    discovery.latido()
    assert recibidas == ["latido", "entry", "exit"] and not discovery._pendientes


def test_rechazo_de_discovery_no_se_reintenta(monkeypatch):
    _config(monkeypatch)
    discovery._pendientes.clear()
    monkeypatch.setattr(discovery.httpx, "post", lambda *a, **k: httpx.Response(422))
    discovery.avisar_marca("ana@upeu.edu.pe", "entry", datetime.now(timezone.utc), None, en_hilo=False)
    assert not discovery._pendientes
