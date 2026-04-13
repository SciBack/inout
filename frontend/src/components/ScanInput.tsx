import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan: (cardnumber: string) => void
  disabled?: boolean
}

const CARD_SVG = (
  <svg
    width="48"
    height="32"
    viewBox="0 0 48 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <rect x="1" y="1" width="46" height="30" rx="4" stroke="#475569" strokeWidth="1.5" />
    <rect x="6" y="10" width="14" height="10" rx="1.5" stroke="#475569" strokeWidth="1.2" />
    <rect x="24" y="10" width="12" height="2" rx="1" fill="#475569" />
    <rect x="24" y="14" width="8" height="2" rx="1" fill="#334155" />
    <rect x="24" y="18" width="10" height="2" rx="1" fill="#334155" />
  </svg>
)

export function ScanInput({ onScan, disabled }: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Mantener foco en el input (modo kiosko)
  useEffect(() => {
    const keepFocus = () => {
      if (!disabled) inputRef.current?.focus()
    }
    keepFocus()
    document.addEventListener('click', keepFocus)
    const interval = setInterval(keepFocus, 2000)
    return () => {
      document.removeEventListener('click', keepFocus)
      clearInterval(interval)
    }
  }, [disabled])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim().length >= 4) {
      onScan(value.trim())
      setValue('')
    }
  }

  const handleClickVisible = () => {
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} style={styles.container} onClick={handleClickVisible}>
      {/* Input invisible — captura todo el input del lector */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        style={styles.hiddenInput}
        autoComplete="off"
        autoFocus
        aria-label="Entrada de escaneo"
      />

      {/* Visualización del estado */}
      <div style={styles.iconWrap}>
        <div style={styles.iconPulse}>
          {CARD_SVG}
        </div>
      </div>

      <p style={styles.label}>Acerca tu carnet al lector</p>
      <p style={styles.hint}>El lector de código funciona automáticamente</p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'clamp(10px,1.4vh,18px)',
    padding: '2rem',
    cursor: 'default',
    userSelect: 'none',
  },
  hiddenInput: {
    opacity: 0,
    position: 'absolute',
    pointerEvents: 'none',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  iconWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '0.5rem',
  },
  iconPulse: {
    animation: 'scanIdlePulse 3s ease-in-out infinite',
  },
  label: {
    fontSize: 'clamp(14px,1.7vh,20px)',
    fontWeight: 600,
    color: '#94a3b8',
    textAlign: 'center',
  },
  hint: {
    fontSize: 'clamp(11px,1.2vh,14px)',
    color: '#475569',
    textAlign: 'center',
  },
}
