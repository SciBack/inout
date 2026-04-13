import { useEffect } from 'react'

interface ScanResult {
  event_type: string
  patron: {
    name: string
    firstname: string
    gender: string
    category: string
  }
  message: string
  timestamp: string
}

interface Props {
  result: ScanResult
}

const CATEGORY_LABELS: Record<string, string> = {
  ESTUDI: 'Estudiante',
  DOCEN: 'Docente',
  ADMIN: 'Administrativo',
  EXTERN: 'Externo',
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const msg = new SpeechSynthesisUtterance(text)
  msg.lang = 'es-PE'
  msg.rate = 0.95
  msg.pitch = 1.1
  window.speechSynthesis.speak(msg)
}

export function WelcomeScreen({ result }: Props) {
  const { event_type, patron, message } = result
  const isEntry = event_type === 'entry'
  const hour = new Date().getHours()
  const timeGreet = hour < 12 ? 'buenos días' : hour < 19 ? 'buenas tardes' : 'buenas noches'
  const fullMessage = isEntry
    ? `${message}, ${timeGreet}`
    : message

  useEffect(() => {
    speak(fullMessage)
  }, [fullMessage])

  const categoryLabel = CATEGORY_LABELS[patron.category] || patron.category

  return (
    <div style={{ ...styles.container, background: isEntry ? '#0d2137' : '#1a0d2e' }}>
      <div style={styles.eventBadge(isEntry)}>
        {isEntry ? '✓ INGRESO' : '← SALIDA'}
      </div>

      <div style={styles.avatar}>
        {patron.gender === 'F' ? '👩' : '👨'}
      </div>

      <h1 style={styles.name}>{patron.name}</h1>

      {categoryLabel && (
        <span style={styles.category}>{categoryLabel}</span>
      )}

      <p style={styles.message}>{fullMessage}</p>

      <div style={styles.time}>
        {new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

const styles: Record<string, any> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.25rem',
    padding: '2rem',
    height: '100%',
    transition: 'background 0.3s',
  },
  eventBadge: (isEntry: boolean): React.CSSProperties => ({
    padding: '0.5rem 2rem',
    borderRadius: '999px',
    fontSize: '1rem',
    fontWeight: 700,
    letterSpacing: '0.15em',
    background: isEntry ? '#22c55e20' : '#a855f720',
    color: isEntry ? '#22c55e' : '#a855f7',
    border: `1px solid ${isEntry ? '#22c55e' : '#a855f7'}`,
  }),
  avatar: {
    fontSize: '5rem',
    lineHeight: 1,
  },
  name: {
    fontSize: '2.5rem',
    fontWeight: 700,
    color: '#f1f5f9',
    textAlign: 'center',
  },
  category: {
    fontSize: '1rem',
    padding: '0.25rem 1rem',
    background: '#1e293b',
    borderRadius: '999px',
    color: '#94a3b8',
  },
  message: {
    fontSize: '1.5rem',
    color: '#cbd5e1',
    textAlign: 'center',
  },
  time: {
    fontSize: '3rem',
    fontWeight: 700,
    color: '#475569',
    marginTop: '0.5rem',
  },
}
