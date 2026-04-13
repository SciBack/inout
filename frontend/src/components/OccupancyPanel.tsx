import { useEffect, useRef, useState, memo } from 'react'

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

const FAC_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444']

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

// Avatar del patron: foto de Koha con fallback a iniciales
const PatronAvatar = memo(function PatronAvatar({
  cardnumber, name,
}: { cardnumber: string; name: string }) {
  const [failed, setFailed] = useState(false)

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join('')

  const SIZE = 'clamp(34px,4.2vh,50px)'

  if (failed) {
    return (
      <div style={{
        width: SIZE, height: SIZE, borderRadius: '50%', flexShrink: 0,
        background: '#0f2540', border: '1px solid #1e3a5f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'clamp(12px,1.5vh,17px)', fontWeight: 700, color: '#475569',
        userSelect: 'none',
      }}>
        {initials || '?'}
      </div>
    )
  }

  return (
    <img
      src={`/api/patron-photo/card/${encodeURIComponent(cardnumber)}`}
      onError={() => setFailed(true)}
      alt={name}
      style={{
        width: SIZE, height: SIZE, borderRadius: '50%', flexShrink: 0,
        objectFit: 'cover', objectPosition: 'top',
        border: '1px solid #1e3a5f', background: '#0f2540',
      }}
    />
  )
})

// Barras horizontales por facultad — visitantes únicos hoy
function FacultyBarChart({ rows }: { rows: { faculty: string; label: string; count: number }[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 'clamp(10px,1.1vh,12px)', color: '#334155' }}>
          Sin entradas registradas hoy
        </span>
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => b.count - a.count)
  const max = Math.max(...sorted.map(r => r.count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px,0.8vh,10px)' }}>
      {sorted.map((row, idx) => {
        const pct = (row.count / max) * 100
        const color = FAC_COLORS[idx % FAC_COLORS.length]
        return (
          <div key={row.faculty} style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1vh,14px)' }}>
            <span style={{
              width: 'clamp(80px,10vw,120px)', textAlign: 'right', flexShrink: 0,
              fontSize: 'clamp(12px,1.4vh,17px)', color: '#64748b', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {row.label}
            </span>
            <div style={{
              flex: 1, height: 'clamp(20px,2.6vh,30px)',
              background: '#132235', borderRadius: 5, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${pct}%`, borderRadius: 5,
                background: color, transition: 'width 0.6s ease',
                display: 'flex', alignItems: 'center', paddingLeft: 8,
              }}>
                {row.count > 2 && (
                  <span style={{ fontSize: 'clamp(10px,1.2vh,14px)', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
                    {row.count}
                  </span>
                )}
              </div>
            </div>
            <span style={{
              width: 'clamp(24px,3vw,36px)', textAlign: 'right', flexShrink: 0,
              fontSize: 'clamp(13px,1.5vh,18px)', fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', color: '#64748b',
            }}>
              {row.count}
            </span>
          </div>
        )
      })}
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

export function OccupancyPanel({ spaceId }: { spaceId?: number }) {
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
      const url = spaceId ? `/api/dashboard?space_id=${spaceId}` : '/api/dashboard'
      const res = await fetch(url)
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

      {/* ── FILA DE MÉTRICAS: gauge + 3 números en una sola tarjeta ── */}
      <div style={s.metricsRow}>

        {/* Gauge compacto */}
        <div style={s.gaugeBlock}>
          <span style={s.cardLabel}>En edificio</span>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <ArcGauge value={data.current_occupancy} max={data.capacity} color={barColor} />
          </div>
          <span style={{ textAlign: 'center', fontSize: 'clamp(9px,0.9vh,11px)', color: barColor, fontWeight: 600 }}>
            {pct.toFixed(0)}% del aforo
          </span>
        </div>

        <div style={s.metricsDivider} />

        {/* Métricas: visitantes / hombres / mujeres */}
        <div style={s.metricsGroup}>
          <div style={s.metricItem}>
            <span style={s.metricLabel}>Visitantes hoy</span>
            <span ref={refVisitors} style={{ ...s.metricNum, color: '#06b6d4' }}>
              {data.unique_visitors_today}
            </span>
          </div>
          <div style={s.metricItem}>
            <span style={s.metricLabel}>Hombres</span>
            <span ref={refMale} style={{ ...s.metricNum, color: '#3b82f6' }}>
              {data.current_male}
            </span>
          </div>
          <div style={s.metricItem}>
            <span style={s.metricLabel}>Mujeres</span>
            <span ref={refFemale} style={{ ...s.metricNum, color: '#ec4899' }}>
              {data.current_female}
            </span>
          </div>
        </div>
      </div>

      {/* ── FEED DE ACTIVIDAD ── */}
      <div style={s.feedSection}>
        <span style={s.cardLabel}>Actividad reciente</span>
        <div style={s.feedList}>
          {data.recent_events.slice(0, 10).map((ev, idx) => {
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
                <PatronAvatar cardnumber={ev.cardnumber} name={ev.patron_name || ev.cardnumber} />
                {isEntry ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                    <path d="M9 15 L9 4 M5 8 L9 3 L13 8" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                    <path d="M9 3 L9 14 M5 10 L9 15 L13 10" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                )}
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

      {/* ── BARRAS POR FACULTAD ── */}
      <div style={s.chartSection}>
        <span style={s.cardLabel}>Visitantes hoy por facultad</span>
        <FacultyBarChart rows={data.faculty_breakdown} />
      </div>

    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 'clamp(10px,1.2vh,18px) clamp(12px,1.5vh,20px)',
    gap: 'clamp(7px,0.9vh,12px)',
    background: '#0a1628',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  stateMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: '#ef4444', fontSize: '1rem',
  },

  // Header
  header: {
    flex: '0 0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  spaceName: {
    fontSize: 'clamp(13px,1.7vh,20px)',
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.1em',
  },
  dateLabel: {
    fontSize: 'clamp(12px,1.4vh,17px)',
    color: '#475569',
    textTransform: 'capitalize',
  },

  // Fila de métricas: gauge + números en horizontal
  metricsRow: {
    flex: '0 0 auto',
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '14px',
    padding: 'clamp(10px,1.3vh,18px) clamp(14px,1.8vh,22px)',
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(12px,1.5vh,20px)',
  },

  // Bloque gauge (izquierda)
  gaugeBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    width: 'clamp(120px,16vh,170px)',
  },

  // Separador vertical
  metricsDivider: {
    width: 1,
    alignSelf: 'stretch',
    background: '#1a2a3f',
    flexShrink: 0,
  },

  // Grupo de 3 métricas
  metricsGroup: {
    flex: 1,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-around',
  },

  metricItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'clamp(3px,0.4vh,6px)',
  },
  metricLabel: {
    fontSize: 'clamp(10px,1.2vh,14px)',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  metricNum: {
    fontSize: 'clamp(42px,5.5vh,70px)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },

  // Feed de actividad — toma el mayor espacio
  feedSection: {
    flex: '1 1 0',
    minHeight: 0,
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '14px',
    padding: 'clamp(10px,1.2vh,16px) clamp(14px,1.8vh,22px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(6px,0.8vh,10px)',
    overflow: 'hidden',
  },
  feedList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(2px,0.4vh,5px)',
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  feedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(10px,1.2vh,16px)',
    borderRadius: '8px',
    padding: 'clamp(8px,1vh,14px) clamp(10px,1.2vh,14px)',
    flexShrink: 0,        // NO stretch — altura natural
    background: 'rgba(255,255,255,0.025)',
  },
  feedName: {
    flex: 1,
    fontSize: 'clamp(16px,2vh,24px)',
    color: '#e2e8f0',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  feedTime: {
    fontSize: 'clamp(13px,1.6vh,19px)',
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },

  // Etiqueta de sección
  cardLabel: {
    flex: '0 0 auto',
    fontSize: 'clamp(10px,1.1vh,13px)',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  // Barras de facultad
  chartSection: {
    flex: '0 0 auto',
    background: '#0d1f35',
    border: '1px solid #1a2a3f',
    borderRadius: '14px',
    padding: 'clamp(10px,1.2vh,16px) clamp(14px,1.8vh,22px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(7px,0.9vh,11px)',
  },
}
