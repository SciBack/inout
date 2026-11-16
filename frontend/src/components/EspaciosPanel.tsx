import { memo, useEffect, useState } from 'react'

// Disponibilidad de salas (por piso) y del laboratorio de laptops del edificio, para la columna de
// estadísticas del kiosko. La lee de Discovery (/mi/api/salas/publico, ADR-004): estado de cada
// sala, sin datos de personas. Si no hay URL configurada o Discovery no responde, no se muestra.

type Sala = {
  nombre: string
  estado: 'libre' | 'formando' | 'ocupada' | 'termina' | 'tolerancia' | 'llamada'
  fin?: string | null
  tipo: 'individual' | 'grupal'
  capacidad?: number | null
  integrantes?: number
  minimo?: number
}
type Piso = { piso: string; salas: Sala[] }
type Laboratorio = { libres: number; total: number; cola: number; proxima?: string | null }
type Espacios = { ahora: string; pisos: Piso[]; laboratorio: Laboratorio | null }

const FONT_DISPLAY = "'Bebas Neue', 'Arial Narrow', impact, sans-serif"
const FONT_BODY = "'Barlow', system-ui, sans-serif"

const TONO: Record<Sala['estado'], { color: string; bg: string; borde: string }> = {
  libre:      { color: 'var(--c-green)', bg: 'color-mix(in oklch, var(--c-green) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-green) 45%, transparent)' },
  formando:   { color: 'var(--c-green)', bg: 'color-mix(in oklch, var(--c-green) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-green) 45%, transparent)' },
  ocupada:    { color: 'var(--c-red)',   bg: 'color-mix(in oklch, var(--c-red) 12%, transparent)',   borde: 'color-mix(in oklch, var(--c-red) 40%, transparent)' },
  termina:    { color: 'var(--c-amber)', bg: 'color-mix(in oklch, var(--c-amber) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-amber) 50%, transparent)' },
  tolerancia: { color: 'var(--c-amber)', bg: 'color-mix(in oklch, var(--c-amber) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-amber) 50%, transparent)' },
  llamada:    { color: 'var(--c-amber)', bg: 'transparent',                                          borde: 'color-mix(in oklch, var(--c-amber) 60%, transparent)' },
}

const hora = (iso?: string | null) => (iso ? iso.slice(11, 16) : '')
const corto = (n: string) => n.replace('Sala de Estudio', 'Sala').replace('Cubículo', 'Cub.')
const pisoBonito = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()

function estadoTexto(s: Sala): string {
  switch (s.estado) {
    case 'libre': return 'Libre'
    case 'formando': return `Grupo ${s.integrantes ?? 1}/${s.minimo ?? 3}`
    case 'termina': return `Termina ${hora(s.fin)}`
    case 'tolerancia': return 'Desocupando'
    case 'llamada': return 'Reservada'
    default: return `Hasta ${hora(s.fin)}`
  }
}

const SalaChip = memo(function SalaChip({ s }: { s: Sala }) {
  const t = TONO[s.estado] ?? TONO.ocupada
  return (
    <div style={{
      background: t.bg,
      border: `1px ${s.estado === 'llamada' ? 'dashed' : 'solid'} ${t.borde}`,
      borderRadius: 8,
      padding: 'clamp(6px,0.9vh,11px) clamp(8px,1vh,12px)',
      display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0,
    }} className={s.estado === 'termina' ? 'sala-titila' : undefined}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 'clamp(13px,1.75vh,21px)', color: 'var(--c-text1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {corto(s.nombre)}
      </span>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 'clamp(12px,1.45vh,17px)', color: t.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {estadoTexto(s)}
      </span>
    </div>
  )
})

const etiqueta: React.CSSProperties = {
  fontSize: 'clamp(11px,1.3vh,16px)', color: 'var(--c-text3)', textTransform: 'uppercase',
  letterSpacing: '0.12em', fontFamily: FONT_BODY, fontWeight: 600,
}
const tarjeta: React.CSSProperties = {
  background: 'var(--c-bg-panel)', border: '1px solid var(--c-border)', borderRadius: 14,
  padding: 'clamp(8px,1vh,14px) clamp(10px,1.2vh,16px)', display: 'flex', flexDirection: 'column',
  gap: 'clamp(6px,0.8vh,10px)',
}

export function EspaciosPanel({ url }: { url?: string | null }) {
  const [datos, setDatos] = useState<Espacios | null>(null)

  useEffect(() => {
    if (!url) { setDatos(null); return }
    let vivo = true
    const cargar = async () => {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } })
        if (r.ok && vivo) setDatos(await r.json())
        else if (vivo) setDatos(null)
      } catch { if (vivo) setDatos(null) }
    }
    cargar()
    const id = setInterval(cargar, 20000)
    return () => { vivo = false; clearInterval(id) }
  }, [url])

  if (!datos || !datos.pisos?.length) return null

  return (
    <>
      <style>{`@keyframes salaTitila { 50% { opacity: .5 } } .sala-titila { animation: salaTitila 1.2s ease-in-out infinite } @media (prefers-reduced-motion: reduce) { .sala-titila { animation: none } }`}</style>
      {datos.pisos.map((p) => {
        const libres = p.salas.filter((s) => s.estado === 'libre').length
        return (
          <div key={p.piso} style={tarjeta}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={etiqueta}>Salas · {pisoBonito(p.piso)}</span>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 'clamp(12px,1.4vh,17px)', color: libres ? 'var(--c-green)' : 'var(--c-text3)', fontVariantNumeric: 'tabular-nums' }}>
                {libres} de {p.salas.length} libres
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(96px,11vh,150px), 1fr))', gap: 'clamp(4px,0.6vh,8px)' }}>
              {p.salas.map((s) => <SalaChip key={s.nombre} s={s} />)}
            </div>
          </div>
        )
      })}
      {datos.laboratorio && (
        <div style={tarjeta}>
          <span style={etiqueta}>Laboratorio · laptops</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(30px,4.2vh,54px)', lineHeight: 1, color: datos.laboratorio.libres ? 'var(--c-green)' : 'var(--c-red)', fontVariantNumeric: 'tabular-nums' }}>
              {datos.laboratorio.libres}
            </span>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 'clamp(12px,1.4vh,17px)', color: 'var(--c-text2)' }}>
              de {datos.laboratorio.total} libres
              {datos.laboratorio.cola > 0 && ` · ${datos.laboratorio.cola} en cola`}
              {!datos.laboratorio.libres && datos.laboratorio.proxima && ` · se libera ${hora(datos.laboratorio.proxima)}`}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
