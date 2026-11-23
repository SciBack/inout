"""Aviso a Discovery de cada marca del torniquete (ADR-004 § 8 y § 10 de Discovery).

Discovery vive en internet y no alcanza a InOut (red interna); por eso InOut le avisa: cada entrada o
salida, las salidas forzadas del cierre y un latido cada minuto (así Discovery sabe que InOut está
vivo aunque nadie pase). El cuerpo va firmado (HMAC-SHA256 con un secreto compartido).

Solo viaja lo necesario: correo institucional, entrada o salida, hora, espacio y si fue forzada; y los códigos
de la persona (código universitario y número de carné, nunca el DNI), porque hay quien no tiene correo en el
padrón: sin ellos su marca no llegaba y Discovery lo daba por fuera del CRAI (23-nov-2026). Discovery guarda
solo un resumen (HMAC) de cada clave.
Nunca bloquea ni hace fallar el escaneo: se envía en un hilo aparte y los errores solo se registran.
Las marcas salen de presence_log, en orden, y en la base queda hasta cuál llegó (tabla discovery_envio): si
Discovery se reinicia o no hay red, se reintenta con cada latido; si InOut se reinicia, sigue donde quedó
(23-nov-2026: una entrada se perdió mientras se recreaba Discovery). Discovery no pisa una marca más nueva con
una atrasada. Solo viajan las marcas del día.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func

from ..config import settings

logger = logging.getLogger(__name__)


LIMA = ZoneInfo("America/Lima")
_candado = threading.Lock()        # un solo envío a la vez (un proceso uvicorn)
_otra_vez = threading.Event()      # llegó una marca mientras se enviaba: dar otra vuelta


def _post(cuerpo: dict) -> bool:
    """True si Discovery la recibió. Un 4xx (firma, marca incompleta) no se reintenta: repetirla no lo arregla."""
    datos = json.dumps(cuerpo, separators=(",", ":"), ensure_ascii=False).encode()
    firma = hmac.new(settings.discovery_webhook_secreto.encode(), datos, hashlib.sha256).hexdigest()
    try:
        r = httpx.post(settings.discovery_webhook_url, content=datos, timeout=4,
                       headers={"Content-Type": "application/json", "X-InOut-Firma": firma})
    except httpx.HTTPError as e:
        logger.warning("[discovery] sin conexión (%s): %s", cuerpo.get("evento"), e)
        return False
    if r.status_code >= 300:
        logger.warning("[discovery] respuesta %s a %s", r.status_code, cuerpo.get("evento"))
    return r.status_code < 500


def _enviar(cuerpo: dict) -> None:
    if _post(cuerpo) and cuerpo.get("evento") == "latido":
        sincronizar()   # Discovery responde: se manda lo que haya quedado pendiente


def iniciar(fabrica=None) -> None:
    """Al arrancar: si nunca se sincronizó, se empieza desde la última marca (no se reenvía la historia)."""
    from ..database import SessionLocal
    from ..models import EnvioDiscovery, PresenceLog
    db = (fabrica or SessionLocal)()
    try:
        if db.get(EnvioDiscovery, 1) is None:
            db.add(EnvioDiscovery(id=1, ultimo_id=db.query(func.max(PresenceLog.id)).scalar() or 0))
            db.commit()
    finally:
        db.close()


def _forzada(fila) -> bool:
    """La salida del cierre automático se registra a la hora exacta del cierre; un escaneo nunca cae justo ahí."""
    ts = fila.timestamp
    return fila.event_type == "exit" and not fila.client_event_id and ts.second == 0 and ts.microsecond == 0


def sincronizar(fabrica=None, lote: int = 500) -> int:
    """Envía en orden las marcas que Discovery aún no recibió y avanza el punto guardado. Se detiene en la
    primera que no llega: se reintenta con el próximo escaneo o latido. Devuelve cuántas envió."""
    if not activo():
        return 0
    if not _candado.acquire(blocking=False):
        _otra_vez.set()
        return 0
    total = 0
    try:
        while True:
            _otra_vez.clear()
            n, seguir = _una_vuelta(fabrica, lote)
            total += n
            if not seguir and not _otra_vez.is_set():
                break
    finally:
        _candado.release()
    return total


def _una_vuelta(fabrica, lote: int) -> tuple[int, bool]:
    from ..database import SessionLocal
    from ..models import EnvioDiscovery, Person, PresenceLog, Space
    db = (fabrica or SessionLocal)()
    try:
        punto = db.get(EnvioDiscovery, 1)
        if punto is None:
            return 0, False
        filas = (db.query(PresenceLog).filter(PresenceLog.id > punto.ultimo_id)
                 .order_by(PresenceLog.id).limit(lote).all())
        if not filas:
            return 0, False
        claves = list({f.person_key for f in filas if f.person_key})
        correos = dict(db.query(Person.person_key, Person.email).filter(Person.person_key.in_(claves)).all()) if claves else {}
        codigos = codigos_de(db, claves)
        espacios = dict(db.query(Space.id, Space.name).all())
        hoy = datetime.now(LIMA).date()
        enviadas, completo = 0, True
        for f in filas:
            ts = f.timestamp if f.timestamp.tzinfo else f.timestamp.replace(tzinfo=LIMA)
            cuerpo = _cuerpo(correos.get(f.person_key), f.event_type, ts, espacios.get(f.space_id),
                             _forzada(f), codigos.get(f.person_key)) \
                if f.person_key and ts.astimezone(LIMA).date() == hoy else None
            if cuerpo:
                if not _post(cuerpo):
                    completo = False
                    break
                enviadas += 1
            punto.ultimo_id = f.id
        db.commit()
        if enviadas:
            logger.info("[discovery] marcas enviadas: %d", enviadas)
        return enviadas, completo and len(filas) == lote
    finally:
        db.close()


def avisar_ahora() -> None:
    """Tras guardar una marca: envía lo pendiente en un hilo, sin demorar el escaneo."""
    if activo():
        threading.Thread(target=sincronizar, daemon=True).start()


def activo() -> bool:
    return bool(settings.discovery_webhook_url and settings.discovery_webhook_secreto)


def avisar(cuerpo: dict, en_hilo: bool = True) -> None:
    if not activo():
        return
    if en_hilo:
        threading.Thread(target=_enviar, args=(cuerpo,), daemon=True).start()
    else:
        _enviar(cuerpo)


# Credenciales que Discovery usa como clave de quien no tiene correo (su código en Koha). El DNI no viaja.
TIPOS_CODIGO = ("cardnumber", "unique_id")


def codigos_de(db, person_keys) -> dict[str, list[str]]:
    """person_key → sus códigos (código universitario, número de carné) del índice de credenciales."""
    from ..models import PersonIdentifier
    claves = [k for k in person_keys if k]
    if not claves:
        return {}
    out: dict[str, list[str]] = {}
    for clave, valor in (db.query(PersonIdentifier.person_key, PersonIdentifier.id_value)
                         .filter(PersonIdentifier.person_key.in_(claves), PersonIdentifier.id_type.in_(TIPOS_CODIGO))
                         .all()):
        out.setdefault(clave, []).append(valor)
    return out


def _cuerpo(correo: str | None, evento: str, momento: datetime, espacio: str | None, forzada: bool = False,
            codigos: list[str] | None = None) -> dict | None:
    correo = correo.strip().lower() if correo and "@" in correo else None
    codigos = sorted({c.strip() for c in (codigos or []) if c and c.strip()})
    if not correo and not codigos:
        return None   # ni correo ni código: no hay a quién asociar la marca en Discovery
    cuerpo = {"correo": correo, "evento": evento, "momento": momento.isoformat(), "espacio": espacio, "forzada": forzada}
    if codigos:
        cuerpo["codigos"] = codigos
    return cuerpo


def avisar_marca(correo: str | None, evento: str, momento: datetime, espacio: str | None,
                 forzada: bool = False, en_hilo: bool = True, codigos: list[str] | None = None) -> None:
    """Envío directo de una marca (al arrancar, quienes están dentro). Las del torniquete van por sincronizar()."""
    cuerpo = _cuerpo(correo, evento, momento, espacio, forzada, codigos)
    if cuerpo:
        avisar(cuerpo, en_hilo)


def latido() -> None:
    avisar({"evento": "latido"}, en_hilo=False)
