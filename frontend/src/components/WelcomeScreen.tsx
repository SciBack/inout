import { useEffect, useState } from 'react'

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
  const { event_type, patron, message, duration } = result
  const isEntry = event_type === 'entry'
  const [photoError, setPhotoError] = useState(false)

  const firstName = patron.first_name || patron.firstname.split(' ')[0]
  const photoUrl = patron.patron_id ? `/api/patron-photo/${patron.patron_id}` : null

  useEffect(() => {
    speak(message)
    setPhotoError(false)
  }, [message])

  const categoryLabel = CATEGORY_LABELS[patron.category] || patron.category

  return (
    <div style={{ ...styles.container, background: isEntry ? '#0d2137' : '#1a0d2e' }}>
      <div style={styles.eventBadge(isEntry)}>
        {isEntry ? '✓ INGRESO' : '← SALIDA'}
      </div>

      <div style={styles.avatarWrap}>
        {photoUrl && !photoError ? (
          <img
            src={photoUrl}
            alt={firstName}
            style={styles.photo}
            onError={() => setPhotoError(true)}
          />
        ) : (
          <span style={styles.avatarEmoji}>
            {patron.gender === 'F' ? '👩' : '👨'}
          </span>
        )}
      </div>

      <h1 style={styles.name}>{firstName}</h1>

      {categoryLabel && (
        <span style={styles.category}>{categoryLabel}</span>
      )}

      <p style={styles.message}>{message}</p>

      {duration && (
        <div style={styles.duration}>
          <span style={styles.durationLabel}>Tiempo en biblioteca</span>
          <span style={styles.durationValue}>{duration}</span>
        </div>
      )}

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
  avatarWrap: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1e293b',
    border: '3px solid #334155',
  },
  photo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarEmoji: {
    fontSize: '4rem',
    lineHeight: 1,
  },
  name: {
    fontSize: '2.5rem',
    fontWeight: 700,
    color: '#f1f5f9',
    textAlign: 'center',
    textTransform: 'capitalize',
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
  duration: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.1rem',
    padding: '0.5rem 1.5rem',
    background: '#1e293b',
    borderRadius: '0.75rem',
    border: '1px solid #334155',
  } as React.CSSProperties,
  durationLabel: {
    fontSize: '0.7rem',
    color: '#64748b',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  } as React.CSSProperties,
  durationValue: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#94a3b8',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  time: {
    fontSize: '3rem',
    fontWeight: 700,
    color: '#475569',
    marginTop: '0.5rem',
  },
}
