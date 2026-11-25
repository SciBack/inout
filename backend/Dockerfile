FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Voz del saludo para kioskos cuyo navegador no tiene voces (routers/tts.py).
# Modelo Piper de rhasspy/piper-voices; el nombre debe coincidir con tts_voice.
ARG TTS_VOICE_PATH=es/es_MX/claude/high/es_MX-claude-high
RUN mkdir -p /app/voices && python -c "import sys, urllib.request; p = sys.argv[1]; n = p.rsplit('/', 1)[-1]; [urllib.request.urlretrieve('https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/' + p + e, '/app/voices/' + n + e) for e in ('.onnx', '.onnx.json')]" "$TTS_VOICE_PATH"

COPY app/ ./app/
# Herramientas de mantenimiento del padrón (reparaciones puntuales, backfills).
# Van en la imagen porque se ejecutan CONTRA la base de producción y necesitan
# la misma configuración y el mismo código que el servicio.
COPY scripts/ ./scripts/

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
