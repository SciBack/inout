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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 11V3M7 3L3.5 6.5M7 3l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 3v8M7 11L3.5 7.5M7 11l3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function WelcomeScreen({ result, isVisible }: Props) {
  const { event_type, patron, message, duration } = result
  const isEntry = event_type === 'entry'
  const [photoError, setPhotoError] = useState(false)

  const firstName = patron.first_name || patron.firstname.split(' ')[0]
  const photoUrl = patron.patron_id ? `/api/patron-photo/${patron.patron_id}` : null

  useEffect(() => {
    const hour = new Date().getHours()
    const timeGreet = hour < 12 ? 'buenos días' : hour < 19 ? 'buenas tardes' : 'buenas noches'
    const audioText = isEntry
      ? (patron.gender === 'F' ? `Bienvenida, ${timeGreet}` : `Bienvenido, ${timeGreet}`)
      : timeGreet.charAt(0).toUpperCase() + timeGreet.slice(1)
    speak(audioText)
    setPhotoError(false)
  }, [message])

  const categoryLabel = CATEGORY_LABELS[patron.category] || patron.category

  const accentColor = isEntry
    ? 'oklch(73% 0.21 148)'
    : 'oklch(68% 0.18 295)'

  const accentGlow = isEntry
    ? 'oklch(11% 0.025 148)'
    : 'oklch(11% 0.022 295)'

  const accentBorder = isEntry
    ? 'oklch(73% 0.21 148 / 0.35)'
    : 'oklch(68% 0.18 295 / 0.35)'

  const accentBoxShadow = isEntry
    ? '0 0 0 3px oklch(73% 0.21 148 / 0.18), 0 0 28px oklch(73% 0.21 148 / 0.22)'
    : '0 0 0 3px oklch(68% 0.18 295 / 0.18), 0 0 28px oklch(68% 0.18 295 / 0.22)'

  const containerBg = isEntry
    ? `radial-gradient(ellipse at 50% 40%, ${accentGlow} 0%, oklch(7% 0.018 232) 65%)`
    : `radial-gradient(ellipse at 50% 40%, ${accentGlow} 0%, oklch(7% 0.018 232) 65%)`

  const animStyle: React.CSSProperties = isVisible
    ? { animation: 'welcomeIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards' }
    : { animation: 'welcomeOut 0.3s ease forwards' }

  const badgeStyle: React.CSSProperties = {
    ...s.badge,
    color: accentColor,
    border: `1px solid ${accentBorder}`,
    background: isEntry
      ? 'oklch(73% 0.21 148 / 0.10)'
      : 'oklch(68% 0.18 295 / 0.10)',
  }

  const avatarStyle: React.CSSProperties = {
    ...s.avatarWrap,
    border: `3px solid ${accentBorder}`,
    boxShadow: accentBoxShadow,
  }

  const initialsStyle: React.CSSProperties = {
    ...s.avatarInitials,
    color: accentColor,
  }

  return (
    <div style={{ ...s.container, background: containerBg, ...animStyle }}>

      {/* Badge evento */}
      <div style={badgeStyle}>
        <span style={s.badgeIcon}>
          {isEntry ? <ArrowUpIcon /> : <ArrowDownIcon />}
        </span>
        <span style={s.badgeText}>
          {isEntry ? 'INGRESO' : 'SALIDA'}
        </span>
      </div>

      {/* Avatar */}
      <div style={avatarStyle}>
        {photoUrl && !photoError ? (
          <img
            src={photoUrl}
            alt={firstName}
            style={s.photo}
            onError={() => setPhotoError(true)}
          />
        ) : (
          <span style={initialsStyle}>{getInitials(patron.name)}</span>
        )}
      </div>

      {/* Nombre */}
      <h1 style={s.name}>{firstName.toUpperCase()}</h1>

      {/* Categoría */}
      {categoryLabel && (
        <span style={s.category}>{categoryLabel}</span>
      )}

      {/* Mensaje */}
      <p style={s.message}>{message}</p>

      {/* Duración (solo en salida) */}
      {duration && (
        <div style={s.durationCard}>
          <span style={s.durationLabel}>TIEMPO EN BIBLIOTECA</span>
          <span style={s.durationValue}>{duration}</span>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'clamp(10px,1.6vh,20px)' as unknown as undefined,
    padding: '2rem',
  } as React.CSSProperties,
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    padding: '0.4rem 1.25rem',
    borderRadius: '999px',
    fontSize: 'clamp(11px,1.2vh,14px)' as unknown as undefined,
    fontWeight: 700,
    letterSpacing: '0.18em',
    fontFamily: "'Barlow', sans-serif",
    animation: 'badgePop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.1s both',
  } as React.CSSProperties,
  badgeIcon: {
    display: 'flex',
    alignItems: 'center',
  },
  badgeText: {
    lineHeight: 1,
  },
  avatarWrap: {
    width: 'clamp(130px,17vh,165px)' as unknown as undefined,
    height: 'clamp(130px,17vh,165px)' as unknown as undefined,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'oklch(10% 0.020 229)',
    animation: 'welcomeIn 0.5s cubic-bezier(0.22,1,0.36,1) 0.05s both',
    flexShrink: 0,
  } as React.CSSProperties,
  photo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarInitials: {
    fontSize: 'clamp(42px,7vh,72px)' as unknown as undefined,
    fontFamily: "'Bebas Neue', cursive",
    lineHeight: 1,
    letterSpacing: '0.03em',
  } as React.CSSProperties,
  name: {
    fontSize: 'clamp(54px,7.5vh,96px)' as unknown as undefined,
    fontWeight: 400,
    color: 'oklch(92% 0.008 220)',
    textAlign: 'center',
    fontFamily: "'Bebas Neue', cursive",
    letterSpacing: '0.04em',
    lineHeight: 1,
    animation: 'welcomeNameIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.18s both',
  } as React.CSSProperties,
  category: {
    fontSize: 'clamp(13px,1.5vh,18px)' as unknown as undefined,
    padding: '0.25rem 1rem',
    background: 'oklch(12% 0.020 229)',
    borderRadius: '999px',
    color: 'oklch(55% 0.014 222)',
    border: '1px solid oklch(20% 0.022 228)',
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 500,
    letterSpacing: '0.02em',
  } as React.CSSProperties,
  message: {
    fontSize: 'clamp(16px,2.0vh,24px)' as unknown as undefined,
    color: 'oklch(70% 0.010 222)',
    textAlign: 'center',
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 400,
    lineHeight: 1.4,
    maxWidth: '28ch',
  } as React.CSSProperties,
  durationCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.15rem',
    padding: '0.65rem 1.75rem',
    background: 'oklch(10% 0.020 229)',
    borderRadius: '12px',
    border: '1px solid oklch(20% 0.022 228)',
    marginTop: '0.25rem',
  } as React.CSSProperties,
  durationLabel: {
    fontSize: 'clamp(9px,0.9vh,11px)' as unknown as undefined,
    color: 'oklch(38% 0.012 222)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontFamily: "'Barlow', sans-serif",
    fontWeight: 600,
  } as React.CSSProperties,
  durationValue: {
    fontSize: 'clamp(32px,4.5vh,52px)' as unknown as undefined,
    fontWeight: 400,
    color: 'oklch(73% 0.18 211)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.04em',
    fontFamily: "'Bebas Neue', cursive",
    lineHeight: 1.1,
  } as React.CSSProperties,
}
