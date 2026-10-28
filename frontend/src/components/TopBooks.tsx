// Libros más prestados — carrusel de portadas + ranking.
//
// Pensado para una pantalla que se mira de lejos y nadie toca: un libro en
// primer plano (portada grande, cuántas veces se prestó) que va pasando solo, y
// aparte el ranking del mismo periodo con el libro actual resaltado. Son dos
// piezas (TopBooksSpotlight y TopBooksRanking) que comparten useTopBooks. Recorre
// "hoy", "últimos 7 días" y "últimos 30 días", saltándose los periodos sin
// préstamos. Los datos vienen de GET /api/materials/top.

import { useEffect, useRef, useState } from 'react'

interface MaterialItem {
  rank: number
  biblio_id: number
  title: string
  author: string | null
  loans: number
  last_loan_at: string | null
  cover_url: string | null
}
interface MaterialPeriod {
  key: string
  label: string
  since: string
  total_loans: number
  items: MaterialItem[]
}
interface TopData {
  enabled: boolean
  as_of: string
  synced_at: string | null
  sync_error: string | null
  library_code: string | null
  periods: MaterialPeriod[]
}

const SLIDE_MS = 7000          // cuánto se queda cada libro en primer plano
const REFRESH_MS = 60_000      // el ranking cambia con cada préstamo, no cada segundo
const STALE_MS = 30 * 60_000   // pasado esto sin sincronizar, se avisa
const BOOKS_PER_PERIOD = 5

const C = {
  card:   'var(--c-bg-panel)',
  border: 'var(--c-border)',
  text1:  'var(--c-text1)',
  text2:  'var(--c-text2)',
  text3:  'var(--c-text3)',
  cyan:   'var(--c-cyan)',
  amber:  'var(--c-amber)',
}
const FONT_DISPLAY = "'Bebas Neue', 'Arial Narrow', impact, sans-serif"
const FONT_BODY    = "'Barlow', system-ui, sans-serif"

function fmtHour(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}

function loansLabel(n: number): string {
  return n === 1 ? 'préstamo' : 'préstamos'
}

// Tono estable por título: el mismo libro sin portada se ve siempre igual.
function hueOf(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

// ── Portada, o la tarjeta tipográfica cuando no hay ─────────────────────────
function BookCover({ item, tile }: { item: MaterialItem; tile?: 'big' | 'thumb' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.cover_url])

  if (item.cover_url && !failed) {
    return (
      <img
        src={item.cover_url}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    )
  }
  const hue = hueOf(item.title)
  const big = tile !== 'thumb'
  return (
    <div
      aria-hidden="true"
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        background: `linear-gradient(155deg, oklch(40% 0.08 ${hue}), oklch(26% 0.05 ${(hue + 24) % 360}))`,
        borderLeft: `${big ? 6 : 3}px solid oklch(62% 0.12 ${hue} / 0.55)`,
        padding: big ? 'clamp(10px,1.4vh,18px)' : 4,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        color: 'oklch(95% 0.01 90)', overflow: 'hidden',
      }}
    >
      <span style={{
        fontFamily: FONT_DISPLAY, letterSpacing: '0.03em', lineHeight: 1.02,
        fontSize: big ? 'clamp(17px,2.5vh,31px)' : 9,
        display: '-webkit-box', WebkitLineClamp: big ? 6 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        textTransform: 'uppercase',
      }}>
        {item.title}
      </span>
      {big && item.author && (
        <span style={{
          fontFamily: FONT_BODY, fontSize: 'clamp(11px,1.45vh,17px)', opacity: 0.78,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {item.author}
        </span>
      )}
    </div>
  )
}

// ── Estado compartido ───────────────────────────────────────────────────────
// La portada en primer plano y el ranking viven en columnas distintas del
// tablero; los dos leen este mismo estado para ir sincronizados.
export interface TopBooksState {
  data: TopData
  periods: MaterialPeriod[]
  pi: number
  period: MaterialPeriod | undefined
  books: MaterialItem[]
  si: number
  current: MaterialItem | undefined
  totalSlides: number
  stale: boolean
}

export function useTopBooks(spaceId?: number): TopBooksState | null {
  const [data, setData] = useState<TopData | null>(null)
  const [pIdx, setPIdx] = useState(0)   // periodo en pantalla
  const [sIdx, setSIdx] = useState(0)   // libro en primer plano dentro del periodo
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const ctrl = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(spaceId ? `/api/materials/top?space_id=${spaceId}` : '/api/materials/top', { signal: ctrl.signal })
        if (res.ok && alive.current) setData(await res.json())
      } catch { /* sin red: se queda con lo último que llegó */ }
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { alive.current = false; ctrl.abort(); clearInterval(id) }
  }, [spaceId])

  const periods = (data?.periods ?? []).filter(p => p.items.length > 0)
  const pi = Math.min(pIdx, Math.max(0, periods.length - 1))
  const period = periods[pi]
  const books = period ? period.items.slice(0, BOOKS_PER_PERIOD) : []
  const si = Math.min(sIdx, Math.max(0, books.length - 1))
  const current = books[si]
  const totalSlides = periods.reduce((n, p) => n + Math.min(p.items.length, BOOKS_PER_PERIOD), 0)

  // Avance automático: al agotar los libros de un periodo pasa al siguiente.
  useEffect(() => {
    if (totalSlides < 2) return
    const id = window.setTimeout(() => {
      if (si + 1 < books.length) {
        setSIdx(si + 1)
      } else {
        setPIdx((pi + 1) % periods.length)
        setSIdx(0)
      }
    }, SLIDE_MS)
    return () => clearTimeout(id)
  }, [pi, si, books.length, periods.length, totalSlides])

  if (!data || !data.enabled) return null
  const stale = !!data.sync_error
    || (!!data.synced_at && Date.now() - new Date(data.synced_at).getTime() > STALE_MS)
  return { data, periods, pi, period, books, si, current, totalSlides, stale }
}

// ── Libro en primer plano ───────────────────────────────────────────────────
export function TopBooksSpotlight({ tb }: { tb: TopBooksState | null }) {
  if (!tb) return null
  const { data, periods, pi, period, books, current, totalSlides, stale } = tb
  const slideKey = current && period ? `${period.key}:${current.biblio_id}` : 'vacio'

  return (
    <section style={st.section} aria-label="Libros más prestados">
      <style>{CSS}</style>

      <header style={st.head}>
        <span style={st.label}>Libros más prestados</span>
        <div style={st.pills} aria-hidden="true">
          {periods.map((p, i) => (
            <span key={p.key} className="tb-pill" data-active={i === pi} style={st.pill}>
              {p.label}
            </span>
          ))}
        </div>
      </header>

      {!current || !period ? (
        <div style={st.empty}>
          <span style={st.emptyTitle}>Aún no hay préstamos para mostrar</span>
          <span style={st.emptySub}>Aparecerán aquí a medida que se presten libros.</span>
        </div>
      ) : (
        <>
          <div key={slideKey} style={st.spot} role="group" aria-roledescription="carrusel"
               aria-label={`${current.rank} de ${books.length}: ${current.title}`}>
            <div className="tb-cover" style={st.coverBox}>
              <BookCover item={current} />
            </div>
            <div className="tb-text" style={st.spotText}>
              <span style={st.rankTag}>
                #{current.rank} · {period.label}
              </span>
              <span style={st.title}>{current.title}</span>
              {current.author && <span style={st.author}>{current.author}</span>}
              <span style={st.count}>
                <span style={st.countNum}>{current.loans}</span>
                <span style={st.countUnit}>{loansLabel(current.loans)}</span>
              </span>
              <span style={st.total}>
                de {period.total_loans} {loansLabel(period.total_loans)} {period.key === 'day' ? 'hoy' : 'en el periodo'}
              </span>
            </div>
          </div>

          {totalSlides > 1 && (
            <div style={st.progressTrack} aria-hidden="true">
              <div key={slideKey} className="tb-progress" style={st.progressBar} />
            </div>
          )}
        </>
      )}

      {data.synced_at && (
        <footer style={{ ...st.foot, color: stale ? C.amber : C.text3 }}>
          {stale
            ? `Sin conexión con Koha · datos de las ${fmtHour(data.synced_at)}`
            : `Actualizado ${fmtHour(data.synced_at)} · préstamos de Koha`}
        </footer>
      )}
    </section>
  )
}

// ── Ranking del periodo, con el libro en primer plano resaltado ─────────────
export function TopBooksRanking({ tb }: { tb: TopBooksState | null }) {
  if (!tb || !tb.period || tb.books.length === 0) return null
  const { period, books, si } = tb
  const topLoans = books[0]?.loans ?? 1

  return (
    <section style={st.rankSection} aria-label={`Ranking de libros · ${period.label}`}>
      <style>{CSS}</style>
      <header style={st.head}>
        <span style={st.label}>Más prestados · {period.label}</span>
      </header>
      <ol style={st.list}>
        {books.map((b, i) => (
          <li key={b.biblio_id} className="tb-row" data-active={i === si} style={st.row}>
            <span style={st.rowRank}>{b.rank}</span>
            <span style={st.thumb}><BookCover item={b} tile="thumb" /></span>
            <span style={st.rowTitle}>{b.title}</span>
            <span style={st.rowBar} aria-hidden="true">
              <span style={{ ...st.rowBarFill, width: `${Math.max(8, (b.loans / topLoans) * 100)}%` }} />
            </span>
            <span style={st.rowLoans}>{b.loans}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ── Estilos ─────────────────────────────────────────────────────────────────
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

// Animación solo de opacidad/transform (+ un blur mínimo para fundir el cambio
// de portada). Entra rápido y con ease-out; el avance automático es lento, así
// que no hay riesgo de que se interrumpan unas a otras.
const CSS = `
@keyframes tb-in {
  from { opacity: 0; transform: translateY(10px) scale(0.985); filter: blur(3px); }
  to   { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes tb-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tb-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

.tb-cover { animation: tb-in 320ms ${EASE_OUT} both; }
.tb-text > * { animation: tb-in 320ms ${EASE_OUT} both; }
.tb-text > *:nth-child(2) { animation-delay: 40ms; }
.tb-text > *:nth-child(3) { animation-delay: 80ms; }
.tb-text > *:nth-child(4) { animation-delay: 120ms; }
.tb-text > *:nth-child(5) { animation-delay: 160ms; }
.tb-progress { animation: tb-fill ${SLIDE_MS}ms linear both; transform-origin: left center; }

.tb-pill { transition: background-color 200ms ease, color 200ms ease; }
.tb-pill[data-active="true"] { background: oklch(73% 0.18 211 / 0.16); color: var(--c-cyan); }
.tb-row { transition: background-color 200ms ease; }
.tb-row[data-active="true"] { background: oklch(73% 0.18 211 / 0.10); box-shadow: inset 3px 0 0 var(--c-cyan); }

@media (prefers-reduced-motion: reduce) {
  .tb-cover, .tb-text > * { animation: tb-fade 200ms ease both; animation-delay: 0ms !important; }
  .tb-progress { animation: none; transform: scaleX(1); opacity: 0.35; }
}
`

const st: Record<string, React.CSSProperties> = {
  section: {
    flex: '1 1 auto', minHeight: 0,
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
    padding: 'clamp(9px,1.2vh,16px) clamp(11px,1.4vh,18px)',
    display: 'flex', flexDirection: 'column', gap: 'clamp(7px,1vh,13px)',
    overflow: 'hidden', fontFamily: FONT_BODY,
  },
  rankSection: {
    flex: '1 1 auto', minHeight: 0,
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
    padding: 'clamp(9px,1.2vh,16px) clamp(11px,1.4vh,18px)',
    display: 'flex', flexDirection: 'column', gap: 'clamp(6px,0.9vh,11px)',
    overflow: 'hidden', fontFamily: FONT_BODY,
  },
  head: { flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  label: {
    fontSize: 'clamp(11px,1.3vh,16px)', color: C.text3, textTransform: 'uppercase',
    letterSpacing: '0.12em', fontWeight: 600,
  },
  pills: { display: 'flex', gap: 4 },
  pill: {
    fontSize: 'clamp(10px,1.2vh,14px)', fontWeight: 600, color: C.text3,
    padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
  },

  spot: { flex: '1 1 auto', minHeight: 0, display: 'flex', gap: 'clamp(14px,2vh,28px)', alignItems: 'center', minWidth: 0 },
  coverBox: {
    flex: '0 0 auto', height: 'clamp(200px,46vh,560px)', maxHeight: '100%', aspectRatio: '2 / 3',
    borderRadius: 6, overflow: 'hidden', background: 'oklch(22% 0.02 230)',
    boxShadow: '0 10px 28px oklch(0% 0 0 / 0.38), 0 0 0 1px oklch(100% 0 0 / 0.06)',
  },
  spotText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'clamp(3px,0.6vh,8px)' },
  rankTag: { fontSize: 'clamp(11px,1.4vh,17px)', color: C.cyan, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
  title: {
    fontSize: 'clamp(22px,3.6vh,46px)', color: C.text1, fontWeight: 700, lineHeight: 1.1,
    display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  author: {
    fontSize: 'clamp(13px,1.7vh,21px)', color: C.text2,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  count: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'clamp(2px,0.6vh,8px)' },
  countNum: { fontFamily: FONT_DISPLAY, fontSize: 'clamp(40px,6.4vh,84px)', lineHeight: 0.9, color: C.text1, fontVariantNumeric: 'tabular-nums' },
  countUnit: { fontSize: 'clamp(13px,1.8vh,22px)', color: C.text2, fontWeight: 600 },
  total: { fontSize: 'clamp(11px,1.35vh,16px)', color: C.text3 },

  progressTrack: { flex: '0 0 auto', height: 3, borderRadius: 2, background: C.border, overflow: 'hidden' },
  progressBar: { height: '100%', background: C.cyan },

  list: { flex: '1 1 auto', minHeight: 0, overflow: 'hidden', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 },
  row: {
    display: 'flex', alignItems: 'center', gap: 'clamp(7px,1vh,12px)', flexShrink: 0,
    padding: 'clamp(3px,0.5vh,7px) clamp(6px,0.8vh,10px)', borderRadius: 8,
  },
  rowRank: { width: '1.4em', textAlign: 'center', fontFamily: FONT_DISPLAY, fontSize: 'clamp(16px,2.2vh,28px)', color: C.text3 },
  thumb: {
    flex: '0 0 auto', width: 'clamp(30px,4.6vh,56px)', aspectRatio: '2 / 3', borderRadius: 3, overflow: 'hidden',
    background: 'oklch(22% 0.02 230)',
  },
  rowTitle: {
    flex: 1, minWidth: 0, fontSize: 'clamp(13px,1.75vh,22px)', color: C.text1, fontWeight: 500, lineHeight: 1.2,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  rowBar: { flex: '0 0 18%', height: 5, borderRadius: 3, background: C.border, overflow: 'hidden' },
  rowBarFill: { display: 'block', height: '100%', borderRadius: 3, background: C.cyan, opacity: 0.8 },
  rowLoans: { width: '2ch', textAlign: 'right', fontSize: 'clamp(14px,1.9vh,24px)', color: C.text1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },

  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center' },
  emptyTitle: { fontSize: 'clamp(15px,2vh,24px)', color: C.text2, fontWeight: 600 },
  emptySub: { fontSize: 'clamp(12px,1.5vh,18px)', color: C.text3 },

  foot: { flex: '0 0 auto', fontSize: 'clamp(10px,1.2vh,14px)', textAlign: 'right' },
}
