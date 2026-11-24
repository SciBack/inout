FROM python:3.12-slim

WORKDIR /app

# Voz del saludo para kioskos cuyo navegador no tiene voces (routers/tts.py).
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
# Herramientas de mantenimiento del padrón (reparaciones puntuales, backfills).
# Van en la imagen porque se ejecutan CONTRA la base de producción y necesitan
# la misma configuración y el mismo código que el servicio.
COPY scripts/ ./scripts/

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
