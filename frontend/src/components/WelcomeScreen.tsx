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
  isVisible: boolean
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

export function WelcomeScreen({ result, isVisible }: Props) {
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

  const animStyle: React.CSSProperties = isVisible
    ? { animation: 'welcomeIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards' }
    : { animation: 'welcomeOut 0.3s ease forwards' }

  return (
    <div style={{ ...styles.container, background: isEntry ? '#0d2137' : '#1a0d2e', ...animStyle }}>
      <div style={styles.eventBadge(isEntry)}>
        {isEntry ? '✓ INGRESO' : '← SALIDA'}
      </div>

      <div style={styles.avatarWrap(isEntry)}>
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
    </div>
  )
}

const styles: Record<string, any> = {
  container: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'clamp(10px,1.4vh,18px)',
    padding: '2rem',
  },
  eventBadge: (isEntry: boolean): React.CSSProperties => ({
    padding: '0.4rem 1.75rem',
    borderRadius: '999px',
    fontSize: 'clamp(12px,1.3vh,16px)',
    fontWeight: 700,
    letterSpacing: '0.15em',
    background: isEntry ? 'rgba(34,197,94,0.12)' : 'rgba(168,85,247,0.12)',
    color: isEntry ? '#22c55e' : '#a855f7',
    border: `1px solid ${isEntry ? '#22c55e' : '#a855f7'}`,
  }),
  avatarWrap: (isEntry: boolean): React.CSSProperties => ({
    width: 'clamp(90px,13vh,120px)',
    height: 'clamp(90px,13vh,120px)',
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1e293b',
    border: `3px solid ${isEntry ? '#22c55e40' : '#a855f740'}`,
  }),
  photo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarEmoji: {
    fontSize: 'clamp(36px,6vh,56px)',
    lineHeight: 1,
  },
  name: {
    fontSize: 'clamp(22px,3vh,32px)',
    fontWeight: 700,
    color: '#f1f5f9',
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  category: {
    fontSize: 'clamp(11px,1.2vh,14px)',
    padding: '0.2rem 0.9rem',
    background: '#1e293b',
    borderRadius: '999px',
    color: '#94a3b8',
  },
  message: {
    fontSize: 'clamp(14px,1.6vh,18px)',
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
    fontSize: 'clamp(9px,0.9vh,11px)',
    color: '#64748b',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  } as React.CSSProperties,
  durationValue: {
    fontSize: 'clamp(16px,2vh,22px)',
    fontWeight: 700,
    color: '#06b6d4',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
}
