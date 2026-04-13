import { useState, useEffect } from 'react'
import { ScanInput } from './components/ScanInput'
import { WelcomeScreen } from './components/WelcomeScreen'
import { OccupancyPanel } from './components/OccupancyPanel'

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
@media (max-width: 767px) {
  .kiosk-root { flex-direction: column !important; }
  .panel-left { flex: 0 0 60vh !important; width: 100% !important; border-right: none !important; border-bottom: 1px solid #1e293b !important; }
  .panel-right { flex: 0 0 40vh !important; width: 100% !important; }
}
`

export default function App() {
  const [state, setState] = useState<AppState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showError, setShowError] = useState(false)
  const [loading, setLoading] = useState(false)

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
        body: JSON.stringify({ cardnumber }),
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

  return (
    <div className="kiosk-root" style={styles.root}>
      <div className="panel-left" style={styles.left}>
        <OccupancyPanel />
      </div>

      <div className="panel-right" style={styles.right}>
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
    flex: '0 0 65%',
    overflow: 'hidden',
  },
  right: {
    flex: '0 0 35%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderLeft: '1px solid #1e293b',
    overflow: 'hidden',
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
    gap: '0.25rem',
  },
  clockTime: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#334155',
    fontVariantNumeric: 'tabular-nums',
  },
  clockDate: {
    fontSize: '0.75rem',
    color: '#334155',
    textTransform: 'capitalize',
  },
}
