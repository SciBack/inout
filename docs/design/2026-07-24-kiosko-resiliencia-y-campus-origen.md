# Plan de ejecución — Identidad del kiosko, resiliencia de conexión y campus de origen

**Fecha:** 2026-07-24
**Estado:** aprobado, pendiente de ejecución
**Destinatario:** este documento está escrito para ser ejecutado por otro agente. Contiene el
estado actual verificado, el estado deseado, y cómo comprobar cada paso.

---

## Contexto imprescindible (leer antes de tocar nada)

**Qué es InOut y qué NO es.** Mide ocupación (aforo) y permanencia en edificios. **No controla
acceso**: no hay molinete ni agente de seguridad. Nadie es rechazado. De ahí la regla que
gobierna todo el diseño: *ante cualquier duda, registrar el evento*. Una persona que no se
identifica igual ocupa el edificio y para una evacuación cuenta como cualquier otra.

**Modelo institucional de UPeU — 3 campus, 4 bibliotecas.** No son cuatro campus.

| Campus (`sedes`) | Bibliotecas Koha | Espacios (`spaces`) |
|---|---|---|
| LIMA | BUL, **CIA** | CRAI Lima (id 1), CRAI CIA (id 3) |
| JULIACA | BUJ | CRAI Juliaca (id 2) |
| TARAPOTO | BUT | CRAI Tarapoto (id 4) |

Que Lima tenga dos bibliotecas es el motivo de que `library_code` viva en `spaces` y no en
`sedes`. Si en algún resumen aparece "4 campus", está mal.

**Producto canónico y agnóstico.** Este repo (`SciBack/inout`, público) no debe contener datos
de ninguna institución: nada de "UPeU", ni códigos de facultad, ni nombres de sede. Todo eso
vive en el overlay privado (`SciBack/inout-upeu`) como JSON montado. Al escribir mensajes de
interfaz, usar lenguaje genérico ("el padrón", "la institución"), nunca el nombre del cliente.

---

## Gotchas operativos verificados (ahorran horas)

**Tests:**
```bash
docker run --rm -v "$PWD/backend:/app" -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

- **SQLite (motor de los tests) NO reproduce los bugs de transacción de PostgreSQL.** SQLite
  tolera seguir operando tras un error; PostgreSQL aborta la transacción entera. Ya nos costó
  un bug en producción que la suite no detectaba. Para bugs de transacción, levantar un
  PostgreSQL real:
  ```bash
  docker run -d --name pg-test -e POSTGRES_PASSWORD=x -e POSTGRES_DB=t -p 55433:5432 postgres:16-alpine
  ```
- **Verificar los tests por mutación.** Romper a propósito la guarda que el test cubre y
  confirmar que falla *ese* test y ninguno más. Un test que pasa siempre no prueba nada — ya
  pasó en esta sesión: un test "pasaba" sin ejercitar la lógica.

**Despliegue a producción** (`inout-prod`, 192.168.12.134, app en `/opt/inout`):
- El repo tiene **ownership mixto**: `git pull` **debe ir con `sudo`**, si no falla a medias
  dejando el árbol sucio y HEAD sin mover.
- Si un pull quedó a medias: `sudo git checkout -- .` y borrar a mano los untracked.
  **Nunca `git clean -fd`** — se lleva los `.env.bak-*` y `config/_pre-overlay-backup-*`.
- Aplicar: `sudo docker compose up -d --build backend` (migraciones aditivas corren al
  arrancar). Para cambios de frontend, reconstruir también `frontend`.
- Contenedores: `inout-backend-1`, `inout-db-1`, `inout-frontend-1`, `inout-nginx-1`.
- SSH: usuario `juansanchez` con `$INOUT_PROD_SSH_PASS` de `~/.secrets/inout.env`, + `sudo -S`.
  El shell remoto es `sh` (dash), no bash — nada de herestrings `<<<`.
- **Cada despliegue del backend deja ~15 s sin servicio.** Los escaneos en esa ventana se
  pierden hoy (ver Fase 2). Desplegar fuera del horario de biblioteca.

**Migraciones:** no hay Alembic. Se agregan sentencias idempotentes a `_run_migrations()` en
`backend/app/main.py` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

---

## Estado actual verificado (2026-07-24)

| Cosa | Estado |
|---|---|
| Producción | `fe114f7`, operativa, 100 tests en verde |
| Escaneo | Sin autenticación (`async def scan(req, db)` — sin `current_user`) |
| Identidad del kiosko | `?space=N` en URL → `localStorage`; sin nada, cae a `default_space_id=1` |
| Timeout de red en el kiosko | **No existe** — no hay `AbortController` ni `signal` |
| Hora del evento | La pone la BD: `server_default=func.now()`. El request no la acepta |
| Campus de origen de la persona | `persons.home_sede_code` (LDAP, ~100% activos, 0% egresados) |
| Campus en el evento | **No se guarda** — `presence_log` no tiene la columna |
| `library_code` en el admin | Existe en el modelo y la API, **falta en el formulario web** |

---

## FASE 1 — Identidad del kiosko

**Problema.** `scan.py` y `dashboard.py` hacen `space_id or settings.default_space_id`. Un
kiosko que pierde su `localStorage` empieza a registrar gente de su edificio como si fuera
el edificio por defecto, **sin ningún error visible**. Es el mismo patrón de fallo silencioso
que ya nos costó tres bugs en esta sesión.

**Decisión tomada:** el mecanismo principal de configuración es **la URL como página de inicio
del navegador del kiosko** (`https://<host>/?space=4`). Ya funciona: `getSpaceId()` lee el
parámetro en cada carga y reescribe `localStorage`, así que cada reinicio reafirma el edificio
correcto y `localStorage` queda como mero caché. **No requiere código.** Lo que sigue es lo
que hace falta para que un kiosko mal configurado se note.

### 1.1 Endpoint público de espacios

Nuevo `GET /api/spaces` en `backend/app/routers/dashboard.py` (o router nuevo `spaces.py`):

- Sin autenticación (el kiosko no la tiene).
- Devuelve **solo espacios activos**, campos mínimos: `id`, `name`, `capacity`, y del campus
  `sede_code` + `sede_name`.
- No exponer nada sensible: sin `library_code`, sin direcciones.

### 1.2 Selector de edificio (red de contención)

En `frontend/src/App.tsx`, cuando `getSpaceId()` devuelve `undefined`:

- **Si el endpoint devuelve exactamente 1 espacio activo** → usarlo automáticamente, sin
  preguntar. Esto preserva la promesa agnóstica: una institución con un solo edificio nunca ve
  esta pantalla.
- **Si devuelve más de 1** → mostrar un selector agrupado por campus. Al tocar uno, guardar en
  `localStorage` y entrar al kiosko.
- **Si devuelve 0 o falla** → mensaje de error claro, no caer al default.

### 1.3 Edificio visible en la pantalla de escaneo

Hoy el nombre del edificio solo aparece en el panel de aforo (`OccupancyPanel`). Agregarlo
también del lado del escaneo (`ScanInput` o el contenedor), discreto pero legible. Objetivo:
que un kiosko mal configurado se note de un vistazo, no meses después en los datos.

Incluir un enlace pequeño **"cambiar edificio"** que borre `inout_space_id` y vuelva al
selector.

### 1.4 Backend: no adivinar el espacio

En `backend/app/routers/scan.py`, reemplazar `space_id = req.space_id or settings.default_space_id`:

- Si `req.space_id` viene → usarlo (validando que exista y esté activo).
- Si no viene y hay **exactamente un** espacio activo → usar ese.
- Si no viene y hay **más de uno** → `HTTP 400` con detalle `space_id_requerido`.

Mantener `default_space_id` en la configuración por compatibilidad, pero que solo aplique en el
caso de espacio único.

### 1.5 `library_code` en el formulario del admin

En `frontend/src/components/admin/SpacesPage.tsx`: agregar el campo a `EMPTY_FORM`, al estado
de edición, al payload y al formulario. Es un input de texto corto. Sin él, un edificio creado
desde la web no puede enrutar a su biblioteca Koha.

### Cómo verificar la Fase 1

1. Tests nuevos: espacio único → no exige `space_id`; varios espacios sin `space_id` → 400;
   `space_id` de un espacio inactivo → rechazado.
2. En producción: abrir la URL pelada → debe aparecer el selector con los 4 edificios agrupados
   en 3 campus, **no** el dashboard de Lima.
3. Abrir `?space=4` → entra directo a Tarapoto y el nombre se ve en pantalla.
4. Confirmar que los 4 espacios conservan su `library_code` (BUL/CIA/BUT/BUJ).

---

## FASE 2 — Resiliencia de conexión, parte A: que el fallo se vea

**Problema verificado.** `handleScan` en `App.tsx` no tiene timeout. Con red lenta el `fetch`
cuelga sin límite (el navegador tarda minutos en rendirse) mientras `loading` bloquea nuevos
escaneos y la pantalla dice **"Procesando..."** — un mensaje que invita a esperar en vez de
avisar que algo anda mal. Con red caída, el aviso dura 2 segundos y el registro se pierde.

### 2.1 Timeout explícito

`AbortController` con ~5 segundos en el `fetch` de `/api/scan`. Al abortar, tratarlo como
desconexión (no como error genérico).

### 2.2 Estado de desconexión persistente

Reemplazar el aviso efímero de 2 segundos por un **estado persistente y visible**:

- Cartel grande e inequívoco: sin conexión con el servidor, los ingresos no se están
  registrando, avisar a soporte.
- Debe permanecer hasta que la conexión vuelva. No es un toast.
- Mientras esté activo, la entrada de escaneo debe indicar claramente que no está operativa.

### 2.3 Chequeo de salud

Sondeo periódico a `GET /api/health` (ya existe, `main.py`) cada ~10 s mientras está en estado
desconectado. Al recuperarse, limpiar el estado solo, sin intervención.

### Cómo verificar la Fase 2

Con el kiosko abierto, detener el backend (`sudo docker compose stop backend`):
1. Escanear → en ≤5 s aparece el estado de desconexión (no "Procesando..." colgado).
2. El estado persiste, no desaparece a los 2 segundos.
3. Reiniciar el backend → en ≤10 s el kiosko vuelve solo a operativo.

---

## FASE 3 — Campus de origen en el evento

**Objetivo del negocio:** saber quién visita un campus viniendo de otro campus de la misma
institución.

**Prerrequisito: Fase 1 completa.** Si un kiosko cae al espacio por defecto, una persona
escaneando en su propio campus quedaría registrada como visitante cruzado. Dato sucio
indistinguible del real.

### 3.1 Columna en `presence_log`

`patron_home_sede VARCHAR(20)`, nullable. Migración idempotente en `_run_migrations()`.

**Es un snapshot, no una relación.** Igual que `patron_category`, `patron_faculty` y
`patron_gender`, que ya se copian al evento. Motivos: la persona puede trasladarse de campus y
el histórico debe reflejar de dónde era *en ese momento*; y los eventos de gente no
identificada no tienen fila en `persons` con la cual hacer join.

### 3.2 Poblarla en el escaneo

En `scan.py`, en la rama identificada: `home_sede = person.home_sede_code`. En la rama no
identificada queda `None`.

### 3.3 Métrica en el dashboard

En `backend/app/routers/dashboard.py`, agregar al `DashboardStats` el desglose de visitantes
de hoy cuyo `patron_home_sede` **difiere** del código de campus del espacio consultado.

Reglas:
- Comparar contra el `sede.code` del `space_id` consultado.
- **Los de origen desconocido (`NULL`) se muestran explícitos**, como "Origen no registrado".
  Decisión tomada: ocultarlos haría parecer que el dato está completo cuando no lo está. Hoy
  son todos los egresados (~26.795 en el padrón), porque la rama `ou=alumni` del directorio no
  sirve el campus.
- Tarjeta nueva en `OccupancyPanel` con el desglose por campus de origen.

### Cómo verificar la Fase 3

1. Tests: persona con `home_sede_code` distinto al del espacio → cuenta como cruzada; igual →
   no cuenta; `NULL` → cae en "origen no registrado".
2. En producción: verificar que eventos nuevos traen `patron_home_sede` poblado para
   identificados de `ou=people`.
3. Los eventos históricos quedan en `NULL` — es correcto, no inventar datos hacia atrás.

---

## FASE 4 — Resiliencia parte B: cola local (cero pérdida)

**Es la fase más grande y la de mayor riesgo. No empezarla sin las fases 1 y 2 terminadas.**

**Por qué no es "guardar y reenviar".** Tres problemas verificados en el código:

1. **La hora la pone la base**: `timestamp = Column(..., server_default=func.now())`, y
   `ScanRequest` solo acepta `cardnumber` y `space_id`. Un evento encolado a las 10:00 y
   enviado a las 10:15 se registraría a las 10:15 → permanencia, hora punta y aforo mal.
2. **Entrada/salida se decide al insertar**, mirando el último evento
   (`event_type = "exit" if (last and last.event_type == "entry") else "entry"`). Reenvío
   desordenado, o un escaneo nuevo antes de vaciar la cola, deja gente "adentro" para siempre.
3. **El anti-rebote compara contra `datetime.now()`**, no contra la hora del evento. Dos
   eventos encolados con segundos de diferencia, reenviados juntos, se rechazarían como
   duplicados.

Los tres se resuelven con **un solo cambio de fondo: que la hora del evento la mande el kiosko
y el backend la respete.**

### 4.1 Contrato de hora (hacer primero, es la base)

- `ScanRequest`: campo nuevo `scanned_at: Optional[datetime] = None`.
- `scan.py`: si viene, usarla como `timestamp` del `PresenceLog`; si no, `now()` como hoy.
- **Validar** que no venga del futuro ni absurdamente vieja (p. ej. rechazar > 24 h de
  antigüedad) para que un cliente con el reloj roto no corrompa el histórico.
- El anti-rebote debe comparar contra la hora **del evento**, no contra `now()`.

### 4.2 Cola en el kiosko

- Persistir en `localStorage` (o IndexedDB si el volumen lo justifica) los escaneos fallidos,
  **con su hora local de captura**.
- Indicador visible de cuántos hay pendientes. El estado de desconexión de la Fase 2 debe
  decir que se están guardando, no que se están perdiendo.

### 4.3 Reenvío ordenado

- Al recuperar conexión, **vaciar la cola en orden cronológico ANTES de aceptar escaneos
  nuevos**. Es lo que evita el problema 2.
- Reenvío idempotente: si un evento ya entró, no duplicarlo. Considerar un identificador
  de evento generado por el cliente y una restricción de unicidad en el backend.
- Si un evento de la cola falla de forma permanente (no por red), descartarlo con log — no
  bloquear la cola entera. **Aplica la misma lección del bug de sync arreglado en
  `6701564`: un registro malo no debe matar la corrida entera.**

### Cómo verificar la Fase 4

1. Test de contrato: `scanned_at` provisto → se respeta; ausente → `now()`; futuro o muy viejo
   → rechazado.
2. Test de anti-rebote con horas de evento, no de reloj.
3. Prueba manual completa: detener backend → escanear 3 carnets distintos → el kiosko indica
   pendientes → reiniciar backend → los 3 entran **con sus horas originales y en orden**, y las
   entradas/salidas quedan coherentes.
4. Prueba de duplicado: reenviar la cola dos veces no debe duplicar eventos.

---

## Fuera de alcance de este plan (pendientes conocidos)

- **Sync masivo del padrón LDAP** — esperando que el equipo de directorio suba el `sizelimit`
  del bind de lectura. Ya avisados; sin fecha. El sync diario corre a las 03:00 y desde el fix
  `6701564` reporta honestamente si falla.
- **Sync Koha multi-biblioteca** — `KohaDbProvider` ya soporta ramas por biblioteca con
  gating, pero **está deliberadamente desconectado** en `providers.py`. Activarlo sin resolver
  la deduplicación fusionaría personas distintas: hay carnés repetidos entre bibliotecas para
  gente diferente. `borrowers` no tiene documento de identidad con el cual cruzar.
- **Etiqueta de cobertura parcial de facultad** en el dashboard (~86%, solo se puebla por el
  eje estudiante). Cosmético.
- **CORS abierto** (`allow_origins=["*"]`) sobre un `POST /api/scan` sin autenticación.
  Cualquiera que alcance el servidor puede inyectar eventos. Hoy está en LAN interna. Decisión
  pendiente del responsable.

---

## Orden recomendado y por qué

```
Fase 1 (identidad)  →  Fase 2 (fallo visible)  →  Fase 3 (campus)  →  Fase 4 (cola)
```

- La **1 antes que la 3** porque el campus cruzado necesita que el edificio sea confiable.
- La **2 antes que la 4** porque para encolar hay que detectar la desconexión de forma fiable,
  que es justo lo que construye la 2. Además la 2 arregla un fallo activo (el congelamiento con
  red lenta), no solo uno hipotético.
- La **3 antes que la 4** porque es lo que el usuario pidió originalmente y no depende de la
  cola. Si la 4 se pospone, la 3 ya entrega valor.

Cada fase debe quedar desplegada y verificada en producción antes de empezar la siguiente.
