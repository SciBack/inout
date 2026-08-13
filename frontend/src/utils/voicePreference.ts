// ¿Este terminal saluda en voz alta al escanear?
//
// Preferencia del DISPOSITIVO, igual que el edificio y la apariencia: el mismo
// producto se comporta distinto según dónde esté la pantalla. En el lobby del
// CRAI el saludo orienta a quien acaba de entrar; en un mostrador pegado a una
// sala de lectura, o donde el kiosko convive con personal trabajando, la misma
// voz repetida cada pocos segundos es una molestia. Quien instala el terminal
// es quien puede decidirlo.

export type VoicePreference = 'on' | 'off'

const STORAGE_KEY = 'inout_voice'

// Encendida por defecto: es como se comportó el kiosko desde siempre, así que
// un terminal ya desplegado no cambia solo al actualizar.
const DEFAULT: VoicePreference = 'on'

export function getVoicePreference(): VoicePreference {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'off') return 'off'
  } catch {
    // localStorage puede fallar (modo privado, cuota llena). Sin preferencia
    // legible se saluda, que es el comportamiento histórico.
  }
  return DEFAULT
}

export function setVoicePreference(pref: VoicePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Sin persistencia dura hasta recargar; no afecta al registro del aforo.
  }
}

export function isVoiceEnabled(): boolean {
  return getVoicePreference() === 'on'
}

/** Habla, si este terminal lo tiene habilitado y el navegador lo soporta. */
export function speak(text: string): void {
  if (!isVoiceEnabled()) return
  if (!('speechSynthesis' in window)) return
  // Cancelar lo anterior: dos personas escaneando seguido no deben encolar
  // saludos que suenen cuando ya pasaron: el segundo pisa al primero.
  window.speechSynthesis.cancel()
  const msg = new SpeechSynthesisUtterance(text)
  msg.lang = 'es-PE'
  msg.rate = 0.95
  msg.pitch = 1.1
  window.speechSynthesis.speak(msg)
}
