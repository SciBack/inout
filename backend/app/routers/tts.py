import asyncio
import io
import wave
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..config import settings

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
# Motor: Piper (voz neuronal, local). Primero fue espeak-ng: sonaba «de
# ultratumba». Piper corre dentro del contenedor, así que los nombres de quien
# entra no salen a ningún servicio externo. La voz es un modelo .onnx que se
# descarga al construir la imagen (Dockerfile, TTS_VOICE).

_MAX_CHARS = 120          # los saludos son "Bienvenida, Steisy Azumi"; nada largo

# Los textos se repiten (los mismos nombres cada día): se guardan los últimos.
_CACHE_MAX = 500
_cache: "OrderedDict[str, bytes]" = OrderedDict()

_voz = None               # PiperVoice, cargada en el primer uso (~60 MB)


def _cargar_voz():
    global _voz
    if _voz is None:
        from piper import PiperVoice

        modelo = Path(settings.tts_voice_dir) / f"{settings.tts_voice}.onnx"
        _voz = PiperVoice.load(str(modelo))
    return _voz


def _sintetizar_sync(texto: str) -> bytes:
    from piper import SynthesisConfig

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        _cargar_voz().synthesize_wav(
            texto, wf, syn_config=SynthesisConfig(length_scale=settings.tts_length_scale)
        )
    return buf.getvalue()


async def _sintetizar(texto: str) -> bytes:
    loop = asyncio.get_running_loop()
    audio = await asyncio.wait_for(
        loop.run_in_executor(None, _sintetizar_sync, texto), timeout=10
    )
    if not audio:
        raise RuntimeError("Piper no generó audio")
    return audio


@router.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=_MAX_CHARS)):
    texto = " ".join(text.split())
    if not texto:
        raise HTTPException(status_code=400, detail="texto vacío")

    audio = _cache.get(texto)
    if audio is None:
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
