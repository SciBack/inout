// ¿Qué tablero de aforo muestra este terminal?
//
//   esencial → aforo mínimo (cuánta gente hay, % del aforo, visitantes hoy) y
//              el carrusel de "Libros más prestados". Es el predeterminado.
//   completa → el tablero de siempre: perfiles, género, permanencia, hora
//              punta, otros campus y facultades. Sigue disponible por si hace
//              falta volver al instante.
//
// Se cambia con ?vista=completa (o ?vista=esencial) en la URL del kiosko y
// queda guardado en el dispositivo, igual que el edificio (?space=) — no hay
// que volver a ponerlo en cada arranque. "clasica" se acepta como sinónimo de
// "completa". Para restaurar todo el código de antes de este cambio:
//   git checkout dashboard-clasico-2026-10-28 -- frontend/src

export type PanelView = 'esencial' | 'completa'

const STORAGE_KEY = 'inout_panel_view'
const DEFAULT: PanelView = 'esencial'

function parse(raw: string | null): PanelView | null {
  const v = raw?.trim().toLowerCase()
  if (v === 'esencial') return 'esencial'
  if (v === 'completa' || v === 'clasica' || v === 'clásica') return 'completa'
  return null
}

export function getPanelView(): PanelView {
  const fromUrl = parse(new URLSearchParams(window.location.search).get('vista'))
  try {
    if (fromUrl) {
      localStorage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
    return parse(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT
  } catch {
    // Sin localStorage (modo privado, cuota llena) se respeta la URL si la hay.
    return fromUrl ?? DEFAULT
  }
}
