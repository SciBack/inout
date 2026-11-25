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

// La voz sale SIEMPRE del servidor (Piper, routers/tts.py), no del navegador.
// Con speechSynthesis cada terminal sonaba distinto según su sistema: la voz
// del Mac en un sitio, ninguna en los Linux del CRAI (Firefox sin
// speech-dispatcher calla sin dar error). Un audio normal suena igual en todos,
// como YouTube (24-nov-2026).

// Un solo reproductor: el saludo de quien escanea después pisa al anterior;
// dos personas seguidas no deben encolar saludos que suenen cuando ya pasaron.
let reproductor: HTMLAudioElement | null = null

// Sube al cambiar de voz en el servidor: el audio se cachea un día en el
// navegador y, sin esto, cada nombre ya oído seguiría con la voz anterior.
const VOZ_SERVIDOR = 'piper-claude'

/** Habla, si este terminal lo tiene habilitado. */
export function speak(text: string): void {
  if (!isVoiceEnabled()) return
  try {
    reproductor?.pause()
    reproductor = new Audio(`/api/tts?v=${VOZ_SERVIDOR}&text=${encodeURIComponent(text)}`)
    reproductor.play().catch(() => {
      // Sin altavoz o el navegador bloqueó la reproducción: el registro del
      // aforo no depende del saludo.
    })
  } catch {
    // idem
  }
}

/** Cortar un saludo en curso. */
export function silenciar(): void {
  reproductor?.pause()
}
