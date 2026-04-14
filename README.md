# InOut — Gestión de Aforo para Bibliotecas Universitarias

Sistema de control de presencia física y aforo en tiempo real para bibliotecas universitarias. Desarrollado por **SciBack** como producto reutilizable para instituciones académicas peruanas.

**Cliente piloto:** CRAI UPeU Lima — en producción desde 2026-04-13.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | FastAPI + SQLAlchemy |
| Base de datos | PostgreSQL 16 |
| Deploy | Docker Compose + Nginx |
| Integración | Koha REST API + Koha DB (fotos) |

---

## Funcionalidades (v1.0.1)

- Escaneo de carnet → registro automático entrada/salida (debounce 8 s)
- Dashboard de aforo en tiempo real (polling 5 s) — gauge circular + porcentaje
- Feed de actividad reciente con fotos desde Koha DB
- **Multi-sede:** una sola instancia sirve múltiples bibliotecas/edificios; kiosko por sede vía `?space=<id>`
- **Scheduler auto-exit:** cierre automático de presencias activas al llegar la hora de cierre (APScheduler, timezone America/Lima)
- **Estadísticas del día:**
  - Visitantes únicos / delta vs ayer
  - Perfiles por categoría (Estudiantes, Docentes, Visitantes, Investigadores, Staff)
  - Hombres / Mujeres en edificio ahora + total acumulado del día
  - Prom. permanencia + "Típico [día de semana]" (histórico 52 semanas)
  - Hora punta + "Típico [día de semana]" (histórico por día de semana)
  - Distribución de visitantes por facultad
- Panel admin (`/admin`): sedes, espacios, usuarios, estadísticas diarias/mensuales/anuales
- TTS Web Speech API — saludo con nombre, categoría y hora del día al escanear

---

## Deploy rápido

```bash
git clone https://github.com/SciBack/inout.git
cd inout
cp .env.example .env
# Editar .env con credenciales Koha y PostgreSQL
docker compose up -d --build
```

El sistema queda disponible en `http://localhost:8090`.

Para kiosko de sede específica: `http://localhost:8090?space=<id>`

---

## Variables de entorno

Ver `.env.example` para la lista completa. Mínimo requerido:

| Variable | Descripción |
|----------|-------------|
| `POSTGRES_PASSWORD` | Password PostgreSQL |
| `KOHA_API_URL` | URL base Koha REST API (global o por sede) |
| `KOHA_API_USER` | Usuario API Koha |
| `KOHA_API_PASS` | Password API Koha |
| `SECRET_KEY` | JWT secret (`openssl rand -hex 32`) |
| `DEFAULT_SPACE_CAPACITY` | Aforo máximo del espacio por defecto |

Para activar fotos de patrons: configurar `KOHA_DB_HOST`, `KOHA_DB_USER`, `KOHA_DB_PASS`, `KOHA_DB_NAME`.

Para multi-sede con Koha separado por sede: usar las variables `KOHA_BUL_*`, `KOHA_BUT_*`, `KOHA_BUJ_*`, etc.

---

## API principal

```
POST /api/scan           Registra entrada o salida por número de carnet
GET  /api/dashboard      Estadísticas y aforo actual del día
GET  /api/health         Healthcheck
GET  /api/photo/{cardnumber}  Foto del patron desde Koha DB
```

El panel de administración está en `/admin` (usuario `admin`, password configurable via `ADMIN_INITIAL_PASSWORD`).

---

## Estructura

```
inout/
├── backend/
│   ├── app/
│   │   ├── routers/      dashboard.py, scan.py, admin.py, photo.py
│   │   ├── services/     koha.py, scheduler.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   └── main.py
│   └── Dockerfile
├── frontend/
│   └── src/
│       └── components/   OccupancyPanel.tsx, WelcomeScreen.tsx, ScanInput.tsx
├── nginx/
├── docker-compose.yml
└── .env.example
```

---

## Roadmap (Plan Pro)

- Entrada automática por WiFi vía FreeRADIUS Accounting
- Identidad enriquecida vía MidPoint (facultad, escuela, rol)
- SSO con Keycloak
- Reportes SINEACE exportables
- Fotos patron para sedes BUT y BUJ (pendiente unificación Koha)
