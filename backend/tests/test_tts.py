import asyncio

import pytest
from fastapi import HTTPException

from app.routers import tts as tts_mod


@pytest.fixture(autouse=True)
def cache_limpia():
    tts_mod._cache.clear()
    yield
    tts_mod._cache.clear()


def test_genera_una_vez_y_reutiliza(monkeypatch):
    llamadas = []

    async def sintetizar(texto):
        llamadas.append(texto)
        return b"RIFF-wav"

    monkeypatch.setattr(tts_mod, "_sintetizar", sintetizar)

    r1 = asyncio.run(tts_mod.tts(text="Bienvenida,   Steisy"))
    r2 = asyncio.run(tts_mod.tts(text="Bienvenida, Steisy"))

    assert r1.body == r2.body == b"RIFF-wav"
    assert r1.media_type == "audio/wav"
    assert llamadas == ["Bienvenida, Steisy"]


def test_fallo_del_motor_responde_503(monkeypatch):
    async def sintetizar(texto):
        raise RuntimeError("sin modelo")

    monkeypatch.setattr(tts_mod, "_sintetizar", sintetizar)
    with pytest.raises(HTTPException) as e:
        asyncio.run(tts_mod.tts(text="Hasta luego"))
    assert e.value.status_code == 503


def test_piper_real_genera_wav():
    # Usa el modelo de la imagen; fuera de ella (sin /app/voices) se omite.
    from pathlib import Path
    from app.config import settings
    if not (Path(settings.tts_voice_dir) / f"{settings.tts_voice}.onnx").exists():
        pytest.skip("modelo de voz no instalado")
    audio = asyncio.run(tts_mod._sintetizar("Bienvenida, Steisy"))
    assert audio[:4] == b"RIFF" and len(audio) > 10_000
