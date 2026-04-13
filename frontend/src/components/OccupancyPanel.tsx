import { useEffect, useRef, useState } from 'react'

interface HourlyEntry {
  hour: number
  count: number
}

interface FacultyTimeline {
  faculty: string
  label: string
  data: HourlyEntry[]
}

interface FacultyEventData {
  faculty: string
  label: string
  event_type: string
  ts: string
}

interface DashboardData {
  space_name: string
  capacity: number
  current_occupancy: number
  occupancy_percent: number
  entries_today: number
  exits_today: number
  unique_visitors_today: number
  avg_stay_seconds: number | null
  peak_hour: number | null
  current_male: number
  current_female: number
  faculty_breakdown: { faculty: string; label: string; count: number }[]
  hourly_entries: HourlyEntry[]
  faculty_timelines: FacultyTimeline[]
  faculty_events: FacultyEventData[]
  recent_events: Array<{
    id: number
    cardnumber: string
    patron_name: string
    patron_category: string
    patron_gender: string
    event_type: string
    timestamp: string
  }>
  entries_yesterday: number
}

const LINE_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444']

const tsToMinute = (ts: string): number => {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}

function buildOccupancyCurve(
  events: FacultyEventData[],
  faculty: string,
  startMinute: number,
  nowMinute: number
): [number, number][] {
  const evts = events
    .filter(e => e.faculty === faculty)
    .map(e => ({ ...e, minute: tsToMinute(e.ts) }))
    .sort((a, b) => a.minute - b.minute)

  if (evts.length === 0) return []

  const pts: [number, number][] = [[startMinute, 0]]
  let count = 0

  for (const ev of evts) {
    const m = ev.minute
    if (pts[pts.length - 1][0] < m) pts.push([m, count])
    count = Math.max(0, count + (ev.event_type === 'entry' ? 1 : -1))
    pts.push([m, count])
  }

  pts.push([nowMinute, count])
  return pts
}

function minuteLabel(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return min === 0 ? `${h}h` : `${h}:${String(min).padStart(2, '0')}`
}

function smoothStepPath(pts: [number, number][], r: number = 5): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    const [nx, ny] = pts[i + 1]
    const dx1 = cx - px, dy1 = cy - py
    const dx2 = nx - cx, dy2 = ny - cy
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
    if (len1 < 0.1 || len2 < 0.1) { d += ` L ${cx.toFixed(1)},${cy.toFixed(1)}`; continue }
    const rr = Math.min(r, len1 / 2, len2 / 2)
    const t1x = cx - (dx1 / len1) * rr, t1y = cy - (dy1 / len1) * rr
    const t2x = cx + (dx2 / len2) * rr, t2y = cy + (dy2 / len2) * rr
    d += ` L ${t1x.toFixed(1)},${t1y.toFixed(1)}`
    d += ` Q ${cx.toFixed(1)},${cy.toFixed(1)} ${t2x.toFixed(1)},${t2y.toFixed(1)}`
  }
  d += ` L ${pts[pts.length - 1][0].toFixed(1)},${pts[pts.length - 1][1].toFixed(1)}`
  return d
}

// Gauge circular tipo velocímetro
// Arco de 252° (70% del círculo), hueco centrado abajo
function ArcGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(1, max > 0 ? value / max : 0)
  const R = 38
  const cx = 50, cy = 50
  const circumference = 2 * Math.PI * R
  const arcFraction = 0.72  // 72% = 259°
  const arcLength = circumference * arcFraction
  const filledLength = arcLength * pct
  // rotate(144) pone el inicio del arco en ~234° desde arriba (esquina inferior-izquierda)
  // dejando el hueco de 28% centrado en la parte baja
  const rot = `rotate(144, ${cx}, ${cy})`

  return (
    <svg viewBox="0 0 100 92" style={{ width: '100%', maxWidth: '160px', display: 'block' }}>
      {/* Track de fondo */}
      <circle cx={cx} cy={cy} r={R}
        fill="none" stroke="#132235" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        transform={rot}
      />
      {/* Progreso */}
      <circle cx={cx} cy={cy} r={R}
        fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${filledLength.toFixed(2)} ${(circumference - filledLength).toFixed(2)}`}
        transform={rot}
        style={{ transition: 'stroke-dasharray 0.7s ease, stroke 0.4s ease' }}
      />
      {/* Número central */}
      <text x={cx} y={cy - 3} textAnchor="middle" dominantBaseline="middle"
        fontSize="26" fontWeight="700" fill={color}
        style={{ fontFamily: 'system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle"
        fontSize="9.5" fill="#475569"
        style={{ fontFamily: 'system-ui, sans-serif' }}>
        de {max}
      </text>
    </svg>
  )
}

// Gráfico de líneas por facultad — compacto, para la zona inferior
function FacultyLineChart({ events }: { events: FacultyEventData[] }) {
  const now = new Date()
  const nowMinute = now.getHours() * 60 + now.getMinutes()

  if (events.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 'clamp(10px,1.1vh,12px)', color: '#334155' }}>
          Sin entradas registradas hoy
        </span>
      </div>
    )
  }

  const faculties = [...new Map(events.map(e => [e.faculty, e.label])).entries()]
    .map(([faculty, label]) => ({ faculty, label }))

  // Eje X: siempre desde las 7:00 AM hasta el momento actual
  // Así el eje crece visualmente conforme avanza el día
  const startMinute = 7 * 60  // 7:00 AM fijo
  const endMinute = Math.max(nowMinute, startMinute + 30)

  const W = 300, H = 52
  const PAD_TOP = 4, PAD_BOT = 13
  const chartH = H - PAD_TOP - PAD_BOT
  const timeRange = endMinute - startMinute

  const xOf = (m: number) => ((m - startMinute) / timeRange) * W
  const xClamped = (m: number) => Math.max(0, Math.min(W, xOf(m)))

  const allCurves = faculties.map(f =>
    buildOccupancyCurve(events, f.faculty, startMinute, nowMinute)
  )
  const maxOcc = Math.max(...allCurves.flatMap(c => c.map(([, v]) => v)), 1)
  const yOf = (v: number) => PAD_TOP + chartH * (1 - v / maxOcc)

  const interval = timeRange <= 90 ? 30 : timeRange <= 240 ? 60 : 120
  const firstLabel = Math.ceil(startMinute / interval) * interval
  const axisLabels: number[] = []
  for (let m = firstLabel; m <= endMinute; m += interval) axisLabels.push(m)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          preserveAspectRatio="none">
          <line x1={0} y1={H - PAD_BOT} x2={W} y2={H - PAD_BOT} stroke="#1a2a3f" strokeWidth="0.6" />
          {axisLabels.map(m => (
            <g key={m}>
              <line x1={xClamped(m)} y1={PAD_TOP} x2={xClamped(m)} y2={H - PAD_BOT}
                stroke="#1a2a3f" strokeWidth="0.5" />
              <text x={xClamped(m)} y={H - 2} fontSize="6" fill="#334155" textAnchor="middle">
                {minuteLabel(m)}
              </text>
            </g>
          ))}
          <line x1={W} y1={PAD_TOP} x2={W} y2={H - PAD_BOT}
            stroke="#64748b" strokeWidth="1" strokeDasharray="3,2" />
          {faculties.map(({ faculty }, idx) => {
            const curve = allCurves[idx]
            if (curve.length < 2) return null
            const color = LINE_COLORS[idx % LINE_COLORS.length]
            const svgPts = curve.map(([m, v]) => [xOf(m), yOf(v)] as [number, number])
            const base = H - PAD_BOT
            const linePath = smoothStepPath(svgPts, 5)
            const areaD = `${linePath} L ${svgPts[svgPts.length-1][0].toFixed(1)},${base} L ${svgPts[0][0].toFixed(1)},${base} Z`
            return <path key={`a-${faculty}`} d={areaD} fill={color} fillOpacity="0.07" stroke="none" />
          })}
          {faculties.map(({ faculty }, idx) => {
            const curve = allCurves[idx]
            if (curve.length < 2) return null
            const svgPts = curve.map(([m, v]) => [xOf(m), yOf(v)] as [number, number])
            return (
              <path key={faculty} d={smoothStepPath(svgPts, 5)}
                fill="none" stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                strokeWidth="1.2" strokeLinecap="round" />
            )
          })}
        </svg>
      </div>
      {/* Leyenda compacta */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', flexShrink: 0 }}>
        {faculties.map(({ faculty, label }, idx) => (
          <div key={faculty} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: 12, height: 2, background: LINE_COLORS[idx % LINE_COLORS.length], borderRadius: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 'clamp(7px,0.75vh,9px)', color: '#475569', whiteSpace: 'nowrap' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function firstNameCapitalized(fullName: string): string {
  if (!fullName) return ''
  const first = fullName.trim().split(/\s+/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function animateCounter(el: HTMLElement, from: number, to: number, duration: number) {
  const start = performance.now()
  const diff = to - from
  const step = (now: number) => {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    el.textContent = String(Math.round(from + diff * progress))
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function OccupancyPanel() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

  const refVisitors = useRef<HTMLSpanElement>(null)
  const refOccupancy = useRef<HTMLSpanElement>(null)
  const refMale = useRef<HTMLSpanElement>(null)
  const refFemale = useRef<HTMLSpanElement>(null)

  const prevVisitors = useRef(0)
  const prevOccupancy = useRef(0)
  const prevMale = useRef(0)
  const prevFemale = useRef(0)
  const prevFirstId = useRef<number | null>(null)

  const fetchDashboard = async () => {
    try {
      const res = await fetch('/api/dashboard')
      if (res.ok) { setData(await res.json()); setError(false) }
    } catch { setError(true) }
  }

  useEffect(() => {
    fetchDashboard()
    const id = setInterval(fetchDashboard, 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!data) return
    const pulse = (
      ref: React.RefObject<HTMLSpanElement | null>,
      prev: React.MutableRefObject<number>,
      val: number
    ) => {
      if (ref.current && prev.current !== val) {
        animateCounter(ref.current, prev.current, val, 300)
        ref.current.style.animation = 'none'
        void ref.current.offsetWidth
        ref.current.style.animation = 'metricPulse 0.5s ease'
        prev.current = val
      }
    }
    pulse(refVisitors, prevVisitors, data.unique_visitors_today)
    pulse(refOccupancy, prevOccupancy, data.current_occupancy)
    pulse(refMale, prevMale, data.current_male)
    pulse(refFemale, prevFemale, data.current_female)
  }, [data])

  if (error) return <div style={s.stateMsg}>Sin conexión con el servidor</div>
  if (!data) return <div style={{ ...s.stateMsg, color: '#475569' }}>Cargando...</div>

  const pct = Math.min(100, data.occupancy_percent)
  const barColor = pct < 60 ? '#22c55e' : pct < 85 ? '#f59e0b' : '#ef4444'

  const todayLabel = new Date().toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const todayCapitalized = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)

  const firstEventId = data.recent_events[0]?.id ?? null
  const isNewEvent = firstEventId !== null && firstEventId !== prevFirstId.current
  if (isNewEvent) prevFirstId.current = firstEventId

  return (
    <div style={s.container}>

      {/* ── HEADER ── */}
      <div style={s.header}>
        <span style={s.spaceName}>{data.space_name.toUpperCase()}</span>
        <span style={s.dateLabel}>{todayCapitalized}</span>
      </div>

      {/* ── SECCIÓN MEDIA: 2 columnas ── */}
      <div style={s.middle}>

        {/* COLUMNA IZQUIERDA — Gauge + métricas secundarias */}
        <div style={s.leftCol}>

          {/* Card gauge aforo */}
          <div style={s.gaugeCard}>
            <span style={s.cardLabel}>En edificio</span>
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '0.25rem' }}>
              <ArcGauge value={data.current_occupancy} max={data.capacity} color={barColor} />
            </div>
            {/* Barra de progreso */}
            <div style={{ width: '80%', margin: '0 auto', height: 5, background: '#132235', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, background: barColor, width: `${pct}%`, transition: 'width 0.7s ease, background 0.4s ease' }} />
            </div>
            <span style={{ textAlign: 'center', fontSize: 'clamp(9px,0.95vh,11px)', color: barColor, fontWeight: 600, letterSpacing: '0.04em' }}>
              {pct.toFixed(0)}% del aforo máximo
            </span>
          </div>

          {/* Métricas secundarias: visitantes / hombres / mujeres */}
          <div style={s.subMetrics}>
            <div style={s.subItem}>
              <span style={s.subLabel}>Visitantes hoy</span>
              <span ref={refVisitors} style={{ ...s.subNum, color: '#06b6d4' }}>
                {data.unique_visitors_today}
              </span>
            </div>
            <div style={s.subDivider} />
            <div style={s.subItem}>
              <span style={s.subLabel}>Hombres</span>
              <span ref={refMale} style={{ ...s.subNum, color: '#3b82f6' }}>
                {data.current_male}
              </span>
            </div>
            <div style={s.subDivider} />
            <div style={s.subItem}>
              <span style={s.subLabel}>Mujeres</span>
              <span ref={refFemale} style={{ ...s.subNum, color: '#ec4899' }}>
                {data.current_female}
              </span>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA — Feed de actividad */}
        <div style={s.rightCol}>
          <span style={s.cardLabel}>Actividad reciente</span>
          <div style={s.feedList}>
            {data.recent_events.slice(0, 8).map((ev, idx) => {
              const isEntry = ev.event_type === 'entry'
              const isFirst = idx === 0
              return (
                <div
                  key={isFirst && isNewEvent ? ev.id + '-anim' : ev.id}
                  style={{
                    ...s.feedItem,
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    animation: isFirst && isNewEvent
                      ? 'feedSlideIn 0.35s cubic-bezier(0.22,1,0.36,1)' : undefined,
                  }}
                >
                  <span style={isEntry ? s.feedDotEntry : s.feedDotExit} />
                  <span style={s.feedName}>
                    {firstNameCapitalized(ev.patron_name || ev.cardnumber)}
                  </span>
                  <span style={s.feedTime}>
                    {new Date(ev.timestamp).toLocaleTimeString('es-PE', {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── SECCIÓN INFERIOR — Gráfico facultades ── */}
      <div style={s.chartSection}>
        <span style={s.cardLabel}>Actividad por facultad — hoy</span>
        <FacultyLineChart events={data.faculty_events} />
      </div>

    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 'clamp(10px,1.2vh,16px) clamp(12px,1.5vh,20px)',
    gap: 'clamp(6px,0.8vh,10px)',
    background: '#0a1628',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  stateMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: '#ef4444', fontSize: '0.875rem',
  },

  // Header
  header: {
    flex: '0 0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  spaceName: {
    fontSize: 'clamp(11px,1.3vh,15px)',
    fontWeight: 600,
    color: '#94a3b8',
    letterSpacing: '0.08em',
  },
  dateLabel: {
    fontSize: 'clamp(10px,1.1vh,13px)',
    color: '#334155',
    textTransform: 'capitalize',
  },

  // Sección media: 2 columnas
  middle: {
    flex: '2.4 0 0',
    minHeight: 0,
    display: 'flex',
    gap: 'clamp(6px,0.8vh,10px)',
  },

  // Columna izquierda — gauge + sub métricas
  leftCol: {
    flex: '0 0 44%',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(5px,0.7vh,8px)',
    minHeight: 0,
  },
  gaugeCard: {
    flex: '1 1 auto',
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '12px',
    padding: 'clamp(8px,1vh,12px) clamp(10px,1.2vh,14px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 'clamp(4px,0.5vh,6px)',
    overflow: 'hidden',
  },
  subMetrics: {
    flex: '0 0 auto',
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '12px',
    padding: 'clamp(6px,0.8vh,10px) clamp(10px,1.2vh,14px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: '0.5rem',
  },
  subItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    flex: 1,
  },
  subLabel: {
    fontSize: 'clamp(8px,0.85vh,10px)',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  subNum: {
    fontSize: 'clamp(22px,2.8vh,34px)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
  },
  subDivider: {
    width: 1,
    alignSelf: 'stretch',
    background: '#1e293b',
    flexShrink: 0,
  },

  // Columna derecha — feed
  rightCol: {
    flex: '1 1 0',
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '12px',
    padding: 'clamp(8px,1vh,12px) clamp(10px,1.2vh,14px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(4px,0.6vh,8px)',
    overflow: 'hidden',
    minHeight: 0,
  },

  feedList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    overflow: 'hidden',
  },
  feedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(6px,0.7vh,10px)',
    borderRadius: '6px',
    padding: 'clamp(4px,0.5vh,6px) clamp(6px,0.7vh,8px)',
    flex: '1 1 0',
    minHeight: 0,
  },
  feedDotEntry: {
    width: 7, height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    background: '#22c55e',
    boxShadow: '0 0 5px #22c55e88',
  } as React.CSSProperties,
  feedDotExit: {
    width: 7, height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    background: '#ef4444',
    boxShadow: '0 0 5px #ef444488',
  } as React.CSSProperties,
  feedName: {
    flex: 1,
    fontSize: 'clamp(11px,1.3vh,15px)',
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  feedTime: {
    fontSize: 'clamp(9px,1vh,11px)',
    color: '#334155',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },

  // Etiqueta de sección
  cardLabel: {
    flex: '0 0 auto',
    fontSize: 'clamp(8px,0.85vh,10px)',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },

  // Sección gráfico facultades
  chartSection: {
    flex: '1.2 0 0',
    minHeight: 0,
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '12px',
    padding: 'clamp(6px,0.8vh,10px) clamp(10px,1.2vh,14px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(4px,0.5vh,6px)',
    overflow: 'hidden',
  },
}
