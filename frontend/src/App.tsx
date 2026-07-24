import { useState, useEffect, useCallback, useRef } from 'react'
import { ScanInput } from './components/ScanInput'
import { WelcomeScreen } from './components/WelcomeScreen'
import { OccupancyPanel } from './components/OccupancyPanel'
import { AdminApp } from './components/admin/AdminApp'
import { HomeDashboard } from './pages/HomeDashboard'
import { useDayNightMode } from './hooks/useDayNightMode'
import { enqueueOfflineScan, flushOfflineQueue, getPendingCount } from './utils/offlineQueue'

// ── Routing: /admin → AdminApp, /kiosko → flujo de kiosko explícito ─────────
// La raíz "/" sin ?space= ni localStorage ya NO es la pantalla de selección
// de edificio: es el dashboard público (ver más abajo). "/kiosko" preserva el
// flujo de siempre para que un kiosko YA desplegado (bookmarked con ?space= o
// resuelto por localStorage en bare "/") no cambie de comportamiento, y para
// que el setup de un dispositivo NUEVO siga teniendo dónde elegir edificio.
const isAdmin = window.location.pathname.startsWith('/admin')
const isKiosko = window.location.pathname.startsWith('/kiosko')

// ── Space ID desde URL param o localStorage ──────────────────────────────────
function getSpaceId(): number | undefined {
  const param = new URLSearchParams(window.location.search).get('space')
  if (param) {
    const id = Number(param)
    if (!isNaN(id)) {
      localStorage.setItem('inout_space_id', String(id))
      return id
    }
  }
  const stored = localStorage.getItem('inout_space_id')
  return stored ? Number(stored) : undefined
}

type AppState = 'idle' | 'welcome'

interface ScanResult {
  event_type: string
  patron: {
    name: string
    firstname: string
    first_name: string
    gender: string
    category: string
    patron_id: number | null
  }
  message: string
  duration: string | null
  timestamp: string
}

interface SpaceInfo {
  id: number
  name: string
  capacity: number
  sede_code: string | null
  sede_name: string | null
  sede_latitude: number | null
  sede_longitude: number | null
}

const WELCOME_DURATION = 5000
const LEAVE_DURATION = 350

// Tokens de tema (modo noche = valores actuales del kiosko, sin cambios de
// look; modo día = mismo hue, reflejado a fondo claro con menos chroma en los
// extremos — ver reference/color-and-contrast.md del skill dataviz). El
// atributo data-theme lo pone App() según useDayNightMode(); cualquier
// componente puede consumir estas variables con var(--c-*) sin necesitar
// props ni tocar este archivo.
const THEME_CSS = `
:root {
  --c-bg: #0f172a;
  --c-bg-panel: oklch(15% 0.024 229);
  --c-border: oklch(25% 0.028 228);
  --c-text1: oklch(88% 0.010 222);
  --c-text2: oklch(78% 0.010 222);
  --c-text3: oklch(62% 0.012 222);
  --c-text4: oklch(40% 0.013 222);
  --c-green: oklch(73% 0.21 148);
  --c-amber: oklch(82% 0.17 76);
  --c-red: oklch(66% 0.24 25);
  --c-blue: oklch(68% 0.17 244);
  --c-rose: oklch(73% 0.17 352);
  --c-cyan: oklch(73% 0.18 211);
  --c-alert-icon: oklch(72% 0.19 55);
  --c-alert-title: oklch(88% 0.03 55);
  --c-alert-subtitle: oklch(62% 0.03 55);
}
:root[data-theme="day"] {
  --c-bg: oklch(97% 0.006 229);
  --c-bg-panel: oklch(99% 0.004 229);
  --c-border: oklch(88% 0.010 228);
  --c-text1: oklch(22% 0.014 222);
  --c-text2: oklch(36% 0.013 222);
  --c-text3: oklch(52% 0.014 222);
  --c-text4: oklch(66% 0.014 222);
  --c-green: oklch(48% 0.16 148);
  --c-amber: oklch(55% 0.15 76);
  --c-red: oklch(52% 0.20 25);
  --c-blue: oklch(45% 0.16 244);
  --c-rose: oklch(50% 0.16 352);
  --c-cyan: oklch(45% 0.15 211);
  --c-alert-icon: oklch(52% 0.17 55);
  --c-alert-title: oklch(30% 0.10 55);
  --c-alert-subtitle: oklch(46% 0.08 55);
}
`

const GLOBAL_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { overflow: hidden; background: var(--c-bg); transition: background 400ms ease; }
@keyframes feedSlideIn {
  from { opacity: 0; transform: translateY(-16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes metricPulse {
  0%, 100% { filter: brightness(1); }
  40%      { filter: brightness(1.7); }
}
@keyframes scanIdlePulse {
  0%, 100% { opacity: 0.2; transform: scale(1); }
  50%      { opacity: 0.45; transform: scale(1.06); }
}
@keyframes welcomeIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes welcomeOut {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-16px); }
}
@keyframes scanRing {
  0%   { transform: translate(-50%,-50%) scale(0.85); opacity: 0.55; }
  80%  { transform: translate(-50%,-50%) scale(1.75); opacity: 0; }
  100% { transform: translate(-50%,-50%) scale(1.75); opacity: 0; }
}
@keyframes cardFloat {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-9px); }
}
@keyframes welcomeNameIn {
  0%   { transform: scale(0.82); opacity: 0; }
  65%  { transform: scale(1.03); opacity: 1; }
  100% { transform: scale(1);    opacity: 1; }
}
@keyframes badgePop {
  0%   { transform: scale(0.7); opacity: 0; }
  70%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1);    opacity: 1; }
}
@keyframes promptPulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}
@keyframes badgeFloat {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-3px); }
}
@keyframes alertPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.6; transform: scale(1.08); }
}
@media (max-width: 767px) {
  .kiosk-root { flex-direction: column !important; }
  .panel-left { flex: 0 0 60vh !important; width: 100% !important; border-right: none !important; border-bottom: 1px solid var(--c-border) !important; }
  .panel-right { flex: 0 0 40vh !important; width: 100% !important; }
}
`

export default function App() {
  if (isAdmin) return <AdminApp />

  const urlSpaceId = getSpaceId()

  const [state, setState] = useState<AppState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showError, setShowError] = useState(false)
  const [queuedMsg, setQueuedMsg] = useState(false)
  const [loading, setLoading] = useState(false)

  // ── Estado de desconexión compartido ─────────────────────────────────────
  // Mecanismo ÚNICO para "el fetch nunca completó" (timeout/abort, red caída,
  // DNS, conexión rechazada), usado tanto por el escaneo (POST /api/scan)
  // como por la resolución de espacio (GET /api/spaces). NO es para respuestas
  // HTTP legítimas (400/404/429) — esas siguen su propio manejo de "error
  // normal" más abajo. Mientras esté activo, un único poller de
  // GET /api/health decide cuándo volvió la conexión.
  // OJO: en desarrollo, React 18 StrictMode monta → desmonta → vuelve a
  // montar cada efecto una vez (para detectar cleanups faltantes). Si este
  // efecto solo pusiera `= false` en el cleanup sin volver a poner `= true`
  // al montar, el segundo montaje quedaría con mountedRef.current en false
  // PARA SIEMPRE — cualquier fetch en vuelo se descartaría en silencio y la
  // UI se congela en "Cargando...". Por eso el mount también reafirma true.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const [connectionLost, setConnectionLost] = useState(false)

  // ── Fase 4: cola local de escaneos sin conexión (cero pérdida) ──────────
  // Independiente de connectionLost a propósito: si el kiosko se recarga con
  // ítems pendientes de una sesión anterior (crash, corte de luz) y la
  // conexión YA volvió, esto los reenvía sin esperar a un nuevo ciclo de
  // desconexión/reconexión que podría no volver a ocurrir nunca.
  const [pendingCount, setPendingCount] = useState(() => getPendingCount())
  const tryFlushQueue = useCallback(async () => {
    if (getPendingCount() === 0) return
    const { remaining } = await flushOfflineQueue()
    if (mountedRef.current) setPendingCount(remaining)
  }, [])
  useEffect(() => {
    tryFlushQueue()
  }, [tryFlushQueue])
  useEffect(() => {
    if (pendingCount === 0) return
    const intervalId = setInterval(tryFlushQueue, 15000)
    return () => clearInterval(intervalId)
  }, [pendingCount, tryFlushQueue])

  // ── Red de contención: si nadie configuró ?space= ni localStorage,
  // resolver contra GET /api/spaces (auto-selección si hay 1 solo, selector
  // si hay 2+, error si no hay ninguno). También sirve para mostrar el
  // nombre del edificio activo en el panel derecho, sin fetch adicional.
  const [spaces, setSpaces] = useState<SpaceInfo[] | null>(null)
  const [autoSpaceId, setAutoSpaceId] = useState<number | undefined>(undefined)

  const fetchSpaces = useCallback(async () => {
    // Primer paso: SOLO el fetch. Si esto lanza, la petición nunca completó
    // (red caída, DNS, conexión rechazada) — es la misma desconexión que
    // maneja el escaneo, mismo estado.
    let res: Response
    try {
      res = await fetch('/api/spaces')
    } catch {
      if (mountedRef.current) setConnectionLost(true)
      return
    }

    // El servidor SÍ respondió. Un status no-ok (500, etc.) es un problema
    // del backend, NO desconexión — no lo confundimos con "sin conexión" ni
    // seteamos connectionLost. Se queda "spaces" sin resolver y lo reintenta
    // el efecto de abajo, sin mentir sobre la causa.
    if (!res.ok) return

    let data: SpaceInfo[]
    try {
      data = await res.json()
    } catch {
      // 200 con body inválido: mismo trato — problema de datos, no de red.
      return
    }

    if (!mountedRef.current) return
    setSpaces(data)
    setConnectionLost(false)
    if (urlSpaceId === undefined && data.length === 1) {
      localStorage.setItem('inout_space_id', String(data[0].id))
      setAutoSpaceId(data[0].id)
    }
  }, [urlSpaceId])

  useEffect(() => {
    fetchSpaces()
  }, [fetchSpaces])

  // Reintento propio para "el servidor respondió pero con error" (o un body
  // inválido): NO pasa por connectionLost, así que necesita su propio timer
  // para no quedarse colgado para siempre. Se auto-cancela apenas spaces se
  // resuelve, o si un intento posterior sí falla por red (ahí toma la posta
  // el poller de abajo).
  useEffect(() => {
    if (spaces !== null || connectionLost) return
    const timeoutId = setTimeout(fetchSpaces, 10000)
    return () => clearTimeout(timeoutId)
  }, [spaces, connectionLost, fetchSpaces])

  // Poller único de salud: mientras haya desconexión activa (venga del
  // escaneo o de /api/spaces), sondear GET /api/health cada ~10s. Timeout
  // corto propio (4s) en cada intento — con red lenta pero "viva" no
  // queremos que cada sondeo cuelgue igual que colgaba el escaneo antes de
  // este fix. Al recibir 200: limpiar la desconexión y, si /api/spaces
  // nunca llegó a cargar (spaces === null), reintentarlo automáticamente.
  useEffect(() => {
    if (!connectionLost) return
    const intervalId = setInterval(() => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 4000)
      fetch('/api/health', { signal: controller.signal })
        .then(async res => {
          clearTimeout(timeoutId)
          if (!res.ok || !mountedRef.current) return
          // Vaciar la cola local ANTES de aceptar escaneos nuevos (Fase 4):
          // si esto quedara para el intervalo periódico independiente de
          // tryFlushQueue, un escaneo en vivo podría colarse antes de que
          // los pendientes salgan en su orden cronológico.
          await tryFlushQueue()
          if (!mountedRef.current) return
          setConnectionLost(false)
          if (spaces === null) {
            fetchSpaces()
          }
        })
        .catch(() => {
          clearTimeout(timeoutId)
          // sigue caído (o abortó por el timeout de 4s) — se reintenta en
          // el próximo tick de 10s
        })
    }, 10000)
    return () => clearInterval(intervalId)
  }, [connectionLost, spaces, fetchSpaces, tryFlushQueue])

  const spaceId = urlSpaceId ?? autoSpaceId
  const activeSpace = spaces?.find(sp => sp.id === spaceId)

  // El panel de inicio (dashboard público, sin espacio propio — abarca
  // todas las sedes) es siempre modo claro fijo: no es un kiosko con luz
  // ambiental real en la entrada de un edificio, es un panorama pensado
  // para verse en horario de oficina. El kiosko de un edificio sí sigue el
  // ciclo día/noche real de SU sede (ver useDayNightMode), para no
  // deslumbrar de noche en el lobby. Sin coordenadas cargadas en esa sede,
  // el hook cae a 'night' — mismo look oscuro que el kiosko siempre tuvo,
  // cero regresión.
  const showingHomeDashboard = spaceId === undefined && !isKiosko
  const dayNightMode = useDayNightMode(activeSpace?.sede_latitude ?? null, activeSpace?.sede_longitude ?? null)
  const theme = showingHomeDashboard ? 'day' : dayNightMode
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const changeBuilding = () => {
    localStorage.removeItem('inout_space_id')
    // Ir a /kiosko explícitamente: si esto quedara en bare "/", sin espacio
    // resuelto la raíz ahora muestra el dashboard público, no el selector.
    window.location.href = '/kiosko'
  }

  const selectBuilding = (id: number) => {
    localStorage.setItem('inout_space_id', String(id))
    window.location.reload()
  }

  // Inyectar CSS global una sola vez
  useEffect(() => {
    const existing = document.getElementById('inout-global-css')
    if (existing) return
    const style = document.createElement('style')
    style.id = 'inout-global-css'
    style.textContent = THEME_CSS + GLOBAL_CSS
    document.head.appendChild(style)
  }, [])

  // Timer welcome: iniciar salida animada, luego volver a idle
  useEffect(() => {
    if (state === 'welcome' && !isLeaving) {
      const leaveTimer = setTimeout(() => setIsLeaving(true), WELCOME_DURATION)
      return () => clearTimeout(leaveTimer)
    }
    if (isLeaving) {
      const idleTimer = setTimeout(() => {
        setState('idle')
        setIsLeaving(false)
      }, LEAVE_DURATION)
      return () => clearTimeout(idleTimer)
    }
  }, [state, isLeaving])

  // Error overlay temporal
  useEffect(() => {
    if (showError) {
      const t = setTimeout(() => setShowError(false), 2000)
      return () => clearTimeout(t)
    }
  }, [showError])

  // Aviso temporal de escaneo guardado sin conexión (Fase 4)
  useEffect(() => {
    if (queuedMsg) {
      const t = setTimeout(() => setQueuedMsg(false), 2000)
      return () => clearTimeout(t)
    }
  }, [queuedMsg])

  const handleScan = async (cardnumber: string) => {
    if (loading) return

    // Ya se sabe que no hay conexión: encolar directo, sin intentar el fetch
    // (Fase 4 — cero pérdida). No se puede saber si es entrada o salida, ni
    // mostrar el nombre, hasta que el backend lo resuelva en el reenvío.
    if (connectionLost) {
      enqueueOfflineScan(cardnumber, spaceId)
      setPendingCount(getPendingCount())
      setQueuedMsg(true)
      return
    }

    setLoading(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    // Primer try: SOLO el fetch en sí. Cualquier excepción acá significa que
    // la petición nunca completó (timeout/abort, red caída, DNS, conexión
    // rechazada) — es la única condición que cuenta como desconexión.
    let res: Response
    try {
      res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardnumber, space_id: spaceId ?? null }),
        signal: controller.signal,
      })
    } catch {
      clearTimeout(timeoutId)
      if (mountedRef.current) {
        setLoading(false)
        setConnectionLost(true)
        // El escaneo que disparó esta desconexión no se pierde: se encola
        // igual que cualquier otro mientras dure el corte.
        enqueueOfflineScan(cardnumber, spaceId)
        setPendingCount(getPendingCount())
        setQueuedMsg(true)
      }
      return
    }
    clearTimeout(timeoutId)

    // Segundo try: el fetch YA completó (el servidor respondió). Cualquier
    // problema de acá en adelante —incluido un body 200 mal formado— es un
    // problema del backend, NUNCA desconexión.
    try {
      if (res.ok) {
        const data = await res.json()
        if (!mountedRef.current) return
        setScanResult(data)
        setIsLeaving(false)
        setState('welcome')
      } else if (res.status === 429) {
        // Debounce silencioso
      } else if (res.status === 404) {
        if (mountedRef.current) {
          setErrorMsg('Carnet no encontrado')
          setShowError(true)
        }
      } else if (res.status === 502 || res.status === 503 || res.status === 504) {
        // 502/503/504 son códigos que FastAPI NUNCA emite por sí mismo — solo
        // los pone el proxy reverso (Nginx) cuando el proceso del backend no
        // responde. El fetch sí "completó" (por eso no cayó en el catch de
        // arriba), pero es la MISMA desconexión real que un fallo de red: el
        // proxy sigue arriba, la app caída. Sin este caso, un contenedor
        // caído con Nginx vivo perdía el escaneo en silencio — justo lo que
        // la cola offline (Fase 4) existe para evitar.
        if (mountedRef.current) {
          setConnectionLost(true)
          enqueueOfflineScan(cardnumber, spaceId)
          setPendingCount(getPendingCount())
          setQueuedMsg(true)
        }
      } else {
        // El fetch SÍ completó y el servidor respondió (400/otros) — es el
        // backend funcionando y diciendo que no, no una desconexión.
        if (mountedRef.current) {
          setErrorMsg('Error al procesar el carnet')
          setShowError(true)
        }
      }
    } catch {
      // El body no se pudo parsear pese a que el fetch sí completó. No es
      // desconexión: es un problema de datos, no de red.
      if (mountedRef.current) {
        setErrorMsg('Error al procesar el carnet')
        setShowError(true)
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const showWelcome = state === 'welcome' && scanResult !== null

  // ── Sin espacio resuelto todavía ─────────────────────────────────────────
  if (spaceId === undefined) {
    // Fuera de /kiosko: esto es una visita de navegador a la raíz pública,
    // no un dispositivo kiosko sin configurar. Es el nuevo dashboard.
    if (!isKiosko) {
      return <HomeDashboard />
    }
    if (connectionLost) {
      return <SpaceErrorScreen reason="connection" />
    }
    if (spaces !== null && spaces.length === 0) {
      return <SpaceErrorScreen reason="empty" />
    }
    if (spaces !== null && spaces.length >= 2) {
      return <SpaceSelectionScreen spaces={spaces} onSelect={selectBuilding} />
    }
    // Todavía cargando /api/spaces, o length===1 esperando a que se aplique el auto-select
    return <SpaceLoadingScreen />
  }

  return (
    <div className="kiosk-root" style={styles.root}>
      <div className="panel-left" style={styles.left}>
        <OccupancyPanel spaceId={spaceId} />
      </div>

      <div className="panel-right" style={styles.right}>
        {activeSpace && (
          <span style={styles.buildingBadge}>{activeSpace.name.toUpperCase()}</span>
        )}
        <button style={styles.changeBuildingBtn} onClick={changeBuilding}>
          Cambiar edificio
        </button>

        {/* Sin conexión NO deshabilita el lector: Fase 4 sigue aceptando
            escaneos y los encola en vez de perderlos. */}
        <ScanInput onScan={handleScan} disabled={loading || state === 'welcome'} />

        {showWelcome && (
          <WelcomeScreen result={scanResult!} isVisible={!isLeaving} />
        )}

        {showError && (
          <div style={styles.errorOverlay}>
            <span style={styles.errorText}>{errorMsg}</span>
          </div>
        )}

        {queuedMsg && (
          <div style={styles.errorOverlay}>
            <span style={{ ...styles.errorText, color: 'var(--c-alert-title)' }}>
              Guardado — sin conexión
            </span>
          </div>
        )}

        {loading && state === 'idle' && (
          <div style={styles.loadingOverlay}>Procesando...</div>
        )}

        {connectionLost && (
          <div style={styles.disconnectedOverlay}>
            <span style={styles.disconnectedIcon}>⚠</span>
            <span style={styles.disconnectedTitle}>Sin conexión con el servidor</span>
            <span style={styles.disconnectedSubtitle}>
              Los ingresos se están guardando en este dispositivo y se
              enviarán solos al reconectar — nada se pierde.
              {pendingCount > 0 && ` ${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}.`}
            </span>
          </div>
        )}

        <Clock />
      </div>
    </div>
  )
}

// ── Pantallas de resolución de espacio ──────────────────────────────────────
function SpaceLoadingScreen() {
  return (
    <div style={spaceStyles.screen}>
      <span style={spaceStyles.loadingText}>Cargando...</span>
    </div>
  )
}

function SpaceErrorScreen({ reason = 'empty' }: { reason?: 'empty' | 'connection' }) {
  if (reason === 'connection') {
    // /api/spaces no pudo completar el fetch (red caída) — NO es lo mismo
    // que "0 espacios activos" (fetch que sí completó). El poller de
    // /api/health reintenta /api/spaces solo, sin acción del usuario.
    return (
      <div style={spaceStyles.screen}>
        <div style={spaceStyles.card}>
          <span style={{ ...spaceStyles.errorIcon, animation: 'alertPulse 1.6s ease-in-out infinite' }}>⚠</span>
          <h1 style={spaceStyles.title}>Sin conexión, reintentando...</h1>
          <p style={spaceStyles.subtitle}>
            No se pudo contactar al servidor. Esta pantalla se actualizará sola al reconectar.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div style={spaceStyles.screen}>
      <div style={spaceStyles.card}>
        <span style={spaceStyles.errorIcon}>⚠</span>
        <h1 style={spaceStyles.title}>No hay edificios configurados</h1>
        <p style={spaceStyles.subtitle}>Contactar al administrador</p>
      </div>
    </div>
  )
}

function SpaceSelectionScreen({
  spaces, onSelect,
}: { spaces: SpaceInfo[]; onSelect: (id: number) => void }) {
  // Agrupar preservando el orden que ya entrega la API (sede_code, name)
  const groups: { key: string; label: string; items: SpaceInfo[] }[] = []
  for (const sp of spaces) {
    const key = sp.sede_code ?? '__sin_sede__'
    const label = sp.sede_name ?? 'Otros'
    let group = groups.find(g => g.key === key)
    if (!group) {
      group = { key, label, items: [] }
      groups.push(group)
    }
    group.items.push(sp)
  }

  return (
    <div style={spaceStyles.screen}>
      <div style={spaceStyles.card}>
        <h1 style={spaceStyles.title}>Selecciona tu edificio</h1>
        <p style={spaceStyles.subtitle}>Este kiosko quedará configurado para el espacio elegido</p>

        <div style={spaceStyles.groups}>
          {groups.map(group => (
            <div key={group.key} style={spaceStyles.group}>
              <span style={spaceStyles.groupLabel}>{group.label}</span>
              <div style={spaceStyles.groupItems}>
                {group.items.map(sp => (
                  <button
                    key={sp.id}
                    style={spaceStyles.spaceBtn}
                    onClick={() => onSelect(sp.id)}
                  >
                    {sp.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const spaceStyles: Record<string, React.CSSProperties> = {
  screen: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--c-bg)',
    padding: '2rem',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    maxWidth: '640px',
    width: '100%',
    textAlign: 'center',
  },
  title: {
    fontSize: 'clamp(20px,2.6vh,32px)',
    fontWeight: 700,
    color: 'var(--c-text1)',
    fontFamily: "'Barlow', sans-serif",
    letterSpacing: '0.02em',
  },
  subtitle: {
    fontSize: 'clamp(13px,1.6vh,18px)',
    color: 'var(--c-text3)',
    fontFamily: "'Barlow', sans-serif",
    marginBottom: '1.5rem',
  },
  errorIcon: {
    fontSize: 'clamp(32px,4vh,48px)',
    color: 'var(--c-red)',
    marginBottom: '0.5rem',
  },
  loadingText: {
    fontSize: 'clamp(14px,1.6vh,18px)',
    color: 'var(--c-text3)',
    fontFamily: "'Barlow', sans-serif",
  },
  groups: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    alignItems: 'center',
  },
  groupLabel: {
    fontSize: 'clamp(11px,1.3vh,14px)',
    color: 'var(--c-text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 600,
  },
  groupItems: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    justifyContent: 'center',
  },
  spaceBtn: {
    padding: '0.9rem 1.6rem',
    background: 'var(--c-bg-panel)',
    border: '1px solid var(--c-border)',
    borderRadius: '10px',
    color: 'var(--c-text1)',
    fontSize: 'clamp(14px,1.7vh,19px)',
    fontWeight: 600,
    fontFamily: "'Barlow', sans-serif",
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
  },
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={styles.clock}>
      <span style={styles.clockTime}>
        {time.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <span style={styles.clockDate}>
        {time.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}
      </span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--c-bg)',
  },
  left: {
    flex: '0 0 58.3%',
    overflow: 'hidden',
  },
  right: {
    flex: '0 0 41.7%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderLeft: '1px solid var(--c-border)',
    overflow: 'hidden',
  },
  buildingBadge: {
    position: 'absolute',
    top: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 'clamp(10px,1.1vh,13px)',
    fontWeight: 700,
    color: 'var(--c-text4)',
    letterSpacing: '0.14em',
    fontFamily: "'Barlow', sans-serif",
    userSelect: 'none',
    zIndex: 5,
  },
  changeBuildingBtn: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    background: 'transparent',
    border: 'none',
    color: 'var(--c-text4)',
    fontSize: 'clamp(10px,1.1vh,12px)',
    fontFamily: "'Barlow', sans-serif",
    letterSpacing: '0.04em',
    cursor: 'pointer',
    padding: '0.3rem 0.5rem',
    zIndex: 5,
  },
  errorOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15,23,42,0.92)',
    zIndex: 30,
    padding: '2rem',
  },
  errorText: {
    fontSize: '1.25rem',
    color: 'var(--c-red)',
    fontWeight: 600,
    textAlign: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    bottom: '5rem',
    fontSize: '1rem',
    color: 'var(--c-text4)',
  },
  // Alerta operativa persistente (no un toast): desconexión con el backend.
  // Se queda arriba de todo (incluido errorOverlay) hasta que el poller de
  // /api/health confirme que volvió la conexión.
  disconnectedOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    background: 'rgba(15,23,42,0.97)',
    border: '2px solid var(--c-alert-icon)',
    zIndex: 40,
    padding: '2rem',
    textAlign: 'center',
  },
  disconnectedIcon: {
    fontSize: 'clamp(28px,3.4vh,44px)',
    color: 'var(--c-alert-icon)',
    animation: 'alertPulse 1.6s ease-in-out infinite',
  },
  disconnectedTitle: {
    fontSize: 'clamp(16px,2vh,22px)',
    fontWeight: 700,
    color: 'var(--c-alert-title)',
    fontFamily: "'Barlow', sans-serif",
    letterSpacing: '0.02em',
  },
  disconnectedSubtitle: {
    fontSize: 'clamp(12px,1.4vh,16px)',
    color: 'var(--c-alert-subtitle)',
    fontFamily: "'Barlow', sans-serif",
    maxWidth: '420px',
  },
  clock: {
    position: 'absolute',
    bottom: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.2rem',
  },
  clockTime: {
    fontSize: 'clamp(28px,3.5vh,44px)' as unknown as undefined,
    fontWeight: 400,
    color: 'var(--c-text3)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.04em',
    fontFamily: "'Bebas Neue', cursive",
    lineHeight: 1,
  } as React.CSSProperties,
  clockDate: {
    fontSize: 'clamp(13px,1.5vh,18px)' as unknown as undefined,
    color: 'var(--c-text4)',
    textTransform: 'capitalize',
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 400,
    letterSpacing: '0.03em',
  } as React.CSSProperties,
}
