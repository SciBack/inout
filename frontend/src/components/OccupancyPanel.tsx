import { useEffect, useState } from 'react'

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

  if (error) return <div style={styles.error}>Sin conexión con el servidor</div>
  if (!data) return <div style={styles.loading}>Cargando...</div>

  const pct = Math.min(100, data.occupancy_percent)
  const barColor = pct < 70 ? '#22c55e' : pct < 90 ? '#f59e0b' : '#ef4444'

  return (
    <div style={styles.container}>
      <h2 style={styles.spaceName}>{data.space_name}</h2>

      {/* Aforo principal */}
      <div style={styles.occupancyBox}>
        <span style={styles.occupancyNum}>{data.current_occupancy}</span>
        <span style={styles.occupancyOf}>/ {data.capacity}</span>
        <span style={styles.occupancyLabel}>personas</span>
      </div>

      {/* Barra de progreso */}
      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${pct}%`, background: barColor }} />
      </div>
      <span style={{ color: barColor, fontWeight: 600 }}>{pct.toFixed(0)}% del aforo</span>

      {/* Stats del día */}
      <div style={styles.stats}>
        <div style={styles.stat}>
          <span style={styles.statNum}>{data.entries_today}</span>
          <span style={styles.statLabel}>Ingresos hoy</span>
        </div>
        <div style={styles.stat}>
          <span style={styles.statNum}>{data.exits_today}</span>
          <span style={styles.statLabel}>Salidas hoy</span>
        </div>
      </div>

      {/* Últimos eventos */}
      <div style={styles.recentList}>
        <h3 style={styles.recentTitle}>Últimos registros</h3>
        {data.recent_events.slice(0, 6).map(ev => (
          <div key={ev.id} style={styles.recentItem}>
            <span style={styles.recentBadge(ev.event_type === 'entry')}>
              {ev.event_type === 'entry' ? '↑' : '↓'}
            </span>
            <span style={styles.recentName}>{ev.patron_name || ev.cardnumber}</span>
            <span style={styles.recentTime}>
              {new Date(ev.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, any> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1.5rem',
    height: '100%',
    overflowY: 'auto',
  },
  spaceName: {
    fontSize: '1.1rem',
    color: '#64748b',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  occupancyBox: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
  },
  occupancyNum: {
    fontSize: '4rem',
    fontWeight: 800,
    color: '#f1f5f9',
    lineHeight: 1,
  },
  occupancyOf: {
    fontSize: '2rem',
    color: '#475569',
  },
  occupancyLabel: {
    fontSize: '1rem',
    color: '#64748b',
  },
  barBg: {
    width: '100%',
    height: '8px',
    background: '#1e293b',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.5s ease, background 0.3s',
  },
  stats: {
    display: 'flex',
    gap: '2rem',
    marginTop: '0.5rem',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
  },
  statNum: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#f1f5f9',
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  recentList: {
    width: '100%',
    marginTop: '0.5rem',
  },
  recentTitle: {
    fontSize: '0.75rem',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '0.5rem',
  },
  recentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.4rem 0',
    borderBottom: '1px solid #1e293b',
  },
  recentBadge: (isEntry: boolean): React.CSSProperties => ({
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 700,
    flexShrink: 0,
    background: isEntry ? '#22c55e20' : '#a855f720',
    color: isEntry ? '#22c55e' : '#a855f7',
  }),
  recentName: {
    flex: 1,
    fontSize: '0.875rem',
    color: '#cbd5e1',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  recentTime: {
    fontSize: '0.75rem',
    color: '#475569',
    flexShrink: 0,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#475569',
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#ef4444',
    fontSize: '0.875rem',
  },
}
