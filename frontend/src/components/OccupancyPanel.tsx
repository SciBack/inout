import { useEffect, useRef, useState } from 'react'

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

function formatStay(seconds: number | null): string {
  if (seconds === null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatPeakHour(hour: number | null): string {
  if (hour === null) return '—'
  const next = (hour + 1) % 24
  return `${String(hour).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00`
}

function firstNameCapitalized(fullName: string): string {
  if (!fullName) return ''
  const first = fullName.trim().split(/\s+/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function animateCounter(
  el: HTMLElement,
  from: number,
  to: number,
  duration: number
) {
  const start = performance.now()
  const diff = to - from
  const step = (now: number) => {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    const current = Math.round(from + diff * progress)
    el.textContent = String(current)
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

const FACULTY_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b']

export function OccupancyPanel() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

  // Refs para animación de métricas
  const refVisitors = useRef<HTMLSpanElement>(null)
  const refMale = useRef<HTMLSpanElement>(null)
  const refFemale = useRef<HTMLSpanElement>(null)

  // Valores anteriores para detectar cambios
  const prevVisitors = useRef<number>(0)
  const prevMale = useRef<number>(0)
  const prevFemale = useRef<number>(0)

  // Ref para detectar nuevo evento en feed
  const prevFirstId = useRef<number | null>(null)

  const fetchDashboard = async () => {
    try {
      const res = await fetch('/api/dashboard')
      if (res.ok) {
        const newData: DashboardData = await res.json()
        setData(newData)
        setError(false)
      }
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 5000)
    return () => clearInterval(interval)
  }, [])

  // Animar métricas cuando cambian
  useEffect(() => {
    if (!data) return

    const animateMetric = (
      ref: React.RefObject<HTMLSpanElement | null>,
      prevRef: React.MutableRefObject<number>,
      newVal: number
    ) => {
      if (ref.current && prevRef.current !== newVal) {
        animateCounter(ref.current, prevRef.current, newVal, 300)
        ref.current.style.animation = 'none'
        void ref.current.offsetWidth
        ref.current.style.animation = 'metricPulse 0.5s ease'
        prevRef.current = newVal
      }
    }

    animateMetric(refVisitors, prevVisitors, data.unique_visitors_today)
    animateMetric(refMale, prevMale, data.current_male)
    animateMetric(refFemale, prevFemale, data.current_female)
  }, [data])

  if (error) return <div style={s.stateMsg}>Sin conexión con el servidor</div>
  if (!data) return <div style={{ ...s.stateMsg, color: '#475569' }}>Cargando...</div>

  const pct = Math.min(100, data.occupancy_percent)
  const barColor = pct < 60 ? '#22c55e' : pct < 85 ? '#f59e0b' : '#ef4444'

  const today = new Date()
  const todayLabel = today.toLocaleDateString('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const todayCapitalized = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)

  const maxFacultyCount = data.faculty_breakdown.reduce((m, f) => Math.max(m, f.count), 1)

  const firstEventId = data.recent_events[0]?.id ?? null
  const isNewEvent = firstEventId !== null && firstEventId !== prevFirstId.current
  if (isNewEvent) prevFirstId.current = firstEventId

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
          <div style={{ ...s.barFill, width: `${pct}%`, background: barColor }} />
        </div>
        <span style={{ ...s.occupancyPct, color: barColor }}>
          {pct.toFixed(0)}% del aforo
        </span>
      </div>

      {/* SECCIÓN 3 — Métricas 4 cards */}
      <div style={s.metricsGrid}>
        {/* Visitantes únicos */}
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Visitantes</span>
          <span ref={refVisitors} style={{ ...s.metricNum, color: '#06b6d4' }}>
            {data.unique_visitors_today}
          </span>
        </div>
        {/* Hombres actuales */}
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Hombres</span>
          <span ref={refMale} style={{ ...s.metricNum, color: '#3b82f6' }}>
            {data.current_male}
          </span>
        </div>
        {/* Mujeres actuales */}
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Mujeres</span>
          <span ref={refFemale} style={{ ...s.metricNum, color: '#ec4899' }}>
            {data.current_female}
          </span>
        </div>
        {/* Hora pico */}
        <div style={s.metricCard}>
          <span style={s.metricLabel}>Hora pico</span>
          <span style={{ ...s.metricNum, fontSize: 'clamp(13px,1.6vh,18px)', color: '#8b5cf6' }}>
            {formatPeakHour(data.peak_hour)}
          </span>
        </div>
      </div>

      {/* SECCIÓN 4 — Facultades */}
      <div style={s.facultySection}>
        <span style={s.sectionTitle}>Por facultad — hoy</span>
        <div style={s.facultyList}>
          {data.faculty_breakdown.length === 0 ? (
            <span style={s.emptyState}>Sin datos del día</span>
          ) : (
            data.faculty_breakdown.map((fac, idx) => {
              const widthPct = (fac.count / maxFacultyCount) * 100
              const color = FACULTY_COLORS[idx % FACULTY_COLORS.length]
              return (
                <div key={fac.faculty} style={s.facultyRow}>
                  <span style={s.facultyName}>{fac.label}</span>
                  <div style={s.facultyBarBg}>
                    <div style={{ ...s.facultyBarFill, width: `${widthPct}%`, background: color }} />
                  </div>
                  <span style={s.facultyCount}>{fac.count}</span>
                </div>
              )
            })
          )}
        </div>
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
                  animation: isFirst && isNewEvent ? 'feedSlideIn 0.35s cubic-bezier(0.22,1,0.36,1)' : undefined,
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
                    hour: '2-digit',
                    minute: '2-digit',
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
  barFill: {
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

  // Facultades
  facultySection: {
    flex: '1.6 0 0',
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
  sectionTitle: {
    flex: '0 0 auto',
    fontSize: 'clamp(9px,0.9vh,11px)',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  facultyList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-evenly',
  },
  emptyState: {
    fontSize: 'clamp(10px,1.1vh,13px)',
    color: '#475569',
    textAlign: 'center',
    alignSelf: 'center',
    margin: 'auto',
  },
  facultyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(6px,0.7vh,10px)',
  },
  facultyName: {
    flex: '0 0 clamp(80px,16%,140px)',
    fontSize: 'clamp(10px,1.1vh,13px)',
    color: '#94a3b8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  facultyBarBg: {
    flex: 1,
    height: 'clamp(5px,0.7vh,8px)',
    background: '#1e293b',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  facultyBarFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.7s ease',
  },
  facultyCount: {
    flex: '0 0 28px',
    fontSize: 'clamp(10px,1.1vh,13px)',
    color: '#f1f5f9',
    fontWeight: 600,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
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
