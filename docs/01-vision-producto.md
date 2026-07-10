# Producto SciBack — Gestión de Aforo y Presencia Física
*(nombre pendiente de definir)*

## Qué es

Plataforma SaaS para gestión de presencia física, aforo en tiempo real y control de entrada/salida en instituciones académicas. Nace como evolución del sistema InOut del CRAI UPeU.

**Problema que resuelve:**
> ¿Quién está en qué espacio físico, desde cuándo, y cuántos caben?

## Posicionamiento

- **Producto:** SciBack — orientado a universidades peruanas y latinoamericanas
- **No es** un sistema de control de acceso físico con torniquetes (PACS)
- **No es** un sistema de reservas — se alimenta de Indico/Koha para eso
- **Es** la capa de presencia y aforo que ninguno de esos sistemas tiene

## Casos de uso principales

### 1. Biblioteca / CRAI
- Fuente de identidad: Koha (carnet de biblioteca)
- Espacios: edificio, salas de estudio, hemeroteca
- Necesidad: registro entrada/salida, aforo, reportes acreditación SINEACE/SUNEDU

### 2. Eventos académicos (gap de Indico)
- Fuente de identidad: Indico (registro al evento)
- Espacios: auditorio, salones de ponencias, talleres
- Necesidad: Indico sabe quién se registró al congreso pero NO en qué salón está cada asistente — ese gap lo cubre este producto

### 3. Campus / institución general (Plan Pro)
- Fuente de identidad: MidPoint / Keycloak (toda la universidad)
- Espacios: cualquier edificio, laboratorio, gimnasio
- Necesidad: presencia enriquecida con rol/facultad/escuela para reportes institucionales

## Fuentes de presencia (por plan)

```
Plan Starter:     Escaneo manual QR / código de barras
Plan Pro:         FreeRADIUS Accounting (WiFi automático) + QR como fallback
```

## Arquitectura conceptual

```
┌─────────────────────────────────────────────────────────┐
│                    FUENTES DE PRESENCIA                  │
│  FreeRADIUS Accounting   Escaneo QR manual   Indico      │
│  (automático, pasivo)    (fallback activo)   (eventos)   │
└──────────────┬───────────────────┬──────────────┬────────┘
               │                   │              │
               ▼                   ▼              ▼
┌─────────────────────────────────────────────────────────┐
│              NÚCLEO: Motor de Presencia                  │
│  • Enrich identidad ← MidPoint (facultad, escuela, rol) │
│  • AP MAC → ubicación física (tabla de mapeo)            │
│  • Cálculo aforo en tiempo real                          │
│  • Deduplicación multi-dispositivo                       │
│  • Permanencia, historial, anomalías                     │
└──────────────────────────────┬──────────────────────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
         Kiosko React    API REST         Reportes
         (dashboard      (MidPoint,       acreditación
          aforo +        Indico,          SINEACE/SUNEDU
          salas libres)  terceros)
```

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI (Python) |
| Base de datos | PostgreSQL |
| Auth | JWT (Starter) / Keycloak OIDC (Pro) |
| Deploy | Docker Compose |
| Repo | github.com/SciBack/[nombre-pendiente] |

## Kiosko — pantalla (ambos planes)

La pantalla física deja de ser un terminal de entrada/salida y se convierte en dashboard:
- Aforo actual del edificio y por piso/sala
- Salas de estudio disponibles (desde Indico Room Booking)
- Próximos eventos del día (desde Indico)
- Notificaciones de biblioteca (desde Koha)
- QR para reservar sala desde el celular

## Nombre del producto

**Estado: pendiente.** Ninguna propuesta aprobada aún.

Propuestas evaluadas y descartadas:
- Fluxo — tomado como dominio .com, .pe
- Fluxxo — agencia brasileña activa con ese nombre
- Afluxo — técnicamente limpio pero no convenció
- Fluxoin, Fluxoinout — descartados
- Prexo, Aquio, Kaporo, Aforix — no convencieron al usuario

Criterio buscado: una sola palabra, que suene a app, que simplifique "aforo + gestión de presencia física".

## Relación con InOut actual (UPeU-Infra/inout)

- InOut actual: fork de omkar2403/inout v1.3.3, PHP+MariaDB, producción en 192.168.12.134
- Este producto lo reemplaza y lo supera
- El repo UPeU-Infra/inout será archivado (no eliminado) cuando este producto esté en producción
