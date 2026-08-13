// Preferencia de tema del dispositivo, elegida por el staff en el propio kiosko.
//
// Vive en localStorage y no en el servidor a propósito: es una propiedad del
// DISPOSITIVO, no de la institución ni de la persona. Dos kioskos del mismo
// campus pueden necesitar ajustes distintos — el del lobby acristalado recibe
// sol directo al mediodía, el del sótano no ve la luz nunca — y quien está
// parado delante es quien puede juzgarlo.

export type ThemePreference = 'dark' | 'light' | 'auto'
export type ResolvedTheme = 'night' | 'day'

const STORAGE_KEY = 'inout_theme'

// Oscuro por defecto: es el look con el que nació el kiosko y el que menos
// molesta en la entrada de un edificio. 'auto' sigue el amanecer real de la
// sede, pero solo si alguien lo pide — no es la opción segura por defecto,
// porque depende de que la sede tenga coordenadas cargadas.
const DEFAULT: ThemePreference = 'dark'

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light' || v === 'auto') return v
  } catch {
    // localStorage puede fallar (modo privado, almacenamiento lleno): el
    // kiosko debe seguir pintando, no quedarse en blanco por una preferencia.
  }
  return DEFAULT
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Sin persistencia el cambio dura hasta recargar. Aceptable: es una
    // preferencia de presentación, no un dato del aforo.
  }
}

/** Preferencia + lo que dictaría el ciclo solar → el tema que se pinta. */
export function resolveTheme(pref: ThemePreference, dayNight: ResolvedTheme): ResolvedTheme {
  if (pref === 'dark') return 'night'
  if (pref === 'light') return 'day'
  return dayNight
}
