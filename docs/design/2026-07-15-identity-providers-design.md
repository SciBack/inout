# Diseño — InOut multi-fuente de identidad (padrón local + proveedores pluggable)

**Fecha:** 2026-07-15 · **Estado:** aprobado (brainstorm) · **Fase de este spec:** Fase 1

## Contexto y objetivo

Hoy InOut resuelve la identidad de quien escanea consultando **Koha directamente** en cada
escaneo (`backend/app/services/koha.py`, consumido por `backend/app/routers/scan.py`). Eso
acopla el producto a Koha y mete una llamada de red en el camino crítico del kiosko.

**Objetivo:** desacoplar la identidad detrás de una abstracción de **proveedores pluggable**
(Koha, LDAP/AD, MidPoint, SQL/CSV), con un **padrón local** en Postgres como capa de resolución.

**Decisiones tomadas en el brainstorm:**
- **Modo:** padrón local sincronizado + **relleno perezoso en vivo** para desconocidos.
  Prioriza velocidad (resolución local, sin red en el hot path) y frescura (sync programado).
- **Alcance:** InOut **solo registra** aforo. NO controla acceso (no autoriza/deniega).
  Campus/edificio son metadatos del padrón para estadística/reportes.
- **Fuentes:** todas soportadas vía adaptadores, multi-proveedor con prioridad.
- **Resiliencia offline (requisito duro):** si las fuentes no responden, InOut **sigue
  registrando** el ingreso con la caché/padrón local o un registro mínimo. El aforo nunca se detiene.
- El canónico queda **agnóstico**: proveedores y mapeos se declaran por `.env` + JSON en `/config`
  (mismo patrón que `config/faculty_map.json` del overlay).

## Modelo de datos (nuevo)

Tablas nuevas (migración idempotente en `main.py:_run_migrations`, sin Alembic, patrón actual):

- **`persons`** — padrón local:
  `person_key` (str, único), `full_name`, `first_name`, `gender`, `category`, `faculty`,
  `program`, `escuela`, `role`, `dni`, `email`, `home_sede_code` (campus de pertenencia),
  `home_building` (edificio de pertenencia), `source` (proveedor de origen), `raw` (JSONB),
  `synced_at`, `active`.
- **`person_identifiers`** — `(id_type, id_value)` → `person_key`. Único por `(id_type, id_value)`,
  índice por `id_value`. Tipos: `cardnumber`, `uid`, `samaccountname`, `dni`, `email`.
  Permite resolver el escaneo sea cual sea la credencial leída.
- **`presence_log`** — agregar columna `person_key` (nullable). Se conservan los campos snapshot
  actuales (`patron_name`, `patron_category`, `patron_gender`, `patron_faculty`, `patron_program`)
  como histórico, y `cardnumber`.
- **`provider_sync_runs`** — auditoría: `provider`, `started_at`, `finished_at`, `created`,
  `updated`, `errors`, `status`.

Schemas Pydantic correspondientes en `backend/app/schemas.py`.

## Abstracción de proveedores — nuevo paquete `backend/app/services/identity/`

- **`PersonRecord`** (dataclass neutral, NO SQLAlchemy): DTO que todo proveedor devuelve.
  Campos = superset del padrón + `identifiers: dict[str,str]`. Desacopla proveedores del ORM.
- **`IdentityProvider`** (typing.Protocol / ABC):
  - `name: str`, `priority: int`, `enabled: bool`
  - `fetch_all() -> Iterable[PersonRecord]` — para el sync del padrón.
  - `lookup(id_type: str, id_value: str) -> PersonRecord | None` — relleno perezoso en vivo.
  - `health() -> bool`
- **Adaptadores (Fase 1):**
  - `KohaProvider` — envuelve la lógica REST actual de `koha.py` (reutilizar `_normalize`,
    `resolve_faculty`, la caché y el fallback). `lookup` = query `/patrons?q=`. NO se pierde nada.
  - `LdapProvider` — OpenLDAP y AD con el mismo adaptador (`python-ldap` o `ldap3`). `fetch_all`
    = búsqueda paginada; `lookup` = filtro por atributo. Mapea eduPerson/SCHAC.
  - `CsvProvider` — lee un CSV del volumen `/config`. Incluido en Fase 1 porque (a) habilita
    testing sin LDAP real y (b) sirve a clientes sin directorio.
  - (`MidpointProvider` SCIM/REST y `SqlProvider` → Fase 2.)
- **Mapeo de atributos declarativo:** JSON en `/config/identity_map.json` (campo fuente → campo
  padrón, por proveedor). Cargado como `faculty_map.json`. Mantiene el canónico agnóstico.
- **Registro de proveedores:** `providers.py` construye la lista de proveedores habilitados desde
  `settings`, ordenados por prioridad.

## Motor de sincronización — `backend/app/services/sync.py`

- `sync_provider(provider)` — `fetch_all()` → **upsert** en `persons` + `person_identifiers`
  por `person_key`; cuenta altas/cambios; registra en `provider_sync_runs`. Idempotente.
- `sync_all()` — corre todos los proveedores habilitados en orden.
- Programado vía **APScheduler** (ya presente, ver `services/scheduler.py`): job diario configurable.
- Endpoint admin `POST /api/admin/sync` (protegido, patrón `get_current_user`) + acción en el panel.

## Resolución en el escaneo — refactor `backend/app/routers/scan.py`

Nuevo flujo (reemplaza la llamada directa a `koha.get_patron`):
1. Buscar `(id_type inferido, id_value)` en `person_identifiers` → si existe, resolver del
   **padrón local** (instantáneo, sin red).
2. Si no está → **relleno perezoso:** `lookup()` por proveedores habilitados en orden de prioridad,
   con timeout corto; si aparece, **upsert** al padrón y usar esos datos.
3. Si ninguna fuente responde / no lo encuentra → **registrar igual**: usar snapshot previo del
   padrón si existe, o un `presence_log` mínimo (`person_key=NULL`, `cardnumber` marcado
   "sin identificar"). **El conteo de aforo nunca se detiene.**
- Campus/edificio **del ingreso** = del `space`/`sede` del kiosko (ya existe).
  Campus/edificio **de pertenencia** = del padrón (`home_sede_code`/`home_building`).

## Config / overlay

Nuevas settings en `backend/app/config.py` (todas con default vacío → agnóstico):
`identity_map_path`, y por proveedor `*_enabled`, `*_priority`, credenciales/host/base_dn/filtros.
El overlay UPeU (`instituciones/upeu`) habilita LDAP (primario) + Koha (fallback + fotos) con su
`identity_map.json`. `docker-compose.yml` ya monta `/config`.

## Compatibilidad y migración

- El flujo Koha actual sigue funcionando envuelto como `KohaProvider`. Sin proveedores
  configurados, el comportamiento degrada a "sin identificar" pero el aforo sigue.
- Histórico (321k eventos) y `faculty_map.json` intactos. `person_key` nullable en `presence_log`.

## Verificación (end-to-end, OrbStack)

1. **Local hit:** sembrar padrón vía `CsvProvider` sync; escanear un id existente → resuelve del
   padrón, sin red, `presence_log.person_key` seteado.
2. **Relleno perezoso:** escanear un id NO en el padrón pero SÍ en el CSV/mock provider → lo
   resuelve en vivo, lo upserta, registra.
3. **Offline degradado:** deshabilitar/romper todas las fuentes → escanear id desconocido →
   se registra igual (`person_key=NULL`, marcado sin identificar). El aforo incrementa.
4. **Sync idempotente:** correr `sync_all()` dos veces → sin duplicados; altas/cambios correctos.
5. Suite de unit tests por adaptador (datos mock) + los 3 caminos de resolución.

## Fuera de alcance (Fase 2)
`MidpointProvider` (SCIM), `SqlProvider`, UI admin de gestión de proveedores, control de acceso.
