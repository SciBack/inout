import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan: (cardnumber: string) => void
  disabled?: boolean
}

const CARD_SVG = (
  <svg width="48" height="32" viewBox="0 0 48 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
    <rect x="1" y="1" width="46" height="30" rx="4" stroke="#475569" strokeWidth="1.5" />
    <rect x="6" y="10" width="14" height="10" rx="1.5" stroke="#475569" strokeWidth="1.2" />
    <rect x="24" y="10" width="12" height="2" rx="1" fill="#475569" />
    <rect x="24" y="14" width="8" height="2" rx="1" fill="#334155" />
    <rect x="24" y="18" width="10" height="2" rx="1" fill="#334155" />
  </svg>
)

const KEYBOARD_SVG = (
  <svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="0.75" y="0.75" width="20.5" height="14.5" rx="2.25" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="3" y="3" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="6.5" y="3" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="10" y="3" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="13.5" y="3" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="17" y="3" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="3" y="6.5" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="6.5" y="6.5" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="10" y="6.5" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="13.5" y="6.5" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="17" y="6.5" width="2" height="2" rx="0.5" fill="currentColor"/>
    <rect x="5" y="10" width="12" height="2" rx="0.5" fill="currentColor"/>
  </svg>
)

export function ScanInput({ onScan, disabled }: Props) {
  const [value, setValue] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)

  // Mantener foco en el input oculto (modo kiosko) cuando no está abierto el manual
  useEffect(() => {
    if (manualOpen) return
    const keepFocus = () => { if (!disabled) inputRef.current?.focus() }
    keepFocus()
    const interval = setInterval(keepFocus, 2000)
    return () => clearInterval(interval)
  }, [disabled, manualOpen])

  // Enfocar el input manual al abrirlo
  useEffect(() => {
    if (manualOpen) {
      setManualValue('')
      setTimeout(() => manualRef.current?.focus(), 50)
    }
  }, [manualOpen])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim().length >= 4) {
      onScan(value.trim())
      setValue('')
    }
  }

  const submitManual = () => {
    const v = manualValue.trim()
    if (v.length >= 4) {
      setManualOpen(false)
      onScan(v)
    }
  }

  const handleManualKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submitManual()
    if (e.key === 'Escape') setManualOpen(false)
  }

  return (
    <div style={s.container}>
      {/* Input invisible — captura lector HID */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled || manualOpen}
        style={s.hiddenInput}
        autoComplete="off"
        aria-label="Entrada de escaneo"
      />

      {/* Estado idle */}
      <div style={s.iconWrap}>
        <div style={s.iconPulse}>{CARD_SVG}</div>
      </div>
      <p style={s.label}>Acerca tu carnet al lector</p>

      {/* Botón teclado */}
      <button
        style={s.kbdBtn}
        onClick={() => setManualOpen(true)}
        title="Ingresar número de carnet manualmente"
      >
        {KEYBOARD_SVG}
        <span>Ingresar manualmente</span>
      </button>

      {/* Modal de entrada manual */}
      {manualOpen && (
        <div style={s.overlay} onClick={() => setManualOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <p style={s.modalTitle}>Número de carnet</p>
            <input
              ref={manualRef}
              type="text"
              value={manualValue}
              onChange={e => setManualValue(e.target.value)}
              onKeyDown={handleManualKey}
              style={s.modalInput}
              placeholder="Ej: 202512345"
              autoComplete="off"
            />
            <div style={s.modalActions}>
              <button style={s.cancelBtn} onClick={() => setManualOpen(false)}>Cancelar</button>
              <button
                style={{ ...s.confirmBtn, opacity: manualValue.trim().length >= 4 ? 1 : 0.4 }}
                onClick={submitManual}
                disabled={manualValue.trim().length < 4}
              >
                Buscar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'clamp(10px,1.4vh,18px)',
    padding: '2rem',
    userSelect: 'none',
    position: 'relative',
  },
  hiddenInput: {
    opacity: 0,
    position: 'absolute',
    pointerEvents: 'none',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  iconWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.25rem' },
  iconPulse: { animation: 'scanIdlePulse 3s ease-in-out infinite' },
  label: { fontSize: 'clamp(14px,1.7vh,20px)', fontWeight: 600, color: '#94a3b8', textAlign: 'center' },
  kbdBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.5rem',
    padding: '0.45rem 1rem',
    background: 'transparent',
    border: '1px solid #1e293b',
    borderRadius: '8px',
    color: '#475569',
    fontSize: 'clamp(11px,1.2vh,13px)',
    cursor: 'pointer',
    transition: 'border-color 0.2s, color 0.2s',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    background: '#0d1f35',
    border: '1px solid #1e293b',
    borderRadius: '14px',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
    width: 'clamp(280px, 90%, 380px)',
  },
  modalTitle: { fontSize: '1.1rem', fontWeight: 600, color: '#f1f5f9', textAlign: 'center' },
  modalInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    background: '#0a1628',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f1f5f9',
    fontSize: '1.1rem',
    outline: 'none',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.05em',
  },
  modalActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '0.5rem 1.25rem',
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: '7px',
    color: '#64748b',
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  confirmBtn: {
    padding: '0.5rem 1.5rem',
    background: '#3b82f6',
    border: 'none',
    borderRadius: '7px',
    color: '#fff',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
}
