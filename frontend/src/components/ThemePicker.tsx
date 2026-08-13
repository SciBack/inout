import { useEffect, useRef, useState } from 'react'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../utils/themePreference'

// Selector de tema del kiosko.
//
// Solo icono, sin etiqueta: el visitante que pasa a escanear su carné no tiene
// por qué encontrarse un control de apariencia compitiendo con el edificio y el
// aforo, pero el staff que viene a ajustar la pantalla lo localiza al primer
// vistazo. Es el mismo criterio con el que "Cambiar edificio" vive escondido en
// el picker en vez de ocupar la barra.

const ICON_MOON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const ICON_SUN = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
)

const ICON_AUTO = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
  </svg>
)

const OPCIONES: { value: ThemePreference; label: string; hint: string; icon: JSX.Element }[] = [
  { value: 'dark',  label: 'Oscuro',     hint: 'Siempre en modo noche',        icon: ICON_MOON },
  { value: 'light', label: 'Claro',      hint: 'Siempre en modo día',          icon: ICON_SUN },
  { value: 'auto',  label: 'Automático', hint: 'Sigue el amanecer de la sede', icon: ICON_AUTO },
]

interface Props {
  /** Se llama al elegir; el contenedor decide cómo repintar. */
  onChange: (pref: ThemePreference) => void
}

export default function ThemePicker({ onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [pref, setPref] = useState<ThemePreference>(getThemePreference)
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar al hacer clic fuera o con Escape — mismo comportamiento que los
  // demás popovers de la barra, para que el staff no tenga que aprender dos.
  useEffect(() => {
    if (!open) return
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const elegir = (value: ThemePreference) => {
    setPref(value)
    setThemePreference(value)
    onChange(value)
    setOpen(false)
  }

  const actual = OPCIONES.find(o => o.value === pref) ?? OPCIONES[0]

  return (
    <div className="tp" ref={ref}>
      <button
        className="tp-trigger"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Apariencia: ${actual.label}. Cambiar`}
        title={`Apariencia: ${actual.label}`}
      >
        {actual.icon}
      </button>

      {open && (
        <div className="tp-menu" role="menu">
          <span className="tp-hint">Apariencia de esta pantalla</span>
          {OPCIONES.map(o => (
            <button
              key={o.value}
              className="tp-item"
              data-active={o.value === pref}
              role="menuitemradio"
              aria-checked={o.value === pref}
              onClick={() => elegir(o.value)}
            >
              <span className="tp-item-icon">{o.icon}</span>
              <span className="tp-item-text">
                <span className="tp-item-label">{o.label}</span>
                <span className="tp-item-hint">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Estilos co-ubicados, como el resto de pantallas de este frontend.
// El menú escala desde su disparador (arriba a la derecha), no desde el centro:
// un popover que crece desde donde lo abriste se lee como consecuencia del
// clic, no como algo que apareció por su cuenta.
export const THEME_PICKER_CSS = `
.tp { position: relative; }

.tp-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  background: var(--c-bg-panel);
  border: 1.5px solid var(--c-border);
  border-radius: 11px;
  color: var(--c-text3);
  cursor: pointer;
  transition: color 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out;
}
.tp-trigger:active { transform: scale(0.97); }
@media (hover: hover) and (pointer: fine) {
  .tp-trigger:hover { color: var(--c-text1); border-color: var(--c-text4); }
}

.tp-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  min-width: 244px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  background: var(--c-bg-panel);
  border: 1.5px solid var(--c-border);
  border-radius: 13px;
  box-shadow: 0 14px 34px rgba(0,0,0,.28);
  transform-origin: top right;
  animation: tp-in 150ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes tp-in {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .tp-menu { animation: none; }
}

.tp-hint {
  padding: 4px 10px 8px;
  color: var(--c-text4);
  font-family: 'Barlow', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .02em;
  text-transform: uppercase;
}

.tp-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 10px;
  background: none;
  border: none;
  border-radius: 9px;
  color: var(--c-text2);
  cursor: pointer;
  text-align: left;
  transition: background 140ms ease-out, color 140ms ease-out;
}
.tp-item:active { transform: scale(0.99); }
@media (hover: hover) and (pointer: fine) {
  .tp-item:hover { background: var(--c-bg); color: var(--c-text1); }
}
.tp-item[data-active="true"] { color: var(--c-blue); }
.tp-item-icon { display: flex; flex-shrink: 0; }
.tp-item-text { display: flex; flex-direction: column; gap: 1px; }
.tp-item-label {
  font-family: 'Barlow', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
}
.tp-item-hint {
  font-family: 'Barlow', sans-serif;
  font-size: 12.5px;
  color: var(--c-text4);
}
`
