import { useState, useEffect } from 'react'
import { ScanInput } from './components/ScanInput'
import { WelcomeScreen } from './components/WelcomeScreen'
import { OccupancyPanel } from './components/OccupancyPanel'
import { AdminApp } from './components/admin/AdminApp'

// ── Routing: /admin → AdminApp ──────────────────────────────────────────────
const isAdmin = window.location.pathname.startsWith('/admin')

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
}

const WELCOME_DURATION = 5000
const LEAVE_DURATION = 350

const GLOBAL_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { overflow: hidden; background: #0f172a; }
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
@media (max-width: 767px) {
  .kiosk-root { flex-direction: column !important; }
  .panel-left { flex: 0 0 60vh !important; width: 100% !important; border-right: none !important; border-bottom: 1px solid #1e293b !important; }
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
  const [loading, setLoading] = useState(false)

  // ── Red de contención: si nadie configuró ?space= ni localStorage,
  // resolver contra GET /api/spaces (auto-selección si hay 1 solo, selector
  // si hay 2+, error si no hay ninguno). También sirve para mostrar el
  // nombre del edificio activo en el panel derecho, sin fetch adicional.
  const [spaces, setSpaces] = useState<SpaceInfo[] | null>(null)
  const [spacesFetchFailed, setSpacesFetchFailed] = useState(false)
  const [autoSpaceId, setAutoSpaceId] = useState<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetch('/api/spaces')
      .then(res => {
        if (!res.ok) throw new Error(`status ${res.status}`)
        return res.json()
      })
      .then((data: SpaceInfo[]) => {
        if (cancelled) return
        setSpaces(data)
        if (urlSpaceId === undefined && data.length === 1) {
          localStorage.setItem('inout_space_id', String(data[0].id))
          setAutoSpaceId(data[0].id)
        }
      })
      .catch(() => { if (!cancelled) setSpacesFetchFailed(true) })
    return () => { cancelled = true }
  }, [])

  const spaceId = urlSpaceId ?? autoSpaceId
  const activeSpace = spaces?.find(sp => sp.id === spaceId)

  const changeBuilding = () => {
    localStorage.removeItem('inout_space_id')
    window.location.reload()
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
    style.textContent = GLOBAL_CSS
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

  const handleScan = async (cardnumber: string) => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardnumber, space_id: spaceId ?? null }),
      })
      if (res.ok) {
        const data = await res.json()
        setScanResult(data)
        setIsLeaving(false)
        setState('welcome')
      } else if (res.status === 429) {
        // Debounce silencioso
      } else if (res.status === 404) {
        setErrorMsg('Carnet no encontrado')
        setShowError(true)
      } else {
        setErrorMsg('Error al procesar el carnet')
        setShowError(true)
      }
    } catch {
      setErrorMsg('Sin conexión con el servidor')
      setShowError(true)
    } finally {
      setLoading(false)
    }
  }

  const showWelcome = state === 'welcome' && scanResult !== null

  // ── Red de contención: sin espacio resuelto todavía ─────────────────────
  if (spaceId === undefined) {
    if (spacesFetchFailed || (spaces !== null && spaces.length === 0)) {
      return <SpaceErrorScreen />
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

        <ScanInput onScan={handleScan} disabled={loading || state === 'welcome'} />

        {showWelcome && (
          <WelcomeScreen result={scanResult!} isVisible={!isLeaving} />
        )}

        {showError && (
          <div style={styles.errorOverlay}>
            <span style={styles.errorText}>{errorMsg}</span>
          </div>
        )}

        {loading && state === 'idle' && (
          <div style={styles.loadingOverlay}>Procesando...</div>
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

function SpaceErrorScreen() {
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
    background: '#0f172a',
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
    color: 'oklch(88% 0.010 222)',
    fontFamily: "'Barlow', sans-serif",
    letterSpacing: '0.02em',
  },
  subtitle: {
    fontSize: 'clamp(13px,1.6vh,18px)',
    color: 'oklch(50% 0.013 222)',
    fontFamily: "'Barlow', sans-serif",
    marginBottom: '1.5rem',
  },
  errorIcon: {
    fontSize: 'clamp(32px,4vh,48px)',
    color: 'oklch(66% 0.24 25)',
    marginBottom: '0.5rem',
  },
  loadingText: {
    fontSize: 'clamp(14px,1.6vh,18px)',
    color: 'oklch(45% 0.013 222)',
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
    color: 'oklch(48% 0.014 222)',
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
    background: 'oklch(15% 0.024 229)',
    border: '1px solid oklch(25% 0.028 228)',
    borderRadius: '10px',
    color: 'oklch(88% 0.010 222)',
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
    background: '#0f172a',
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
    borderLeft: '1px solid #1e293b',
    overflow: 'hidden',
  },
  buildingBadge: {
    position: 'absolute',
    top: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 'clamp(10px,1.1vh,13px)',
    fontWeight: 700,
    color: 'oklch(40% 0.013 222)',
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
    color: 'oklch(32% 0.013 222)',
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
    color: '#ef4444',
    fontWeight: 600,
    textAlign: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    bottom: '5rem',
    fontSize: '1rem',
    color: '#475569',
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
    color: 'oklch(48% 0.016 222)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.04em',
    fontFamily: "'Bebas Neue', cursive",
    lineHeight: 1,
  } as React.CSSProperties,
  clockDate: {
    fontSize: 'clamp(13px,1.5vh,18px)' as unknown as undefined,
    color: 'oklch(36% 0.013 222)',
    textTransform: 'capitalize',
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 400,
    letterSpacing: '0.03em',
  } as React.CSSProperties,
}
