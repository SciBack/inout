import { useState } from 'react'
import {
  getVoicePreference,
  setVoicePreference,
  type VoicePreference,
} from '../utils/voicePreference'

// Interruptor de voz del terminal.
//
// Es binario, así que no lleva menú: un clic y ya. Mismo lenguaje visual que el
// selector de apariencia —solo icono, en la barra de staff— para que quien
// configura el kiosko encuentre juntos todos los ajustes del dispositivo, y
// quien pasa a escanear no se tropiece con ninguno.

const ICON_ON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
)

const ICON_OFF = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="m23 9-6 6M17 9l6 6" />
  </svg>
)

export default function VoiceToggle() {
  const [pref, setPref] = useState<VoicePreference>(getVoicePreference)
  const activa = pref === 'on'

  const alternar = () => {
    const nueva: VoicePreference = activa ? 'off' : 'on'
    setPref(nueva)
    setVoicePreference(nueva)

    // Al ENCENDER se confirma hablando. No es adorno: comprueba de una vez que
    // el terminal tiene altavoz, volumen y permiso del navegador, que es
    // precisamente lo que quien configura la pantalla necesita saber. Al apagar
    // el silencio ya es la confirmación.
    if (nueva === 'on' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const msg = new SpeechSynthesisUtterance('Voz activada')
      msg.lang = 'es-PE'
      msg.rate = 0.95
      msg.pitch = 1.1
      window.speechSynthesis.speak(msg)
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()   // cortar un saludo en curso
    }
  }

  return (
    <button
      className="vt-trigger"
      data-on={activa}
      onClick={alternar}
      role="switch"
      aria-checked={activa}
      aria-label={activa ? 'Saludo por voz activado. Desactivar' : 'Saludo por voz desactivado. Activar'}
      title={activa ? 'Saludo por voz: activado' : 'Saludo por voz: desactivado'}
    >
      {activa ? ICON_ON : ICON_OFF}
    </button>
  )
}

export const VOICE_TOGGLE_CSS = `
.vt-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  background: var(--c-bg-panel);
  border: 1.5px solid var(--c-border);
  border-radius: 11px;
  color: var(--c-text4);
  cursor: pointer;
  transition: color 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out;
}
/* Encendida se ve como estado normal; apagada queda apagada también en color,
   para que el estado se lea sin tener que interpretar el icono. */
.vt-trigger[data-on="true"] { color: var(--c-text2); }
.vt-trigger:active { transform: scale(0.97); }
@media (hover: hover) and (pointer: fine) {
  .vt-trigger:hover { color: var(--c-text1); border-color: var(--c-text4); }
}
`
