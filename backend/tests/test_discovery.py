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


def _escenario(db, monkeypatch, codigo=502):
    """Un espacio, Ana (con correo) y Beto (sin correo, con código), y un Discovery que responde `codigo`."""
    from sqlalchemy.orm import sessionmaker
    from app.models import Person, PersonIdentifier, Space
    _config(monkeypatch)
    db.add(Space(id=1, name="CRAI Lima", capacity=100))
    db.add(Person(person_key="ldap:1", email="ana@upeu.edu.pe"))
    db.add(Person(person_key="ldap:2"))
    db.add(PersonIdentifier(id_type="cardnumber", id_value="202410354", person_key="ldap:2"))
    db.commit()
    estado = {"codigo": codigo, "recibidas": []}

    def post(url, content, timeout, headers):
        if estado["codigo"] == 200:
            estado["recibidas"].append(json.loads(content))
        return httpx.Response(estado["codigo"])

    monkeypatch.setattr(discovery.httpx, "post", post)
    return sessionmaker(bind=db.get_bind()), estado


def _marca(db, clave, evento, ts):
    from app.models import PresenceLog
    db.add(PresenceLog(cardnumber="x", person_key=clave, event_type=evento, space_id=1, timestamp=ts))
    db.commit()


def test_marcas_salen_de_la_tabla_en_orden_y_sin_perderse(db, monkeypatch):
    """23-nov-2026: una entrada se perdió mientras Discovery se recreaba (502). Ahora salen de presence_log y en
    la base queda hasta cuál llegó: si Discovery no responde, se reintenta; si InOut se reinicia, sigue donde quedó."""
    fabrica, estado = _escenario(db, monkeypatch)
    discovery.iniciar(fabrica)                         # primera vez: desde la última marca, sin historia
    ahora = datetime.now(discovery.LIMA).replace(microsecond=123)
    _marca(db, "ldap:1", "entry", ahora)
    _marca(db, "ldap:2", "entry", ahora)
    _marca(db, None, "entry", ahora)                   # no identificado: no viaja
    assert discovery.sincronizar(fabrica) == 0         # Discovery caído: nada se marca como enviado
    estado["codigo"] = 200
    discovery.iniciar(fabrica)                         # «InOut se reinicia»: el punto guardado no cambia
    assert discovery.sincronizar(fabrica) == 2
    assert [(c["correo"], c.get("codigos"), c["evento"]) for c in estado["recibidas"]] == [
        ("ana@upeu.edu.pe", None, "entry"), (None, ["202410354"], "entry")]
    assert discovery.sincronizar(fabrica) == 0         # no se repiten


def test_salida_del_cierre_viaja_como_forzada_y_las_de_otro_dia_no(db, monkeypatch):
    from datetime import timedelta
    fabrica, estado = _escenario(db, monkeypatch, codigo=200)
    discovery.iniciar(fabrica)
    hoy = datetime.now(discovery.LIMA)
    _marca(db, "ldap:1", "entry", hoy - timedelta(days=1))
    _marca(db, "ldap:1", "exit", hoy.replace(second=0, microsecond=0))
    assert discovery.sincronizar(fabrica) == 1
    assert estado["recibidas"][0]["evento"] == "exit" and estado["recibidas"][0]["forzada"] is True


def test_rechazo_de_discovery_no_se_reintenta(db, monkeypatch):
    fabrica, estado = _escenario(db, monkeypatch, codigo=422)
    discovery.iniciar(fabrica)
    _marca(db, "ldap:1", "entry", datetime.now(discovery.LIMA).replace(microsecond=5))
    discovery.sincronizar(fabrica)
    from app.models import EnvioDiscovery, PresenceLog
    assert db.get(EnvioDiscovery, 1).ultimo_id == db.query(PresenceLog).one().id
