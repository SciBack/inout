import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan: (cardnumber: string) => void
  disabled?: boolean
}

export function ScanInput({ onScan, disabled }: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Mantener el foco siempre en el input (modo kiosko)
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
    const val = e.target.value
    setValue(val)
    // Auto-submit cuando el lector de código termina (≥6 caracteres + Enter implícito por tiempo)
    if (val.length >= 6) {
      // Los lectores de barras envían Enter automáticamente
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim().length >= 4) {
      onScan(value.trim())
      setValue('')
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.scanIcon}>📷</div>
      <p style={styles.label}>Acerca o escanea tu carnet</p>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        style={styles.input}
        placeholder="Escanea o escribe tu código..."
        autoComplete="off"
        autoFocus
      />
      <p style={styles.hint}>Presiona Enter o usa el lector de código</p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    padding: '2rem',
  },
  scanIcon: {
    fontSize: '4rem',
  },
  label: {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: '#94a3b8',
    textAlign: 'center',
  },
  input: {
    width: '100%',
    maxWidth: '400px',
    padding: '1rem 1.5rem',
    fontSize: '1.25rem',
    borderRadius: '12px',
    border: '2px solid #334155',
    background: '#1e293b',
    color: '#f1f5f9',
    outline: 'none',
    textAlign: 'center',
    letterSpacing: '0.1em',
  },
  hint: {
    fontSize: '0.875rem',
    color: '#475569',
  },
}
