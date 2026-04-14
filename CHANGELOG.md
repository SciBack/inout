# Changelog — InOut

## v1.0.1 — 2026-04-14

### Mejoras
- **Dashboard:** tarjeta "Prom. permanencia" muestra subtexto "Típico [día de semana] · Xh Xm" con el promedio histórico del mismo día de semana (últimas 52 semanas), consistente con el patrón de la tarjeta "Hora punta"

---

## v1.0.0 — 2026-04-13

Primer lanzamiento en producción. Cliente piloto: CRAI UPeU Lima.

### Funcionalidades
- Escaneo de carnet → registro automático entrada/salida (debounce 8 s)
- Dashboard aforo en tiempo real con polling 5 s
- Feed de actividad reciente con fotos desde Koha DB directa
- Multi-sede: BUL Lima (847), BUJ Juliaca (80), BUT Tarapoto (80), CIA (60)
- Scheduler auto-exit diario a las 22:00 Lima (APScheduler + CronTrigger por space)
- Estadísticas del día: visitantes, género, permanencia, hora punta, perfiles por categoría, distribución por facultad
- Hora punta típica por día de semana (histórico)
- Panel admin: sedes, espacios, usuarios, estadísticas diarias/mensuales/anuales
- TTS Web Speech API al escanear
- Migración de 321,663 eventos históricos desde PHP InOut / MariaDB

### Fixes incluidos en v1.0.0
- Fix timezone dashboard: todas las queries usan bounds Lima explícitos (`_lima_day_bounds()`), eliminando bug de conteos incorrectos a partir de las 19:00 Lima
- Fix counter animation: eliminado `animateCounter` que conflictuaba con React al manipular `textContent` directamente
