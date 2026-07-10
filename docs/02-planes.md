# Planes del producto — Starter y Pro

## Plan Starter — "InOut mejorado"

**Target:** Universidades que recién inician gestión de aforo. Sin infraestructura avanzada de red o identidad.

**Modelo de entrada/salida:** Escaneo manual — QR o código de barras en kiosko.

### Funcionalidades

| Módulo | Descripción |
|--------|-------------|
| Registro entrada/salida | Escaneo QR/código en kiosko físico |
| Dashboard aforo | Tiempo real por espacio — edificio, piso, sala |
| Conector Koha REST API | Validación de patron por cardnumber (solo lectura) |
| Conector Indico | Disponibilidad de salas + asistencia a sesiones de evento |
| Multi-sede | Una instancia, múltiples bibliotecas/edificios |
| Reportes acreditación | SINEACE — uso de biblioteca, permanencia, concurrencia por facultad |
| Kiosko React | Dashboard de aforo + salas disponibles en pantalla física |

### Integraciones Starter

```
Kiosko React → FastAPI → PostgreSQL
                       → Koha REST API (GET /patrons?cardnumber=)
                       → Indico API (rooms, availability)
```

### Lo que NO incluye el Starter

- Entrada automática por WiFi
- Enriquecimiento de identidad por MidPoint
- Autenticación SSO
- Control de acceso por roles
- Analytics avanzados

---

## Plan Pro — "Presencia inteligente"

**Target:** Universidades con FreeRADIUS, MidPoint/Keycloak y despliegue institucional avanzado. Caso UPeU como referencia.

**Modelo de entrada/salida:** Automático por WiFi (FreeRADIUS Accounting) + QR como fallback.

### Todo lo del Starter más:

| Módulo | Descripción |
|--------|-------------|
| FreeRADIUS Accounting | WiFi Start/Stop → entrada/salida automática sin acción del usuario |
| Mapeo AP → ubicación | Tabla: MAC del AP → edificio/piso/zona |
| Enrich MidPoint | Por cada presencia: facultad, escuela, programa, rol |
| Deduplicación | Una persona con múltiples dispositivos = una sola presencia |
| Keycloak SSO | Login unificado para administradores y usuarios |
| Control por roles | Espacios restringidos según rol (MidPoint provisiona acceso) |
| Analytics avanzados | Mapas de calor por hora/día, permanencia promedio, picos de uso |
| Reportes institucionales | Por facultad, por programa, comparativas históricas |

### Arquitectura Pro

```
FreeRADIUS Accounting ──→
Escaneo QR (fallback) ──→  FastAPI (Motor de Presencia)
Indico API ─────────────→       │
                                ├─→ PostgreSQL
                                ├─→ MidPoint REST (enrich identidad)
                                ├─→ Koha REST API
                                └─→ Indico API (salas/eventos)
                                         │
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                    Kiosko React    API pública    Reportes PDF
                    (dashboard)     (webhooks)     acreditación
```

### FreeRADIUS — cómo funciona la integración

FreeRADIUS Accounting emite eventos con:
- `Acct-Status-Type`: Start / Stop
- `User-Name`: identidad del certificado (ej. juan.sanchez@upeu.edu.pe)
- `Called-Station-Id`: MAC del AP + SSID (ej. AA:BB:CC:DD:EE:FF:wifi-biblioteca)
- `Acct-Session-Time`: segundos de permanencia (en Stop)

El Motor de Presencia:
1. Recibe evento RADIUS (via SQL logging o syslog)
2. Resuelve MAC del AP → ubicación física (tabla de mapeo)
3. Consulta MidPoint para enriquecer identidad
4. Registra presencia en PostgreSQL
5. Deduplica si la persona ya tiene otro dispositivo activo en ese espacio

### Desafíos del Plan Pro y mitigaciones

| Desafío | Mitigación |
|---------|-----------|
| Múltiples dispositivos por persona | Deduplicar por User-Name, no por dispositivo |
| Señal WiFi fuera del perímetro | Whitelist de APs "dentro del edificio" |
| Dispositivo sin certificado Intune | Fallback a escaneo QR manual |
| Latencia evento WiFi | Buffer de 30s antes de registrar entrada confirmada |
| Privacidad / Ley 29733 | Política de uso de red — UPeU ya debe tenerla para WiFi institucional |

---

## Comparativa de planes

| Característica | Starter | Pro |
|----------------|---------|-----|
| Entrada/salida manual (QR) | ✅ | ✅ |
| Entrada/salida automática (WiFi) | ❌ | ✅ |
| Conector Koha REST | ✅ | ✅ |
| Conector Indico (salas) | ✅ | ✅ |
| Enrich MidPoint | ❌ | ✅ |
| Keycloak SSO | ❌ | ✅ |
| Reportes acreditación básicos | ✅ | ✅ |
| Reportes institucionales avanzados | ❌ | ✅ |
| Multi-sede | ✅ | ✅ |
| Requisito infraestructura | Docker Compose | + FreeRADIUS + MidPoint |

---

## Roadmap de desarrollo

### V1 (Starter funcional)
1. Estructura del repo SciBack + Docker Compose base
2. Backend FastAPI — modelo de datos (spaces, presence_log, identity_cache)
3. Conector Koha REST API
4. Kiosko React — escaneo + dashboard aforo
5. Conector Indico — disponibilidad de salas
6. Reportes básicos

### V2 (Pro — integración WiFi)
1. Consumer de RADIUS Accounting (SQL o syslog)
2. Tabla de mapeo AP → ubicación
3. Conector MidPoint (enrich identidad)
4. Deduplicación multi-dispositivo
5. Analytics avanzados

### V3 (Pro — control de acceso)
1. Keycloak SSO
2. Políticas de acceso por rol (MidPoint → permisos de espacio)
3. App móvil para reservas
4. Integración torniquetes físicos (PACS)
