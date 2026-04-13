import { useEffect, useState } from 'react'

interface CategoryCount {
  category: string
  label: string
  count: number
}

interface DashboardData {
  space_name: string
  capacity: number
  current_occupancy: number
  occupancy_percent: number
  entries_today: number
  exits_today: number
  recent_events: Array<{
    id: number
    cardnumber: string
    patron_name: string
    patron_category: string
    event_type: string
    timestamp: string
  }>
  unique_visitors_today: number
  avg_stay_seconds: number | null
  peak_hour: number | null
  category_breakdown: CategoryCount[]
  entries_yesterday: number
}

const CATEGORY_COLORS: Record<string, string> = {
  Estudiantes: '#3b82f6',
  Docentes: '#8b5cf6',
  Administrativos: '#06b6d4',
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
  return `${String(hour).padStart(2, '0')}:00 – ${String(next).padStart(2, '0')}:00`
}

function firstNameCapitalized(fullName: string): string {
  if (!fullName) return ''
  const first = fullName.trim().split(/\s+/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function categoryAbbr(cat: string): string {
  const map: Record<string, string> = {
    ESTUDI: 'Est.',
    Estudiantes: 'Est.',
    DOCEN: 'Doc.',
    Docentes: 'Doc.',
    ADMIN: 'Adm.',
    Administrativos: 'Adm.',
  }
  return map[cat] || cat
}

export function OccupancyPanel() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

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
    const interval = setInterval(fetchDashboard, 5000)
    return () => clearInterval(interval)
  }, [])

  if (error) return <div style={s.stateMsg}>Sin conexión con el servidor</div>
  if (!data) return <div style={{ ...s.stateMsg, color: '#475569' }}>Cargando...</div>

  const pct = Math.min(100, data.occupancy_percent)
  const barColor = pct < 70 ? '#22c55e' : pct < 90 ? '#f59e0b' : '#ef4444'

  const today = new Date()
  const todayLabel = today.toLocaleDateString('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const todayCapitalized = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)

  const maxCategoryCount = data.category_breakdown.reduce((m, c) => Math.max(m, c.count), 1)

  return (
    <div style={s.container}>

      {/* SECCIÓN 1 — Header */}
      <div style={s.header}>
        <span style={s.spaceName}>{data.space_name.toUpperCase()}</span>
        <span style={s.dateLabel}>{todayCapitalized}</span>
      </div>

      {/* SECCIÓN 2 — Aforo principal */}
      <div style={s.occupancyCard}>
        <div style={s.occupancyTop}>
          <span style={s.occupancyNum}>{data.current_occupancy}</span>
          <span style={s.occupancyOf}>/ {data.capacity}</span>
          <span style={s.occupancyPersonas}>personas</span>
        </div>
        <div style={s.barBg}>
          <div style={{ ...s.barFill, width: `${pct}%`, background: barColor }} />
        </div>
        <span style={{ color: barColor, fontSize: '0.9rem', fontWeight: 600 }}>
          {pct.toFixed(0)}% del aforo
        </span>
      </div>

      {/* SECCIÓN 3 — Métricas del día */}
      <div style={s.metricsGrid}>
        <div style={s.metricCard}>
          <span style={s.metricNum}>{data.unique_visitors_today}</span>
          <span style={s.metricLabel}>Visitantes únicos</span>
        </div>
        <div style={s.metricCard}>
          <span style={s.metricNum}>{data.entries_today}</span>
          <span style={s.metricLabel}>Ingresos totales</span>
        </div>
        <div style={s.metricCard}>
          <span style={s.metricNum}>{formatStay(data.avg_stay_seconds)}</span>
          <span style={s.metricLabel}>Permanencia prom.</span>
        </div>
        <div style={s.metricCard}>
          <span style={{ ...s.metricNum, fontSize: data.peak_hour !== null ? '1.25rem' : '1.75rem' }}>
            {formatPeakHour(data.peak_hour)}
          </span>
          <span style={s.metricLabel}>Hora pico</span>
        </div>
      </div>

      {/* SECCIÓN 4 — Distribución por categoría */}
      {data.category_breakdown.length > 0 && (
        <div style={s.categorySection}>
          <span style={s.sectionTitle}>Visitantes por categoría</span>
          <div style={s.categoryList}>
            {data.category_breakdown.map((cat) => {
              const color = CATEGORY_COLORS[cat.label] ?? '#64748b'
              const widthPct = (cat.count / maxCategoryCount) * 100
              return (
                <div key={cat.category} style={s.categoryRow}>
                  <span style={s.categoryLabel}>{cat.label}</span>
                  <div style={s.categoryBarBg}>
                    <div style={{ ...s.categoryBarFill, width: `${widthPct}%`, background: color }} />
                  </div>
                  <span style={{ ...s.categoryCount, color }}>{cat.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* SECCIÓN 5 — Últimos 8 registros */}
      <div style={s.recentSection}>
        <span style={s.sectionTitle}>Últimos registros</span>
        <div style={s.recentList}>
          {data.recent_events.slice(0, 8).map((ev, idx) => {
            const isEntry = ev.event_type === 'entry'
            return (
              <div
                key={ev.id}
                style={{
                  ...s.recentItem,
                  background: idx % 2 === 0 ? 'transparent' : '#0f1e30',
                }}
              >
                <span style={isEntry ? s.badgeEntry : s.badgeExit}>
                  {isEntry ? '↑' : '↓'}
                </span>
                <span style={s.recentName}>
                  {firstNameCapitalized(ev.patron_name || ev.cardnumber)}
                </span>
                <span style={s.recentCat}>{categoryAbbr(ev.patron_category)}</span>
                <span style={s.recentTime}>
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
    gap: '1rem',
    padding: '1.5rem',
    height: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
    background: '#0a1628',
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
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
  },
  spaceName: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#475569',
    letterSpacing: '0.12em',
  },
  dateLabel: {
    fontSize: '1rem',
    color: '#94a3b8',
    fontWeight: 400,
  },

  // Aforo principal
  occupancyCard: {
    background: '#0d1f35',
    borderRadius: '12px',
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  occupancyTop: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
  },
  occupancyNum: {
    fontSize: '4.5rem',
    fontWeight: 800,
    color: '#f1f5f9',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  occupancyOf: {
    fontSize: '2rem',
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
  },
  occupancyPersonas: {
    fontSize: '1rem',
    color: '#64748b',
    marginLeft: '0.25rem',
  },
  barBg: {
    width: '100%',
    height: '10px',
    background: '#1e293b',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.5s ease, background 0.3s',
  },

  // Métricas
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem',
  },
  metricCard: {
    background: '#0d1f35',
    borderRadius: '10px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  metricNum: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#f1f5f9',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
  },
  metricLabel: {
    fontSize: '0.7rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },

  // Categorías
  categorySection: {
    background: '#0d1f35',
    borderRadius: '10px',
    padding: '1rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  sectionTitle: {
    fontSize: '0.7rem',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: 600,
  },
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  categoryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  categoryLabel: {
    fontSize: '0.8rem',
    color: '#94a3b8',
    width: '110px',
    flexShrink: 0,
  },
  categoryBarBg: {
    flex: 1,
    height: '6px',
    background: '#1e293b',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  categoryBarFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.4s ease',
  },
  categoryCount: {
    fontSize: '0.85rem',
    fontWeight: 600,
    width: '32px',
    textAlign: 'right',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  },

  // Últimos registros
  recentSection: {
    background: '#0d1f35',
    borderRadius: '10px',
    padding: '1rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    flex: 1,
  },
  recentList: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  recentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.4rem 0.5rem',
    borderRadius: '4px',
  },
  badgeEntry: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.7rem',
    fontWeight: 700,
    flexShrink: 0,
    background: '#22c55e20',
    color: '#22c55e',
  } as React.CSSProperties,
  badgeExit: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.7rem',
    fontWeight: 700,
    flexShrink: 0,
    background: '#a855f720',
    color: '#a855f7',
  } as React.CSSProperties,
  recentName: {
    flex: 1,
    fontSize: '0.825rem',
    color: '#cbd5e1',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  recentCat: {
    fontSize: '0.7rem',
    color: '#475569',
    flexShrink: 0,
  },
  recentTime: {
    fontSize: '0.75rem',
    color: '#475569',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  },
}
