import { useState, useEffect } from 'react'
import { ScanInput } from './components/ScanInput'
import { WelcomeScreen } from './components/WelcomeScreen'
import { OccupancyPanel } from './components/OccupancyPanel'

type AppState = 'idle' | 'welcome' | 'error'

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
  timestamp: string
}

const WELCOME_DURATION = 5000 // 5 segundos mostrando bienvenida

export default function App() {
  const [state, setState] = useState<AppState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  // Volver a idle después de mostrar bienvenida
  useEffect(() => {
    if (state === 'welcome') {
      const timer = setTimeout(() => setState('idle'), WELCOME_DURATION)
      return () => clearTimeout(timer)
    }
    if (state === 'error') {
      const timer = setTimeout(() => setState('idle'), 3000)
      return () => clearTimeout(timer)
    }
  }, [state])

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
        setState('welcome')
      } else if (res.status === 404) {
        setErrorMsg('Carnet no encontrado')
        setState('error')
      } else {
        setErrorMsg('Error al procesar el carnet')
        setState('error')
      }
    } catch {
      setErrorMsg('Sin conexión con el servidor')
      setState('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.root}>
      {/* Panel izquierdo: escaneo o bienvenida */}
      <div style={styles.left}>
        {state === 'idle' && (
          <ScanInput onScan={handleScan} disabled={loading} />
        )}
        {state === 'welcome' && scanResult && (
          <WelcomeScreen result={scanResult} />
        )}
        {state === 'error' && (
          <div style={styles.errorBox}>
            <span style={styles.errorIcon}>⚠️</span>
            <p style={styles.errorText}>{errorMsg}</p>
          </div>
        )}
        {loading && state === 'idle' && (
          <div style={styles.loadingOverlay}>Procesando...</div>
        )}

        {/* Hora y fecha en pie */}
        <Clock />
      </div>

      {/* Panel derecho: dashboard aforo */}
      <div style={styles.right}>
        <OccupancyPanel />
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
    height: '100vh',
    background: '#0f172a',
  },
  left: {
    flex: '0 0 60%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderRight: '1px solid #1e293b',
  },
  right: {
    flex: '0 0 40%',
    background: '#0a1628',
    overflowY: 'auto',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    padding: '2rem',
  },
  errorIcon: {
    fontSize: '3rem',
  },
  errorText: {
    fontSize: '1.25rem',
    color: '#ef4444',
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
