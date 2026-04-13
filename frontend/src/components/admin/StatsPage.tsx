import { useEffect, useState } from 'react'

interface Sede { id: number; name: string; code: string }
interface Space { id: number; sede_id: number | null; sede: Sede | null; name: string; active: boolean }
interface MonthRow { month: number; month_name: string; unique_visitors: number; entries: number; exits: number; days_with_activity: number }
interface Totals { unique_visitors: number; entries: number; exits: number; days_with_activity: number }
interface BreakdownItem { category?: string; faculty?: string; label: string; count: number }
interface GenderBreakdown { male: number; female: number }
interface AnnualReport {
  space_name: string; year: number
  monthly: MonthRow[]; totals: Totals
  category_breakdown: BreakdownItem[]
  faculty_breakdown: BreakdownItem[]
  gender_breakdown: GenderBreakdown
}
interface DayRow { date: string; day_name: string; unique_visitors: number; entries: number; exits: number }
interface MonthlyReport { space_name: string; year_month: string; daily: DayRow[] }

interface Props { token: string }

export function StatsPage({ token }: Props) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [spaceId, setSpaceId] = useState<number | null>(null)
  const [view, setView] = useState<'annual' | 'monthly'>('annual')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [annual, setAnnual] = useState<AnnualReport | null>(null)
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null)
  const [loading, setLoading] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    fetch('/api/admin/spaces', { headers })
      .then(r => r.json())
      .then((data: Space[]) => {
        setSpaces(data)
        if (data.length > 0) setSpaceId(data[0].id)
      })
  }, [])

  useEffect(() => {
    if (!spaceId) return
    setLoading(true)
    if (view === 'annual') {
      fetch(`/api/admin/spaces/${spaceId}/stats/annual?year=${year}`, { headers })
        .then(r => r.json())
        .then(d => { setAnnual(d); setMonthly(null) })
        .finally(() => setLoading(false))
    } else {
      fetch(`/api/admin/spaces/${spaceId}/stats/monthly?month=${month}`, { headers })
        .then(r => r.json())
        .then(d => { setMonthly(d); setAnnual(null) })
        .finally(() => setLoading(false))
    }
  }, [spaceId, view, year, month])

  const pct = (val: number, total: number) =>
    total > 0 ? ` (${((val / total) * 100).toFixed(0)}%)` : ''

  const n = (val: number) => val.toLocaleString('es-PE')

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  return (
    <div style={s.page}>
      {/* Controles */}
      <div style={s.controls}>
        <div style={s.controlGroup}>
          <label style={s.label}>Espacio</label>
          <select style={s.select} value={spaceId ?? ''} onChange={e => setSpaceId(Number(e.target.value))}>
            {spaces.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        </div>

        <div style={s.viewTabs}>
          <button style={{ ...s.tabBtn, ...(view === 'annual' ? s.tabActive : {}) }}
            onClick={() => setView('annual')}>Anual</button>
          <button style={{ ...s.tabBtn, ...(view === 'monthly' ? s.tabActive : {}) }}
            onClick={() => setView('monthly')}>Mensual</button>
        </div>

        {view === 'annual' ? (
          <div style={s.controlGroup}>
            <label style={s.label}>Año</label>
            <select style={s.select} value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        ) : (
          <div style={s.controlGroup}>
            <label style={s.label}>Mes</label>
            <input style={s.select} type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
        )}
      </div>

      {loading && <p style={{ color: '#475569', fontSize: '0.9rem' }}>Cargando estadísticas...</p>}

      {/* Vista anual */}
      {!loading && annual && (
        <div style={s.content}>
          <h2 style={s.sectionTitle}>{annual.space_name} — {annual.year}</h2>

          {/* Totales resumen */}
          <div style={s.summaryGrid}>
            {[
              { label: 'Visitantes únicos', val: n(annual.totals.unique_visitors), color: '#06b6d4' },
              { label: 'Ingresos totales', val: n(annual.totals.entries), color: '#3b82f6' },
              { label: 'Días con actividad', val: String(annual.totals.days_with_activity), color: '#22c55e' },
              { label: 'Promedio diario', val: annual.totals.days_with_activity > 0 ? n(Math.round(annual.totals.entries / annual.totals.days_with_activity)) : '—', color: '#8b5cf6' },
            ].map(item => (
              <div key={item.label} style={s.summaryCard}>
                <span style={s.summaryLabel}>{item.label}</span>
                <span style={{ ...s.summaryVal, color: item.color }}>{item.val}</span>
              </div>
            ))}
          </div>

          {/* Tabla mensual */}
          {annual.monthly.length === 0 ? (
            <p style={{ color: '#475569', fontSize: '0.9rem' }}>Sin datos para {annual.year}.</p>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {['Mes', 'Visitantes únicos', 'Ingresos', 'Egresos', 'Días activos'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {annual.monthly.map(row => (
                    <tr key={row.month} style={s.tr}>
                      <td style={s.td}>{row.month_name}</td>
                      <td style={{ ...s.td, ...s.num, color: '#06b6d4' }}>{n(row.unique_visitors)}</td>
                      <td style={{ ...s.td, ...s.num }}>{n(row.entries)}</td>
                      <td style={{ ...s.td, ...s.num }}>{n(row.exits)}</td>
                      <td style={{ ...s.td, ...s.num }}>{row.days_with_activity}</td>
                    </tr>
                  ))}
                  <tr style={{ ...s.tr, borderTop: '2px solid #1e293b' }}>
                    <td style={{ ...s.td, fontWeight: 700, color: '#e2e8f0' }}>TOTAL</td>
                    <td style={{ ...s.td, ...s.num, color: '#06b6d4', fontWeight: 700 }}>{n(annual.totals.unique_visitors)}</td>
                    <td style={{ ...s.td, ...s.num, fontWeight: 700 }}>{n(annual.totals.entries)}</td>
                    <td style={{ ...s.td, ...s.num, fontWeight: 700 }}>{n(annual.totals.exits)}</td>
                    <td style={{ ...s.td, ...s.num, fontWeight: 700 }}>{annual.totals.days_with_activity}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Desgloses lado a lado */}
          <div style={s.breakdownGrid}>
            {/* Por categoría */}
            <div style={s.breakdownCard}>
              <h3 style={s.breakdownTitle}>Por tipo de usuario</h3>
              {annual.category_breakdown.length === 0
                ? <p style={s.noData}>Sin datos</p>
                : annual.category_breakdown.map(item => (
                  <div key={item.label} style={s.breakdownRow}>
                    <span style={s.breakdownName}>{item.label}</span>
                    <div style={s.barWrap}>
                      <div style={{ ...s.bar, width: `${(item.count / annual.totals.entries) * 100}%`, background: '#3b82f6' }} />
                    </div>
                    <span style={s.breakdownCount}>{n(item.count)}{pct(item.count, annual.totals.entries)}</span>
                  </div>
                ))
              }
            </div>

            {/* Por facultad */}
            <div style={s.breakdownCard}>
              <h3 style={s.breakdownTitle}>Por facultad</h3>
              {annual.faculty_breakdown.length === 0
                ? <p style={s.noData}>Sin datos</p>
                : annual.faculty_breakdown.slice(0, 8).map(item => (
                  <div key={item.label} style={s.breakdownRow}>
                    <span style={s.breakdownName}>{item.label}</span>
                    <div style={s.barWrap}>
                      <div style={{ ...s.bar, width: `${(item.count / (annual.faculty_breakdown[0]?.count || 1)) * 100}%`, background: '#8b5cf6' }} />
                    </div>
                    <span style={s.breakdownCount}>{n(item.count)}{pct(item.count, annual.totals.entries)}</span>
                  </div>
                ))
              }
            </div>

            {/* Por género */}
            <div style={s.breakdownCard}>
              <h3 style={s.breakdownTitle}>Por género (ingresos)</h3>
              {[
                { label: 'Hombres', val: annual.gender_breakdown.male, color: '#3b82f6' },
                { label: 'Mujeres', val: annual.gender_breakdown.female, color: '#ec4899' },
              ].map(item => {
                const total = annual.gender_breakdown.male + annual.gender_breakdown.female
                return (
                  <div key={item.label} style={s.breakdownRow}>
                    <span style={s.breakdownName}>{item.label}</span>
                    <div style={s.barWrap}>
                      <div style={{ ...s.bar, width: `${total > 0 ? (item.val / total) * 100 : 0}%`, background: item.color }} />
                    </div>
                    <span style={s.breakdownCount}>{n(item.val)}{pct(item.val, total)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Vista mensual */}
      {!loading && monthly && (
        <div style={s.content}>
          <h2 style={s.sectionTitle}>{monthly.space_name} — {monthly.year_month}</h2>

          {monthly.daily.length === 0 ? (
            <p style={{ color: '#475569', fontSize: '0.9rem' }}>Sin datos para este mes.</p>
          ) : (
            <>
              {/* Resumen del mes */}
              <div style={s.summaryGrid}>
                {[
                  { label: 'Días con actividad', val: String(monthly.daily.length), color: '#22c55e' },
                  { label: 'Total ingresos', val: n(monthly.daily.reduce((a, d) => a + d.entries, 0)), color: '#3b82f6' },
                  { label: 'Visitantes únicos', val: n(monthly.daily.reduce((a, d) => a + d.unique_visitors, 0)), color: '#06b6d4' },
                  { label: 'Promedio diario', val: n(Math.round(monthly.daily.reduce((a, d) => a + d.entries, 0) / monthly.daily.length)), color: '#8b5cf6' },
                ].map(item => (
                  <div key={item.label} style={s.summaryCard}>
                    <span style={s.summaryLabel}>{item.label}</span>
                    <span style={{ ...s.summaryVal, color: item.color }}>{item.val}</span>
                  </div>
                ))}
              </div>

              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      {['Fecha', 'Día', 'Visitantes únicos', 'Ingresos', 'Egresos'].map(h => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.daily.map(row => (
                      <tr key={row.date} style={s.tr}>
                        <td style={s.td}>{row.date}</td>
                        <td style={{ ...s.td, color: '#64748b' }}>{row.day_name}</td>
                        <td style={{ ...s.td, ...s.num, color: '#06b6d4' }}>{n(row.unique_visitors)}</td>
                        <td style={{ ...s.td, ...s.num }}>{n(row.entries)}</td>
                        <td style={{ ...s.td, ...s.num }}>{n(row.exits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', minHeight: 0, overflowY: 'auto' },
  controls: { display: 'flex', alignItems: 'flex-end', gap: '1.5rem', flexWrap: 'wrap' },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '0.5rem 0.75rem', background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '7px', color: '#e2e8f0', fontSize: '0.9rem', outline: 'none', cursor: 'pointer' },
  viewTabs: { display: 'flex', background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '8px', overflow: 'hidden' },
  tabBtn: { padding: '0.5rem 1.1rem', background: 'transparent', border: 'none', color: '#475569', fontSize: '0.875rem', cursor: 'pointer' },
  tabActive: { background: '#1e3a5f', color: '#e2e8f0', fontWeight: 600 },
  content: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  sectionTitle: { fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' },
  summaryCard: { background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  summaryLabel: { fontSize: '0.75rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' },
  summaryVal: { fontSize: '1.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: { textAlign: 'left', padding: '0.6rem 0.9rem', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #1e293b' },
  tr: { borderBottom: '1px solid #0f2540' },
  td: { padding: '0.6rem 0.9rem', color: '#cbd5e1' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  breakdownGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' },
  breakdownCard: { background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '10px', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  breakdownTitle: { fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  breakdownName: { fontSize: '0.8rem', color: '#94a3b8', width: '90px', flexShrink: 0 },
  barWrap: { flex: 1, height: 6, background: '#132235', borderRadius: 999, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 999, transition: 'width 0.5s ease' },
  breakdownCount: { fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 },
  noData: { fontSize: '0.85rem', color: '#334155' },
}
