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

    monkeypatch.setattr(tts_mod.shutil, "which", lambda _: "/usr/bin/espeak-ng")
    monkeypatch.setattr(tts_mod, "_sintetizar", sintetizar)

    r1 = asyncio.run(tts_mod.tts(text="Bienvenida,   Steisy"))
    r2 = asyncio.run(tts_mod.tts(text="Bienvenida, Steisy"))

    assert r1.body == r2.body == b"RIFF-wav"
    assert r1.media_type == "audio/wav"
    assert llamadas == ["Bienvenida, Steisy"]


def test_sin_motor_de_voz_responde_503(monkeypatch):
    monkeypatch.setattr(tts_mod.shutil, "which", lambda _: None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(tts_mod.tts(text="Hasta luego"))
    assert e.value.status_code == 503
