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

// Horas de operación de la biblioteca
const CHART_HOURS = Array.from({ length: 15 }, (_, i) => i + 7) // 7 → 21
const LINE_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444']

// SVG line chart — una línea por facultad
function FacultyLineChart({ timelines }: { timelines: FacultyTimeline[] }) {
  const currentHour = new Date().getHours()
  const W = 300
  const H = 72
  const PAD_TOP = 6
  const PAD_BOT = 16
  const chartH = H - PAD_TOP - PAD_BOT

  const xOf = (h: number) => ((h - 7) / 14) * W
  const allCounts = timelines.flatMap(t => t.data.map(d => d.count))
  const maxCount = Math.max(...allCounts, 1)
  const yOf = (count: number) => PAD_TOP + chartH * (1 - count / maxCount)

  const getPoints = (tl: FacultyTimeline) => {
    const map: Record<number, number> = {}
    for (const d of tl.data) map[d.hour] = d.count
    const end = Math.min(Math.max(currentHour, 7), 21)
    return CHART_HOURS
      .filter(h => h <= end)
      .map(h => `${xOf(h).toFixed(1)},${yOf(map[h] ?? 0).toFixed(1)}`)
      .join(' ')
  }

  if (timelines.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 'clamp(10px,1.1vh,13px)', color: '#475569' }}>Sin datos del día</span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(4px,0.5vh,7px)', minHeight: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', flex: 1, minHeight: 0 }}
        preserveAspectRatio="none"
      >
        {/* Líneas de hora */}
        {CHART_HOURS.filter(h => h % 2 === 1).map(h => (
          <g key={h}>
            <line x1={xOf(h)} y1={PAD_TOP} x2={xOf(h)} y2={H - PAD_BOT}
              stroke="#1a2a3f" strokeWidth="0.5" />
            <text x={xOf(h)} y={H - 1} fontSize="6" fill="#334155" textAnchor="middle">{h}h</text>
          </g>
        ))}
        {/* Línea baseline */}
        <line x1={0} y1={H - PAD_BOT} x2={W} y2={H - PAD_BOT} stroke="#1e293b" strokeWidth="0.5" />
        {/* Indicador hora actual */}
        {currentHour >= 7 && currentHour <= 21 && (
          <line
            x1={xOf(currentHour)} y1={PAD_TOP}
            x2={xOf(currentHour)} y2={H - PAD_BOT}
            stroke="#475569" strokeWidth="1" strokeDasharray="3,2"
          />
        )}
        {/* Línea por facultad */}
        {timelines.map((tl, idx) => {
          const color = LINE_COLORS[idx % LINE_COLORS.length]
          const pts = getPoints(tl)
          return (
            <polyline
              key={tl.faculty}
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )
        })}
        {/* Puntos en datos reales */}
        {timelines.map((tl, idx) => {
          const color = LINE_COLORS[idx % LINE_COLORS.length]
          return tl.data
            .filter(d => d.hour >= 7 && d.hour <= Math.min(currentHour, 21))
            .map(d => (
              <circle
                key={`${tl.faculty}-${d.hour}`}
                cx={xOf(d.hour)}
                cy={yOf(d.count)}
                r="2.4"
                fill={color}
                stroke="#0d1f35"
                strokeWidth="0.8"
              />
            ))
        })}
      </svg>
      {/* Leyenda */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(4px,0.5vh,8px) clamp(8px,1vh,14px)', flexShrink: 0 }}>
        {timelines.map((tl, idx) => (
          <div key={tl.faculty} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{
              width: 'clamp(12px,1.4vh,18px)',
              height: '2px',
              background: LINE_COLORS[idx % LINE_COLORS.length],
              borderRadius: '1px',
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 'clamp(8px,0.85vh,11px)',
              color: '#64748b',
              whiteSpace: 'nowrap',
            }}>{tl.label}</span>
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
      if (res.ok) {
        setData(await res.json())
        setError(false)
      }
    } catch {
      setError(true)
    }
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

  const currentHour = new Date().getHours()

  return (
    <div style={s.container}>

      {/* SECCIÓN 1 — Header */}
      <div style={s.header}>
        <span style={s.spaceName}>{data.space_name.toUpperCase()}</span>
        <span style={s.dateLabel}>{todayCapitalized}</span>
      </div>

      {/* SECCIÓN 2 — Card de aforo */}
      <div style={s.occupancyCard}>
        <span style={s.occupancyLabel}>AFORO ACTUAL</span>
        <div style={s.occupancyRow}>
          <span style={{ ...s.occupancyNum, color: barColor }}>
            {data.current_occupancy}
          </span>
          <span style={s.occupancyOf}>/ {data.capacity}</span>
        </div>
        <div style={s.barBg}>
          <div style={{ ...s.barFillAnim, width: `${pct}%`, background: barColor }} />
        </div>
        <span style={{ ...s.occupancyPct, color: barColor }}>
          {pct.toFixed(0)}% del aforo
        </span>
      </div>

      {/* SECCIÓN 3 — Métricas */}
      <div style={s.metricsGrid}>
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Visitantes hoy</span>
          <span ref={refVisitors} style={{ ...s.metricNum, color: '#06b6d4' }}>
            {data.unique_visitors_today}
          </span>
        </div>
        <div style={s.metricCard}>
          <span style={s.metricLabel}>En edificio</span>
          <span ref={refOccupancy} style={{ ...s.metricNum, color: barColor }}>
            {data.current_occupancy}
          </span>
        </div>
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Hombres</span>
          <span ref={refMale} style={{ ...s.metricNum, color: '#3b82f6' }}>
            {data.current_male}
          </span>
        </div>
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Mujeres</span>
          <span ref={refFemale} style={{ ...s.metricNum, color: '#ec4899' }}>
            {data.current_female}
          </span>
        </div>
      </div>

      {/* SECCIÓN 4 — Gráfico de líneas por facultad */}
      <div style={s.histogramSection}>
        <span style={s.sectionTitle}>Actividad por facultad — hoy</span>
        <FacultyLineChart timelines={data.faculty_timelines} />
      </div>

      {/* SECCIÓN 5 — Feed actividad */}
      <div style={s.feedSection}>
        <span style={s.sectionTitle}>Actividad reciente</span>
        <div style={s.feedList}>
          {data.recent_events.slice(0, 7).map((ev, idx) => {
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
                <span style={isEntry ? s.feedIconEntry : s.feedIconExit}>
                  {isEntry ? '↑' : '↓'}
                </span>
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
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 'clamp(10px,1.2vh,18px) clamp(12px,1.5vh,22px)',
    gap: 'clamp(6px,0.8vh,12px)',
    background: '#0a1628',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  stateMsg: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#ef4444',
    fontSize: '0.875rem',
  },

  // Header
  header: {
    flex: '0 0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  spaceName: {
    fontSize: 'clamp(12px,1.4vh,16px)',
    fontWeight: 600,
    color: '#94a3b8',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  dateLabel: {
    fontSize: 'clamp(11px,1.2vh,14px)',
    color: '#475569',
    textTransform: 'capitalize',
  },

  // Aforo
  occupancyCard: {
    flex: '2.2 0 0',
    minHeight: 0,
    background: '#0d1f35',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: 'clamp(10px,1.2vh,16px) clamp(14px,1.8vh,22px)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 'clamp(6px,0.8vh,10px)',
  },
  occupancyLabel: {
    fontSize: 'clamp(10px,1vh,12px)',
    color: '#475569',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  occupancyRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.4rem',
  },
  occupancyNum: {
    fontSize: 'clamp(48px,7.5vh,88px)',
    fontWeight: 800,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  occupancyOf: {
    fontSize: 'clamp(24px,3.5vh,44px)',
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
  },
  barBg: {
    width: '100%',
    height: 'clamp(10px,1.3vh,16px)',
    background: '#1e293b',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  barFillAnim: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.7s ease, background-color 0.7s ease',
  },
  occupancyPct: {
    fontSize: 'clamp(12px,1.3vh,15px)',
    fontWeight: 600,
    alignSelf: 'flex-end',
  },

  // Métricas
  metricsGrid: {
    flex: '0.9 0 0',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'clamp(6px,0.7vh,10px)',
  },
  metricCard: {
    background: '#0d1f35',
    border: '1px solid #1e293b',
    borderRadius: '10px',
    padding: 'clamp(6px,0.8vh,12px) clamp(8px,1vh,14px)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  metricLabel: {
    fontSize: 'clamp(9px,0.9vh,11px)',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
  },
  metricNum: {
    fontSize: 'clamp(20px,3vh,36px)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },

  // Histograma
  histogramSection: {
    flex: '1.6 0 0',
    minHeight: 0,
    background: '#0d1f35',
    border: '1px solid #1e293b',
    borderRadius: '10px',
    padding: 'clamp(8px,1vh,14px) clamp(12px,1.4vh,18px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(6px,0.7vh,10px)',
    overflow: 'hidden',
  },
  sectionTitle: {
    flex: '0 0 auto',
    fontSize: 'clamp(9px,0.9vh,11px)',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },

  // Feed
  feedSection: {
    flex: '1.5 0 0',
    minHeight: 0,
    background: '#0d1f35',
    border: '1px solid #1e293b',
    borderRadius: '10px',
    padding: 'clamp(8px,1vh,14px) clamp(12px,1.4vh,18px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(4px,0.5vh,8px)',
    overflow: 'hidden',
  },
  feedList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(3px,0.4vh,6px)',
    overflow: 'hidden',
  },
  feedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(6px,0.7vh,10px)',
    borderRadius: '6px',
    padding: 'clamp(3px,0.4vh,5px) clamp(6px,0.7vh,8px)',
  },
  feedIconEntry: {
    width: 'clamp(18px,2vh,24px)',
    height: 'clamp(18px,2vh,24px)',
    borderRadius: '50%',
    flexShrink: 0,
    fontSize: 'clamp(9px,1vh,12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(34,197,94,0.12)',
    color: '#22c55e',
  } as React.CSSProperties,
  feedIconExit: {
    width: 'clamp(18px,2vh,24px)',
    height: 'clamp(18px,2vh,24px)',
    borderRadius: '50%',
    flexShrink: 0,
    fontSize: 'clamp(9px,1vh,12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(239,68,68,0.10)',
    color: '#ef4444',
  } as React.CSSProperties,
  feedName: {
    flex: 1,
    fontSize: 'clamp(11px,1.2vh,14px)',
    color: '#f1f5f9',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  feedTime: {
    fontSize: 'clamp(10px,1vh,12px)',
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },
}
