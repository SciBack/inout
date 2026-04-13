import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan: (cardnumber: string) => void
  disabled?: boolean
}

const CARD_SVG = (
  <svg width="200" height="128" viewBox="0 0 60 38" fill="none">
    <rect x="0.5" y="0.5" width="59" height="37" rx="4"
      fill="oklch(16% 0.035 229)" stroke="oklch(55% 0.18 212 / 0.70)" strokeWidth="1.2"/>
    <rect x="0.5" y="0.5" width="59" height="6.5" rx="4"
      fill="oklch(67% 0.22 212 / 0.45)"/>
    <rect x="5" y="13" width="9.5" height="7" rx="1.5"
      stroke="oklch(72% 0.22 212 / 0.90)" strokeWidth="0.9"
      fill="oklch(67% 0.22 212 / 0.18)"/>
    <rect x="5" y="15.3" width="9.5" height="0.7" rx="0.3" fill="oklch(72% 0.22 212 / 0.70)"/>
    <rect x="5" y="17.3" width="9.5" height="0.7" rx="0.3" fill="oklch(72% 0.22 212 / 0.70)"/>
    <rect x="20" y="13" width="18" height="2.5" rx="1.2" fill="oklch(88% 0.010 222 / 0.90)"/>
    <rect x="20" y="17.5" width="13" height="1.8" rx="0.9" fill="oklch(65% 0.014 222 / 0.80)"/>
    <rect x="20" y="21" width="15" height="1.8" rx="0.9" fill="oklch(65% 0.014 222 / 0.80)"/>
    <rect x="5" y="30" width="50" height="2.5" rx="0.8" fill="oklch(22% 0.030 228)"/>
    <rect x="5" y="30" width="7" height="2.5" fill="oklch(72% 0.22 212 / 0.55)"/>
    <rect x="14" y="30" width="3" height="2.5" fill="oklch(72% 0.22 212 / 0.35)"/>
    <rect x="20" y="30" width="8" height="2.5" fill="oklch(72% 0.22 212 / 0.45)"/>
    <rect x="32" y="30" width="4" height="2.5" fill="oklch(72% 0.22 212 / 0.30)"/>
    <rect x="39" y="30" width="9" height="2.5" fill="oklch(72% 0.22 212 / 0.40)"/>
    <rect x="51" y="30" width="4" height="2.5" fill="oklch(72% 0.22 212 / 0.25)"/>
  </svg>
)

const KEYBOARD_SVG = (
  <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
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

  const ringPlayState = disabled ? 'paused' : 'running'

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

      {/* Scan zone con rings sonar + tarjeta flotante */}
      <div style={s.scanZone}>
        {[0, 0.85, 1.7].map(delay => (
          <div key={delay} style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            border: '1.5px solid oklch(72% 0.22 212 / 0.65)',
            animationName: 'scanRing',
            animationDuration: '2.55s',
            animationTimingFunction: 'ease-out',
            animationIterationCount: 'infinite',
            animationDelay: `${delay}s`,
            animationPlayState: ringPlayState,
            pointerEvents: 'none',
          } as React.CSSProperties} />
        ))}
        <div style={{
          animation: disabled ? 'none' : 'cardFloat 4s ease-in-out infinite',
          display: 'flex',
        }}>
          {CARD_SVG}
        </div>
      </div>

      {/* Texto prompt */}
      <div style={s.promptWrap}>
        <p style={s.promptMain}>Acerca tu carnet</p>
        <p style={s.promptSub}>al lector</p>
      </div>

      {/* Botón entrada manual — deshabilitado temporalmente */}
      {/* <button
        style={s.kbdBtn}
        onClick={() => setManualOpen(true)}
        title="Ingresar número de carnet manualmente"
      >
        {KEYBOARD_SVG}
        <span>Ingresar manualmente</span>
      </button> */}

      {/* Modal de entrada manual — deshabilitado temporalmente */}
      {/* {manualOpen && (
        <div style={s.overlay} onClick={() => setManualOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <p style={s.modalTitle}>Número de carnet</p>
            <p style={s.modalSubtitle}>Escribe el número e identificador del carnet</p>
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
      )} */}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'clamp(10px,1.4vh,18px)' as unknown as undefined,
    padding: '2rem',
    userSelect: 'none',
    position: 'relative',
  } as React.CSSProperties,
  hiddenInput: {
    opacity: 0,
    position: 'absolute',
    pointerEvents: 'none',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  scanZone: {
    position: 'relative',
    width: 'clamp(200px, 24vh, 260px)' as unknown as undefined,
    height: 'clamp(200px, 24vh, 260px)' as unknown as undefined,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'clamp(8px, 1vh, 16px)' as unknown as undefined,
  } as React.CSSProperties,
  promptWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.1rem',
  },
  promptMain: {
    fontSize: 'clamp(22px,2.8vh,34px)' as unknown as undefined,
    fontWeight: 700,
    color: 'oklch(92% 0.008 220)',
    textAlign: 'center',
    fontFamily: "'Barlow', sans-serif",
    lineHeight: 1.15,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    animation: 'promptPulse 2.4s ease-in-out infinite',
  } as React.CSSProperties,
  promptSub: {
    fontSize: 'clamp(15px,1.8vh,22px)' as unknown as undefined,
    fontWeight: 500,
    color: 'oklch(72% 0.010 222)',
    textAlign: 'center',
    fontFamily: "'Barlow', sans-serif",
    lineHeight: 1.2,
  } as React.CSSProperties,
  kbdBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.5rem',
    padding: '0.5rem 1.25rem',
    background: 'transparent',
    border: '1px solid oklch(22% 0.022 228)',
    borderRadius: '999px',
    color: 'oklch(40% 0.013 222)',
    fontSize: 'clamp(11px,1.2vh,13px)' as unknown as undefined,
    cursor: 'pointer',
    transition: 'border-color 0.2s, color 0.2s',
    fontFamily: "'Barlow', sans-serif",
  } as React.CSSProperties,
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'oklch(7% 0.018 232 / 0.75)',
    backdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    background: 'oklch(10% 0.020 229)',
    border: '1px solid oklch(22% 0.022 228)',
    borderRadius: '16px',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    width: 'clamp(300px, 90%, 400px)' as unknown as undefined,
    boxShadow: '0 24px 60px oklch(4% 0.015 230 / 0.8)',
  } as React.CSSProperties,
  modalTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: 'oklch(88% 0.010 222)',
    textAlign: 'center',
    fontFamily: "'Barlow', sans-serif",
  },
  modalSubtitle: {
    fontSize: '0.85rem',
    color: 'oklch(45% 0.013 222)',
    textAlign: 'center',
    fontFamily: "'Barlow', sans-serif",
    marginTop: '-0.4rem',
  },
  modalInput: {
    width: '100%',
    padding: '0.85rem 1.1rem',
    background: 'oklch(8% 0.018 230)',
    border: '1px solid oklch(25% 0.025 228)',
    borderRadius: '10px',
    color: 'oklch(88% 0.010 222)',
    fontSize: '1.2rem',
    outline: 'none',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.06em',
    fontFamily: "'Barlow', sans-serif",
  },
  modalActions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '0.55rem 1.25rem',
    background: 'transparent',
    border: '1px solid oklch(25% 0.025 228)',
    borderRadius: '8px',
    color: 'oklch(45% 0.013 222)',
    fontSize: '0.9rem',
    cursor: 'pointer',
    fontFamily: "'Barlow', sans-serif",
  },
  confirmBtn: {
    padding: '0.55rem 1.5rem',
    background: 'oklch(53% 0.20 212)',
    border: 'none',
    borderRadius: '8px',
    color: 'oklch(97% 0.005 220)',
    fontSize: '0.9rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Barlow', sans-serif",
  },
}
