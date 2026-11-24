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

// ¿Tiene este navegador voces con las que hablar? Un Firefox de Linux sin
// speech-dispatcher expone speechSynthesis pero sin ninguna voz: speak() no
// falla, simplemente no suena (terminales del CRAI, 24-nov-2026). Chrome carga
// la lista de forma asíncrona, por eso se pide al cargar el módulo y se escucha
// voiceschanged; mientras esté vacía se usa el audio del servidor.
function navegadorTieneVoces(): boolean {
  return 'speechSynthesis' in window && window.speechSynthesis.getVoices().length > 0
}
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices())
}

// Un solo reproductor: el saludo de quien escanea después pisa al anterior,
// igual que cancel() con la voz del navegador.
let reproductor: HTMLAudioElement | null = null

function hablarConServidor(text: string): void {
  try {
    reproductor?.pause()
    reproductor = new Audio(`/api/tts?text=${encodeURIComponent(text)}`)
    reproductor.play().catch(() => {
      // Sin altavoz o el navegador bloqueó la reproducción: el registro del
      // aforo no depende del saludo.
    })
  } catch {
    // idem
  }
}

/** Habla, si este terminal lo tiene habilitado. */
export function speak(text: string): void {
  if (!isVoiceEnabled()) return
  if (!navegadorTieneVoces()) {
    hablarConServidor(text)
    return
  }
  // Cancelar lo anterior: dos personas escaneando seguido no deben encolar
  // saludos que suenen cuando ya pasaron: el segundo pisa al primero.
  window.speechSynthesis.cancel()
  const msg = new SpeechSynthesisUtterance(text)
  msg.lang = 'es-PE'
  msg.rate = 0.95
  msg.pitch = 1.1
  window.speechSynthesis.speak(msg)
}

/** Cortar un saludo en curso, venga de donde venga. */
export function silenciar(): void {
  reproductor?.pause()
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}
