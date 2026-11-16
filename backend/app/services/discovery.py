"""Aviso a Discovery de cada marca del torniquete (ADR-004 § 8 y § 10 de Discovery).

Discovery vive en internet y no alcanza a InOut (red interna); por eso InOut le avisa: cada entrada o
salida, las salidas forzadas del cierre y un latido cada minuto (así Discovery sabe que InOut está
vivo aunque nadie pase). El cuerpo va firmado (HMAC-SHA256 con un secreto compartido).

Solo viaja lo necesario: correo institucional, entrada o salida, hora, espacio y si fue forzada.
Nunca bloquea ni hace fallar el escaneo: se envía en un hilo aparte y los errores solo se registran.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from datetime import datetime

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


def _enviar(cuerpo: dict) -> None:
    datos = json.dumps(cuerpo, separators=(",", ":"), ensure_ascii=False).encode()
    firma = hmac.new(settings.discovery_webhook_secreto.encode(), datos, hashlib.sha256).hexdigest()
    try:
        r = httpx.post(settings.discovery_webhook_url, content=datos, timeout=4,
                       headers={"Content-Type": "application/json", "X-InOut-Firma": firma})
        if r.status_code >= 300:
            logger.warning("[discovery] respuesta %s a %s", r.status_code, cuerpo.get("evento"))
    except httpx.HTTPError as e:
        logger.warning("[discovery] sin conexión (%s): %s", cuerpo.get("evento"), e)


def activo() -> bool:
    return bool(settings.discovery_webhook_url and settings.discovery_webhook_secreto)


def avisar(cuerpo: dict, en_hilo: bool = True) -> None:
    if not activo():
        return
    if en_hilo:
        threading.Thread(target=_enviar, args=(cuerpo,), daemon=True).start()
    else:
        _enviar(cuerpo)


def avisar_marca(correo: str | None, evento: str, momento: datetime, espacio: str | None,
                 forzada: bool = False, en_hilo: bool = True) -> None:
    if not correo or "@" not in correo:
        return   # sin correo no hay a quién asociar la marca en Discovery
    avisar({"correo": correo.strip().lower(), "evento": evento, "momento": momento.isoformat(),
            "espacio": espacio, "forzada": forzada}, en_hilo)


def latido() -> None:
    avisar({"evento": "latido"}, en_hilo=False)
