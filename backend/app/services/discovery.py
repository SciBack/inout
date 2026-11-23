"""Aviso a Discovery de cada marca del torniquete (ADR-004 § 8 y § 10 de Discovery).

Discovery vive en internet y no alcanza a InOut (red interna); por eso InOut le avisa: cada entrada o
salida, las salidas forzadas del cierre y un latido cada minuto (así Discovery sabe que InOut está
vivo aunque nadie pase). El cuerpo va firmado (HMAC-SHA256 con un secreto compartido).

Solo viaja lo necesario: correo institucional, entrada o salida, hora, espacio y si fue forzada; y los códigos
de la persona (código universitario y número de carné, nunca el DNI), porque hay quien no tiene correo en el
padrón: sin ellos su marca no llegaba y Discovery lo daba por fuera del CRAI (23-nov-2026). Discovery guarda
solo un resumen (HMAC) de cada clave.
Nunca bloquea ni hace fallar el escaneo: se envía en un hilo aparte y los errores solo se registran.
Una marca que no llega (Discovery reiniciándose, sin red) queda pendiente y se reenvía con el siguiente latido
que sí llegue (23-nov-2026: una entrada se perdió mientras se recreaba Discovery). Discovery no pisa una marca
más nueva con una atrasada.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from collections import deque
from datetime import datetime

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


# Marcas que no llegaron, en orden. En memoria: si InOut se reinicia, al arrancar reenvía a quienes están dentro.
_pendientes: deque[dict] = deque(maxlen=5000)
_candado = threading.Lock()


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
    if _post(cuerpo):
        if cuerpo.get("evento") == "latido":
            reenviar_pendientes()
    elif cuerpo.get("evento") != "latido":
        with _candado:
            _pendientes.append(cuerpo)


def reenviar_pendientes() -> int:
    """Reenvía en orden las marcas que no llegaron; se detiene en la primera que vuelve a fallar."""
    enviadas = 0
    while True:
        with _candado:
            if not _pendientes:
                break
            cuerpo = _pendientes[0]
        if not _post(cuerpo):
            break
        with _candado:
            if _pendientes and _pendientes[0] is cuerpo:
                _pendientes.popleft()
        enviadas += 1
    if enviadas:
        logger.info("[discovery] marcas pendientes reenviadas: %d", enviadas)
    return enviadas


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


def avisar_marca(correo: str | None, evento: str, momento: datetime, espacio: str | None,
                 forzada: bool = False, en_hilo: bool = True, codigos: list[str] | None = None) -> None:
    correo = correo.strip().lower() if correo and "@" in correo else None
    codigos = sorted({c.strip() for c in (codigos or []) if c and c.strip()})
    if not correo and not codigos:
        return   # ni correo ni código: no hay a quién asociar la marca en Discovery
    cuerpo = {"correo": correo, "evento": evento, "momento": momento.isoformat(), "espacio": espacio, "forzada": forzada}
    if codigos:
        cuerpo["codigos"] = codigos
    avisar(cuerpo, en_hilo)


def latido() -> None:
    avisar({"evento": "latido"}, en_hilo=False)
