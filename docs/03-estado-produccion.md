# InOut v1.0.1 — Estado en Producción

> **Versión:** v1.0.1 (parche 2026-04-14)
> **Fecha de puesta en producción:** 2026-04-13
> **URL:** https://inout.upeu.edu.pe
> **Servidor:** 192.168.12.134 · Docker Compose en /opt/inout

---

## Estado del despliegue

| Componente | Estado |
|-----------|--------|
| Frontend React | ✅ en producción |
| Backend FastAPI | ✅ en producción |
| PostgreSQL 16 | ✅ en producción |
| nginx reverse proxy (interno) | ✅ activo |
| Apache proxy inout.upeu.edu.pe → :8090 | ✅ activo |
| HTTPS | ✅ certificado válido |
| Admin panel /admin | ✅ contraseña segura (en ~/.secrets/inout.env) |

## Sedes activas

| Sede | Space ID | Koha REST | Último evento InOut | Estado |
|------|----------|-----------|---------------------|--------|
| BUL Lima | 1 | ✅ | 2026-04-14 | ✅ Activa |
| BUJ Juliaca | 2 | ✅ | 2025-08-14 | ✅ Activa (sin uso desde ago-2025) |
| BUT Tarapoto | 4 | ✅ | 2026-04-13 | ✅ Activa |
| CIA | 3 | ✅ | Sin eventos | ✅ Activa (kiosko pendiente de instalar) |

## Datos históricos migrados

| Sede | Eventos migrados | Origen |
|------|-----------------|--------|
| BUL Lima | 306,239 | PHP InOut / MariaDB |
| BUT Tarapoto | 15,278 | PHP InOut / MariaDB |
| BUJ Juliaca | 146 | PHP InOut / MariaDB |
| **Total** | **321,663** | |

## Funcionalidades v1.0.0

- Escaneo carnet → entry/exit automático (debounce 8s)
- Dashboard aforo tiempo real (polling 5s)
- Feed "Actividad reciente" — solo eventos del día actual
- Tarjetas estadísticas: visitantes únicos, Hombres/Mujeres, permanencia, hora punta
- **Tarjeta "Perfiles hoy"** — barras por categoría (ESTUDI, DOCEN, VISITA, INVESTI, STAFF)
- Barras de aforo por facultad
- Fotos patron desde Koha DB directa (BUL — BUT/BUJ pendiente unificación Koha)
- TTS Web Speech API (sin dependencias externas)
- Panel admin: sedes, espacios, usuarios admin, estadísticas anuales/mensuales/diarias

## Categorías Koha soportadas en dashboard

| Code | Label UI | Color |
|------|----------|-------|
| ESTUDI | Estudiantes | cyan |
| DOCEN | Docentes | blue |
| VISITA | Visitantes | amber |
| INVESTI | Investigadores | purple |
| STAFF | Personal biblioteca | green |

## Flujo de deploy

```bash
# En local (Mac):
cd /Users/alberto/proyectos/sciback/inout
git add . && git commit -m "..." && git push

# Se conecta automáticamente:
ssh juansanchez@192.168.12.134
cd /opt/inout && git pull
docker compose build [backend|frontend]
docker compose up -d
```

## Changelog

### v1.0.1 — 2026-04-14
- Tarjeta "Prom. permanencia" muestra subtexto "Típico [día] · Xh Xm" (promedio histórico del mismo día de semana, últimas 52 semanas) — consistente con el patrón de la tarjeta "Hora punta"

### v1.0.0 — 2026-04-13
- Lanzamiento en producción: kiosko React + dashboard aforo + backend FastAPI + PostgreSQL 16
- Migración de 321,663 eventos históricos (PHP InOut / MariaDB → PostgreSQL)
- Multi-sede: BUL Lima, BUJ Juliaca, BUT Tarapoto, CIA
- Scheduler auto-exit a las 22:00 Lima (CRAI Lima)
- Fix timezone dashboard (bug `func.date()` en UTC vs Lima)

---

## Pendiente — próximas versiones

### Inmediato
- [ ] Kiosko físico BUT: alguien debe abrir http://192.168.12.134:8090?space=4 en el equipo físico
- [ ] Kiosko físico BUJ: alguien debe abrir http://192.168.12.134:8090?space=2 en el equipo físico
- [ ] Kiosko físico CIA: instalar equipo físico y abrir http://192.168.12.134:8090?space=3
- [ ] Configurar `open_time`/`close_time` en BUJ, BUT y CIA desde el panel admin (para auto-exit)

### Plan Pro (futuro)
- [ ] Fotos patron BUT/BUJ (depende de unificación Koha)
- [ ] Entrada automática por WiFi (FreeRADIUS Accounting)
- [ ] Identidad enriquecida via MidPoint
- [ ] Keycloak SSO para admin
- [ ] Reportes SINEACE exportables
