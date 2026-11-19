import { Component, memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import QRCode from 'qrcode'

// Disponibilidad de salas (por piso) y del laboratorio de laptops del edificio, para la columna de
// estadísticas del kiosko. La lee de Discovery (/mi/api/salas/publico, ADR-004): estado de cada
// sala, sin datos de personas. Si no hay URL configurada o Discovery no responde, no se muestra.

type Sala = {
  nombre: string
  estado: 'libre' | 'formando' | 'ocupada' | 'termina' | 'tolerancia' | 'llamada' | 'fuera'
  fin?: string | null
  tipo: 'individual' | 'grupal'
  capacidad?: number | null
  integrantes?: number
  minimo?: number
  expira?: string | null   // el grupo que se forma vence a esta hora (5 min)
  responsable?: string | null   // nombre corto («William P.»), de Discovery (19-nov-2026)
}
type Piso = { piso: string; salas: Sala[] }
type Laptop = { id: string; estado: 'libre' | 'llamada' | 'en_uso' | 'termina' | 'fuera'; fin?: string | null; responsable?: string | null }
type Laboratorio = { libres: number; total: number; cola: number; proxima?: string | null; puestos?: Laptop[] }
type Espacios = { ahora: string; pisos: Piso[]; laboratorio: Laboratorio | null; contingencia?: string }

const FONT_DISPLAY = "'Bebas Neue', 'Arial Narrow', impact, sans-serif"
const FONT_BODY = "'Barlow', system-ui, sans-serif"

const TONO: Record<Sala['estado'], { color: string; bg: string; borde: string }> = {
  libre:      { color: 'var(--c-green)', bg: 'color-mix(in oklch, var(--c-green) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-green) 45%, transparent)' },
  formando:   { color: 'var(--c-green)', bg: 'color-mix(in oklch, var(--c-green) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-green) 45%, transparent)' },
  ocupada:    { color: 'var(--c-red)',   bg: 'color-mix(in oklch, var(--c-red) 12%, transparent)',   borde: 'color-mix(in oklch, var(--c-red) 40%, transparent)' },
  termina:    { color: 'var(--c-amber)', bg: 'color-mix(in oklch, var(--c-amber) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-amber) 50%, transparent)' },
  tolerancia: { color: 'var(--c-amber)', bg: 'color-mix(in oklch, var(--c-amber) 14%, transparent)', borde: 'color-mix(in oklch, var(--c-amber) 50%, transparent)' },
  llamada:    { color: 'var(--c-amber)', bg: 'transparent',                                          borde: 'color-mix(in oklch, var(--c-amber) 60%, transparent)' },
  // Fuera de servicio (mantenimiento): gris, no se presta (18-nov-2026).
  fuera:      { color: 'var(--c-text3)', bg: 'color-mix(in oklch, var(--c-text3) 10%, transparent)',  borde: 'color-mix(in oklch, var(--c-text3) 35%, transparent)' },
}
// Un estado que esta pantalla aún no conoce no debe tumbarla (el 18-nov-2026 «fuera» la dejó en blanco):
// se pinta como ocupado.
const tono = (e: string) => TONO[e as Sala['estado']] ?? TONO.ocupada

// Late (aro que crece y se desvanece): un grupo formándose o una sala/laptop por liberarse (18-nov-2026).
const LATE = new Set<string>(['formando', 'termina', 'tolerancia'])
const pulso = (estado: string, color: string) =>
  LATE.has(estado) ? { className: 'sala-pulso', estilo: { ['--pulso' as string]: color } as CSSProperties } : { className: undefined, estilo: {} }

const hora = (iso?: string | null) => (iso ? iso.slice(11, 16) : '')
const corto = (n: string) => n.replace('Sala de Estudio', 'Sala').replace('Cubículo', 'Cub.')
const pisoBonito = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()

function estadoTexto(s: Sala): string {
  switch (s.estado) {
    case 'libre': return 'Libre'
    case 'formando': {
      // Cuenta regresiva: el grupo tiene 5 min para completarse (se refresca con los datos, cada 20 s).
      const seg = s.expira ? Math.max(0, (new Date(s.expira).getTime() - Date.now()) / 1000) : null
      const queda = seg === null ? '' : seg < 60 ? ' · <1 min' : ` · ${Math.ceil(seg / 60)} min`
      return `Grupo ${s.integrantes ?? 1}/${s.minimo ?? 3}${queda}`
    }
    case 'termina': return `Termina ${hora(s.fin)}`
    case 'tolerancia': return 'Desocupando'
    case 'llamada': return 'Reservada'
    case 'fuera': return 'Fuera de servicio'
    default: return s.fin ? `Hasta ${hora(s.fin)}` : 'En uso'
  }
}

// Versión corta para cuadraditos angostos (pantallas de 1024 px): la elige CSS según el ancho (@container).
function estadoCorto(s: Sala): string {
  switch (s.estado) {
    case 'libre': return 'Libre'
    case 'formando': {
      const seg = s.expira ? Math.max(0, (new Date(s.expira).getTime() - Date.now()) / 1000) : null
      return `${s.integrantes ?? 1}/${s.minimo ?? 3}${seg === null ? '' : seg < 60 ? '·<1′' : `·${Math.ceil(seg / 60)}′`}`
    }
    case 'termina': return `↓${hora(s.fin)}`
    case 'tolerancia': return 'Sale'
    case 'llamada': return 'Reserv.'
    case 'fuera': return 'Fuera'
    default: return s.fin ? hora(s.fin) : 'En uso'
  }
}

const SalaChip = memo(function SalaChip({ s }: { s: Sala }) {
  const t = tono(s.estado)
  const p = pulso(s.estado, t.color)
  return (
    <div style={{
      ...p.estilo,
      background: t.bg,
      border: `1px ${s.estado === 'llamada' ? 'dashed' : 'solid'} ${t.borde}`,
      borderRadius: 10,
      // Llena su celda de la grilla y el texto escala con el tamaño del cuadradito (19-nov-2026).
      containerType: 'size',
      padding: '6% 8%',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'clamp(1px,2cqh,6px)', minWidth: 0, minHeight: 0,
      overflow: 'hidden',
    }} className={p.className}>
      <span style={{ ...linea, fontWeight: 700, fontSize: 'clamp(12px,min(22cqh,16cqw),40px)', color: 'var(--c-text1)' }}>
        {corto(s.nombre)}
      </span>
      <span style={{ ...linea, fontWeight: 600, fontSize: 'clamp(11px,min(17cqh,13cqw),32px)', color: t.color, fontVariantNumeric: 'tabular-nums' }}>
        <span className="chip-largo">{estadoTexto(s)}</span><span className="chip-corto">{estadoCorto(s)}</span>
      </span>
      {s.responsable && s.estado !== 'libre' && (
        <span style={{ ...linea, fontWeight: 500, fontSize: 'clamp(10px,min(15cqh,12cqw),28px)', color: 'var(--c-text2)' }}>
          {s.responsable}
        </span>
      )}
    </div>
  )
})

const LAPTOP_LIBRE = {
  color: 'var(--c-cyan)',
  bg: 'color-mix(in oklch, var(--c-cyan) 14%, transparent)',
  borde: 'color-mix(in oklch, var(--c-cyan) 50%, transparent)',
}

const LaptopChip = memo(function LaptopChip({ p }: { p: Laptop }) {
  const estado: Sala['estado'] = p.estado === 'en_uso' ? 'ocupada' : p.estado
  // Las laptops libres van en celeste para no confundirlas con las salas (verde).
  const t = estado === 'libre' ? LAPTOP_LIBRE : estado === 'llamada' ? { ...LAPTOP_LIBRE, bg: 'transparent' } : tono(estado)
  const texto = p.estado === 'libre' ? 'Libre' : p.estado === 'llamada' ? 'Reserv.' : p.estado === 'fuera' ? 'Fuera'
    : p.fin ? hora(p.fin) : 'En uso'
  const pl = pulso(estado, t.color)
  return (
    <div className={pl.className} style={{
      ...pl.estilo,
      background: t.bg, border: `1px ${estado === 'llamada' ? 'dashed' : 'solid'} ${t.borde}`, borderRadius: 10,
      containerType: 'size',
      padding: 'clamp(2px,5cqh,10px) 4px', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 'clamp(0px,2cqh,4px)', minWidth: 0, minHeight: 0, overflow: 'hidden',
    }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(15px,min(38cqh,38cqw),64px)', lineHeight: 1, color: 'var(--c-text1)', flexShrink: 0 }}>
        {p.id.replace(/^LAB-0?/, '')}
      </span>
      <span style={{ ...linea, fontWeight: 600, fontSize: 'clamp(10px,min(17cqh,17cqw),26px)', color: t.color, fontVariantNumeric: 'tabular-nums', maxWidth: '100%' }}>
        {texto}
      </span>
      {p.responsable && p.estado !== 'libre' && (
        <span className="chip-quien" style={{ ...linea, fontWeight: 500, fontSize: 'clamp(9px,min(14cqh,15cqw),22px)', color: 'var(--c-text2)', maxWidth: '100%' }}>
          {p.responsable}
        </span>
      )}
    </div>
  )
})

// Pide una sala o una laptop: QR a «Su cuenta» de Discovery (salas y laptops se piden ahí).
function PedirCard({ url }: { url: string }) {
  const destino = new URL('/Cuenta/Cubiculos', url).toString()
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(destino, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
      .then(setSvg).catch(() => setSvg(''))
  }, [destino])
  const host = new URL(url).host
  const punto = (c: string) => ({ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block', marginRight: 6 })
  return (
    <div style={{ ...tarjeta, marginTop: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 'clamp(10px,1.4vh,18px)' }}>
      {svg && (
        <div aria-hidden style={{ background: '#fff', padding: 6, borderRadius: 8, width: 'clamp(64px,8.5vh,120px)', flexShrink: 0, lineHeight: 0 }}
             dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(4px,0.6vh,8px)', minWidth: 0 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 'clamp(14px,1.8vh,22px)', color: 'var(--c-text1)', lineHeight: 1.15 }}>
          Pida una sala o una laptop
        </span>
        <span style={{ fontFamily: FONT_BODY, fontSize: 'clamp(12px,1.45vh,17px)', color: 'var(--c-text2)', lineHeight: 1.3 }}>
          Escanee con su celular o entre a <b style={{ color: 'var(--c-text1)' }}>{host}</b> → Su cuenta
        </span>
        <span style={{ fontFamily: FONT_BODY, fontSize: 'clamp(11px,1.3vh,15px)', color: 'var(--c-text3)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span><i style={punto('var(--c-green)')} />Sala libre</span>
          <span><i style={punto('var(--c-cyan)')} />Laptop libre</span>
          <span><i style={punto('var(--c-red)')} />En uso</span>
          <span><i style={punto('var(--c-amber)')} />Termina pronto</span>
        </span>
      </div>
    </div>
  )
}

const etiqueta: React.CSSProperties = {
  fontSize: 'clamp(11px,1.3vh,16px)', color: 'var(--c-text3)', textTransform: 'uppercase',
  letterSpacing: '0.12em', fontFamily: FONT_BODY, fontWeight: 600,
}
const tarjeta: React.CSSProperties = {
  background: 'var(--c-bg-panel)', border: '1px solid var(--c-border)', borderRadius: 14,
  padding: 'clamp(8px,1vh,14px) clamp(10px,1.2vh,16px)', display: 'flex', flexDirection: 'column',
  gap: 'clamp(6px,0.8vh,10px)', minHeight: 0,
}
// Una línea de texto que nunca desborda su cuadradito.
const linea: React.CSSProperties = { fontFamily: FONT_BODY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.15, flexShrink: 0 }
// Grilla que llena el alto de su tarjeta: filas iguales que se estiran (19-nov-2026).
const grilla = (cols: number): React.CSSProperties => ({
  display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)',
  gap: 'clamp(4px,0.7vh,10px)', flex: '1 1 0', minHeight: 0,
})

// Red de seguridad: si este panel falla (p. ej. un dato nuevo de Discovery), se oculta solo él y el kiosko
// sigue marcando entradas. El 18-nov-2026 un estado desconocido dejaba toda la pantalla en blanco.
class SinCaida extends Component<{ children: ReactNode }, { roto: boolean }> {
  state = { roto: false }
  static getDerivedStateFromError() { return { roto: true } }
  componentDidCatch(e: unknown) { console.error('[espacios] panel oculto por un error', e) }
  render() { return this.state.roto ? null : this.props.children }
}

export function EspaciosPanel(props: { url?: string | null }) {
  return <SinCaida><EspaciosPanelInterno {...props} /></SinCaida>
}

function EspaciosPanelInterno({ url }: { url?: string | null }) {
  const [datos, setDatos] = useState<Espacios | null>(null)
  // Ancho real del panel: decide cuántas salas por fila (pantallas angostas o verticales: menos columnas).
  const caja = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(400)
  useEffect(() => {
    const el = caja.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [datos !== null])

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

  // Cada tarjeta se lleva del alto libre de la columna una parte proporcional a sus filas: las salas mandan.
  const COLS_SALAS = ancho >= 300 ? 4 : ancho >= 200 ? 3 : 2
  const COLS_LAB = ancho >= 200 ? 5 : 3
  const filas = (n: number, cols: number) => Math.max(1, Math.ceil(n / cols))
  return (
    <div ref={caja} style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'clamp(7px,0.9vh,12px)' }}>
      {datos.contingencia && datos.contingencia !== 'normal' && (
        <div role="status" style={{ ...tarjeta, borderColor: 'color-mix(in oklch, var(--c-amber) 60%, transparent)',
          background: 'color-mix(in oklch, var(--c-amber) 12%, var(--c-bg-panel))' }}>
          <span style={{ ...etiqueta, color: 'var(--c-amber)' }}>Modo contingencia</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 'clamp(13px,1.6vh,19px)', color: 'var(--c-text1)' }}>
            {datos.contingencia === 'corte'
              ? 'Para ocupar salas o laptops, pida el código del día al personal del CRAI.'
              : 'Salas y laptops se piden conectado a la red de la universidad.'}
          </span>
        </div>
      )}
      <style>{`@keyframes salaPulso { 0% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--pulso) 60%, transparent) } 70%, 100% { box-shadow: 0 0 0 9px transparent } } .sala-pulso { animation: salaPulso 1.6s cubic-bezier(.23,1,.32,1) infinite } @media (prefers-reduced-motion: reduce) { .sala-pulso { animation: none } } .chip-corto { display: none } @container (max-width: 96px) { .chip-largo { display: none } .chip-corto { display: inline } } @container (max-height: 64px) { .chip-quien { display: none } }`}</style>
      {datos.pisos.map((p) => {
        const libres = p.salas.filter((s) => s.estado === 'libre').length
        // Cada piso en dos bloques, solo para verlo: cubículos individuales y salas grupales (19-nov-2026).
        const bloques = [
          { titulo: 'Individuales', salas: p.salas.filter((s) => s.tipo === 'individual') },
          { titulo: 'Grupales', salas: p.salas.filter((s) => s.tipo !== 'individual') },
        ].filter((b) => b.salas.length)
        const filasDe = (n: number) => filas(n, Math.min(COLS_SALAS, n))
        return (
          <div key={p.piso} style={{ ...tarjeta, flex: `${bloques.reduce((a, b) => a + filasDe(b.salas.length), 0)} 1 0` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={etiqueta}>Salas · {pisoBonito(p.piso)}</span>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 'clamp(12px,1.4vh,17px)', color: libres ? 'var(--c-green)' : 'var(--c-text3)', fontVariantNumeric: 'tabular-nums' }}>
                {libres} de {p.salas.length} libres
              </span>
            </div>
            {bloques.map((b) => (
              <div key={b.titulo} style={{ flex: `${filasDe(b.salas.length)} 1 0`, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'clamp(3px,0.5vh,6px)' }}>
                {bloques.length > 1 && (
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 'clamp(10px,1.15vh,14px)', color: 'var(--c-text3)', flexShrink: 0 }}>
                    {b.titulo}
                  </span>
                )}
                <div style={grilla(Math.min(COLS_SALAS, b.salas.length))}>
                  {b.salas.map((s) => <SalaChip key={s.nombre} s={s} />)}
                </div>
              </div>
            ))}
          </div>
        )
      })}
      {datos.laboratorio && (
        <div style={{ ...tarjeta, flex: `${1.1 * filas(datos.laboratorio.puestos?.length ?? 1, COLS_LAB)} 1 0` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={etiqueta}>Laboratorio · laptops</span>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 'clamp(12px,1.4vh,17px)', color: datos.laboratorio.libres ? 'var(--c-cyan)' : 'var(--c-text3)', fontVariantNumeric: 'tabular-nums' }}>
              {datos.laboratorio.libres} de {datos.laboratorio.total} libres
              {datos.laboratorio.cola > 0 && ` · ${datos.laboratorio.cola} en cola`}
            </span>
          </div>
          {datos.laboratorio.puestos?.length ? (
            <div style={grilla(Math.min(COLS_LAB, datos.laboratorio.puestos.length))}>
              {datos.laboratorio.puestos.map((p) => <LaptopChip key={p.id} p={p} />)}
            </div>
          ) : (
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(30px,4.2vh,54px)', lineHeight: 1, color: datos.laboratorio.libres ? 'var(--c-green)' : 'var(--c-red)' }}>
              {datos.laboratorio.libres}
            </span>
          )}
          {!datos.laboratorio.libres && datos.laboratorio.proxima && (
            <span style={{ fontFamily: FONT_BODY, fontSize: 'clamp(12px,1.4vh,17px)', color: 'var(--c-text2)' }}>
              La próxima se libera a las {hora(datos.laboratorio.proxima)}
            </span>
          )}
        </div>
      )}
      <div style={{ flex: '0 0 auto' }}><PedirCard url={url!} /></div>
    </div>
  )
}
