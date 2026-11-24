import asyncio
import shutil
from collections import OrderedDict

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter()

# Saludo hablado generado en el SERVIDOR.
#
# El kiosko habla con la voz del navegador (speechSynthesis) cuando el equipo
# tiene voces. Un Firefox de Linux sin speech-dispatcher no tiene ninguna y se
# queda mudo sin dar error, aunque el equipo suene perfectamente con YouTube
# (24-nov-2026: los terminales del CRAI). Para esos el kiosko pide aquí el audio
# y lo reproduce como cualquier otro sonido: no depende de lo que tenga
# instalado el terminal.
#
# Motor: espeak-ng, dentro de la imagen. Suena sintético; cambiarlo por una voz
# natural es cambiar _sintetizar, el contrato (texto → WAV) no cambia.

_MAX_CHARS = 120          # los saludos son "Bienvenida, Steisy Azumi"; nada largo
_VOZ = "es-419"           # español latinoamericano
_VELOCIDAD = "165"        # palabras por minuto (espeak-ng por defecto: 175)

# Los textos se repiten (los mismos nombres cada día): se guardan los últimos.
_CACHE_MAX = 500
_cache: "OrderedDict[str, bytes]" = OrderedDict()


async def _sintetizar(texto: str) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "espeak-ng", "-v", _VOZ, "-s", _VELOCIDAD, "--stdout", texto,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    audio, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
    if proc.returncode != 0 or not audio:
        raise RuntimeError("espeak-ng no generó audio")
    return audio


@router.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=_MAX_CHARS)):
    texto = " ".join(text.split())
    if not texto:
        raise HTTPException(status_code=400, detail="texto vacío")

    audio = _cache.get(texto)
    if audio is None:
        if shutil.which("espeak-ng") is None:
            raise HTTPException(status_code=503, detail="sin motor de voz")
        try:
            audio = await _sintetizar(texto)
        except Exception:
            raise HTTPException(status_code=503, detail="no se pudo generar la voz")
        _cache[texto] = audio
        if len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    else:
        _cache.move_to_end(texto)

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=86400"},
    )
