# InOut — Gestión de Aforo para Bibliotecas Universitarias

Sistema de control de presencia física y aforo en tiempo real para bibliotecas universitarias. Desarrollado por **SciBack** como producto reutilizable para instituciones académicas peruanas.

**Cliente piloto:** CRAI Lima — en producción desde 2026.

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

## Funcionalidades (v1.0.0)

- Escaneo de carnet → registro automático entrada/salida
- Dashboard de aforo en tiempo real (polling 5 s)
- Feed de actividad reciente con fotos Koha
- Estadísticas del día: visitantes, género, permanencia, hora punta, distribución por facultad
- Panel admin (`/admin`): sedes, espacios, usuarios, estadísticas mensuales/anuales
- TTS Web Speech API (saludo sin nombre — solo género + hora del día)

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

---

## Variables de entorno

Ver `.env.example` para la lista completa. Mínimo requerido:

| Variable | Descripción |
|----------|-------------|
| `POSTGRES_PASSWORD` | Password PostgreSQL |
| `KOHA_API_URL` | URL base Koha REST API |
| `KOHA_API_USER` | Usuario API Koha |
| `KOHA_API_PASS` | Password API Koha |
| `SECRET_KEY` | JWT secret (`openssl rand -hex 32`) |
| `DEFAULT_SPACE_CAPACITY` | Aforo máximo del espacio |

Para activar fotos de patrons, agregar también `KOHA_DB_HOST`, `KOHA_DB_USER`, `KOHA_DB_PASS`, `KOHA_DB_NAME`.

---

## API principal

```
POST /api/scan           Registra entrada o salida por número de carnet
GET  /api/dashboard      Estadísticas y aforo actual del día
GET  /api/health         Healthcheck
```

El panel de administración está en `/admin` (usuario `admin`, password configurable via `ADMIN_INITIAL_PASSWORD`).

---

## Estructura

```
inout/
├── backend/          FastAPI app + modelos + routers
├── frontend/         React SPA (kiosko + dashboard)
├── nginx/            Reverse proxy config
├── docker-compose.yml
└── .env.example
```

---

## Roadmap (Plan Pro)

- Entrada automática por WiFi vía FreeRADIUS Accounting
- Identidad enriquecida vía MidPoint (facultad, escuela, rol)
- SSO con Keycloak
- Reportes SINEACE
