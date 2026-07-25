import { useEffect, useState } from 'react'

interface Sede { id: number; name: string; code: string }
interface Space { id: number; sede_id: number | null; sede: Sede | null; name: string; active: boolean }
interface MonthRow { month: number; month_name: string; unique_visitors: number; entries: number; exits: number; days_with_activity: number }
interface Totals { unique_visitors: number; entries: number; exits: number; days_with_activity: number }
interface BreakdownItem { category?: string; faculty?: string; program?: string; label: string; count: number }
interface GenderBreakdown { male: number; female: number }
interface StatsFilters {
  sede_id: number | null; space_id: number | null
  category: string | null; faculty: string | null; program: string | null
}
interface AnnualReport {
  scope_label: string; year: number
  monthly: MonthRow[]; totals: Totals
  category_breakdown: BreakdownItem[]
  faculty_breakdown: BreakdownItem[]
  program_breakdown: BreakdownItem[]
  gender_breakdown: GenderBreakdown
  filters: StatsFilters
}
interface DayRow { date: string; day_name: string; unique_visitors: number; entries: number; exits: number }
interface MonthlyReport { scope_label: string; year_month: string; daily: DayRow[]; filters: StatsFilters }
interface FilterOptions {
  sedes: Sede[]
  spaces: Space[]
  categories: { category: string; label: string; count: number }[]
  faculties: string[]
  programs: string[]
}

interface Props { token: string }

// ── Exportar CSV — a partir de lo ya cargado en pantalla, sin ida y vuelta
// al backend. BOM (﻿) al inicio: sin esto Excel malinterpreta los
// acentos/ñ de un CSV UTF-8 como si fuera otra codificación.
function csvCell(val: string | number): string {
  const str = String(val)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportAnnualCSV(annual: AnnualReport) {
  const rows: (string | number)[][] = [
    [`Reporte anual — ${annual.scope_label} — ${annual.year}`], [],
    ['Mes', 'Visitantes únicos', 'Ingresos', 'Egresos', 'Días con actividad'],
    ...annual.monthly.map(r => [r.month_name, r.unique_visitors, r.entries, r.exits, r.days_with_activity]),
    ['TOTAL', annual.totals.unique_visitors, annual.totals.entries, annual.totals.exits, annual.totals.days_with_activity],
    [],
    ['Por tipo de usuario'], ['Categoría', 'Visitantes'],
    ...annual.category_breakdown.map(c => [c.label, c.count]),
    [],
    ['Por facultad'], ['Facultad', 'Visitantes'],
    ...annual.faculty_breakdown.map(f => [f.label, f.count]),
    [],
    ['Por programa académico'], ['Programa', 'Visitantes'],
    ...annual.program_breakdown.map(p => [p.label, p.count]),
    [],
    ['Por género (ingresos)'], ['Género', 'Ingresos'],
    ['Hombres', annual.gender_breakdown.male],
    ['Mujeres', annual.gender_breakdown.female],
  ]
  downloadCSV(`inout-anual-${annual.year}.csv`, rows)
}

function exportMonthlyCSV(monthly: MonthlyReport) {
  const rows: (string | number)[][] = [
    [`Reporte mensual — ${monthly.scope_label} — ${monthly.year_month}`], [],
    ['Fecha', 'Día', 'Visitantes únicos', 'Ingresos', 'Egresos'],
    ...monthly.daily.map(d => [d.date, d.day_name, d.unique_visitors, d.entries, d.exits]),
  ]
  downloadCSV(`inout-mensual-${monthly.year_month}.csv`, rows)
}

export function StatsPage({ token }: Props) {
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)
  // Ámbito codificado en un solo valor: 'all' | 'sede:<id>' | 'space:<id>' —
  // un select con optgroups (Todo el sistema / por campus / sus edificios)
  // es más directo en un panel admin denso que un flujo de 2 pasos.
  const [scope, setScope] = useState('all')
  const [category, setCategory] = useState('')
  const [faculty, setFaculty] = useState('')
  const [program, setProgram] = useState('')
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
    fetch('/api/admin/stats/filters', { headers })
      .then(r => r.json())
      .then(setFilterOptions)
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (scope.startsWith('sede:')) params.set('sede_id', scope.slice(5))
    else if (scope.startsWith('space:')) params.set('space_id', scope.slice(6))
    if (category) params.set('category', category)
    if (faculty) params.set('faculty', faculty)
    if (program) params.set('program', program)

    if (view === 'annual') {
      params.set('year', String(year))
      fetch(`/api/admin/stats/annual?${params}`, { headers })
        .then(r => r.json())
        .then(d => { setAnnual(d); setMonthly(null) })
        .finally(() => setLoading(false))
    } else {
      params.set('month', month)
      fetch(`/api/admin/stats/monthly?${params}`, { headers })
        .then(r => r.json())
        .then(d => { setMonthly(d); setAnnual(null) })
        .finally(() => setLoading(false))
    }
  }, [scope, category, faculty, program, view, year, month])

  const pct = (val: number, total: number) =>
    total > 0 ? ` (${((val / total) * 100).toFixed(0)}%)` : ''

  const n = (val: number) => val.toLocaleString('es-PE')

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)
  const sedesWithSpaces = filterOptions?.sedes.map(sede => ({
    sede,
    spaces: filterOptions.spaces.filter(sp => sp.sede_id === sede.id),
  })) ?? []

  return (
    <div style={s.page}>
      {/* Controles */}
      <div style={s.controls}>
        <div style={s.controlGroup}>
          <label style={s.label}>Ámbito</label>
          <select style={s.select} value={scope} onChange={e => setScope(e.target.value)}>
            <option value="all">Todo el sistema</option>
            {sedesWithSpaces.map(({ sede, spaces }) => (
              <optgroup key={sede.id} label={sede.name}>
                <option value={`sede:${sede.id}`}>Todo {sede.name}</option>
                {spaces.map(sp => (
                  <option key={sp.id} value={`space:${sp.id}`}>{sp.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div style={s.controlGroup}>
          <label style={s.label}>Tipo de usuario</label>
          <select style={s.select} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Todos</option>
            {filterOptions?.categories.map(c => (
              <option key={c.category} value={c.category}>{c.label}</option>
            ))}
          </select>
        </div>

        <div style={s.controlGroup}>
          <label style={s.label}>Facultad</label>
          <select style={s.select} value={faculty} onChange={e => setFaculty(e.target.value)}>
            <option value="">Todas</option>
            {filterOptions?.faculties.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div style={s.controlGroup}>
          <label style={s.label}>Programa académico</label>
          <select style={s.select} value={program} onChange={e => setProgram(e.target.value)}>
            <option value="">Todos</option>
            {filterOptions?.programs.map(p => <option key={p} value={p}>{p}</option>)}
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

        <button
          style={s.exportBtn}
          disabled={!annual && !monthly}
          onClick={() => { if (annual) exportAnnualCSV(annual); else if (monthly) exportMonthlyCSV(monthly) }}
        >
          ⬇ Exportar CSV
        </button>
      </div>

      {loading && <p style={{ color: 'var(--c-text3)', fontSize: '0.9rem' }}>Cargando estadísticas...</p>}

      {/* Vista anual */}
      {!loading && annual && (
        <div style={s.content}>
          <h2 style={s.sectionTitle}>{annual.scope_label} — {annual.year}</h2>

          {/* Totales resumen */}
          <div style={s.summaryGrid}>
            {[
              { label: 'Visitantes únicos', val: n(annual.totals.unique_visitors), color: 'var(--c-cyan)' },
              { label: 'Ingresos totales', val: n(annual.totals.entries), color: 'var(--c-blue)' },
              { label: 'Días con actividad', val: String(annual.totals.days_with_activity), color: 'var(--c-green)' },
              { label: 'Promedio diario', val: annual.totals.days_with_activity > 0 ? n(Math.round(annual.totals.entries / annual.totals.days_with_activity)) : '—', color: 'var(--c-purple)' },
            ].map(item => (
              <div key={item.label} style={s.summaryCard}>
                <span style={s.summaryLabel}>{item.label}</span>
                <span style={{ ...s.summaryVal, color: item.color }}>{item.val}</span>
              </div>
            ))}
          </div>

          {/* Tabla mensual */}
          {annual.monthly.length === 0 ? (
            <p style={{ color: 'var(--c-text3)', fontSize: '0.9rem' }}>Sin datos para {annual.year} con estos filtros.</p>
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
                      <td style={{ ...s.td, ...s.num, color: 'var(--c-cyan)' }}>{n(row.unique_visitors)}</td>
                      <td style={{ ...s.td, ...s.num }}>{n(row.entries)}</td>
                      <td style={{ ...s.td, ...s.num }}>{n(row.exits)}</td>
                      <td style={{ ...s.td, ...s.num }}>{row.days_with_activity}</td>
                    </tr>
                  ))}
                  <tr style={{ ...s.tr, borderTop: '2px solid var(--c-border)' }}>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--c-text1)' }}>TOTAL</td>
                    <td style={{ ...s.td, ...s.num, color: 'var(--c-cyan)', fontWeight: 700 }}>{n(annual.totals.unique_visitors)}</td>
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
                      <div style={{ ...s.bar, width: `${(item.count / annual.totals.entries) * 100}%`, background: 'var(--c-blue)' }} />
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
                      <div style={{ ...s.bar, width: `${(item.count / (annual.faculty_breakdown[0]?.count || 1)) * 100}%`, background: 'var(--c-purple)' }} />
                    </div>
                    <span style={s.breakdownCount}>{n(item.count)}{pct(item.count, annual.totals.entries)}</span>
                  </div>
                ))
              }
            </div>

            {/* Por programa académico */}
            <div style={s.breakdownCard}>
              <h3 style={s.breakdownTitle}>Por programa académico</h3>
              {annual.program_breakdown.length === 0
                ? <p style={s.noData}>Sin datos</p>
                : annual.program_breakdown.slice(0, 8).map(item => (
                  <div key={item.label} style={s.breakdownRow}>
                    <span style={s.breakdownName}>{item.label}</span>
                    <div style={s.barWrap}>
                      <div style={{ ...s.bar, width: `${(item.count / (annual.program_breakdown[0]?.count || 1)) * 100}%`, background: 'var(--c-cyan)' }} />
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
                { label: 'Hombres', val: annual.gender_breakdown.male, color: 'var(--c-blue)' },
                { label: 'Mujeres', val: annual.gender_breakdown.female, color: 'var(--c-rose)' },
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
          <h2 style={s.sectionTitle}>{monthly.scope_label} — {monthly.year_month}</h2>

          {monthly.daily.length === 0 ? (
            <p style={{ color: 'var(--c-text3)', fontSize: '0.9rem' }}>Sin datos para este mes con estos filtros.</p>
          ) : (
            <>
              {/* Resumen del mes */}
              <div style={s.summaryGrid}>
                {[
                  { label: 'Días con actividad', val: String(monthly.daily.length), color: 'var(--c-green)' },
                  { label: 'Total ingresos', val: n(monthly.daily.reduce((a, d) => a + d.entries, 0)), color: 'var(--c-blue)' },
                  { label: 'Visitantes únicos', val: n(monthly.daily.reduce((a, d) => a + d.unique_visitors, 0)), color: 'var(--c-cyan)' },
                  { label: 'Promedio diario', val: n(Math.round(monthly.daily.reduce((a, d) => a + d.entries, 0) / monthly.daily.length)), color: 'var(--c-purple)' },
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
                        <td style={{ ...s.td, color: 'var(--c-text3)' }}>{row.day_name}</td>
                        <td style={{ ...s.td, ...s.num, color: 'var(--c-cyan)' }}>{n(row.unique_visitors)}</td>
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
  controls: { display: 'flex', alignItems: 'flex-end', gap: '1.25rem', flexWrap: 'wrap' },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: '0.75rem', color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '0.5rem 0.75rem', background: 'var(--c-bg-panel)', border: '1px solid var(--c-border)', borderRadius: '7px', color: 'var(--c-text1)', fontSize: '0.9rem', outline: 'none', cursor: 'pointer', maxWidth: '220px' },
  viewTabs: { display: 'flex', background: 'var(--c-bg-panel)', border: '1px solid var(--c-border)', borderRadius: '8px', overflow: 'hidden' },
  tabBtn: { padding: '0.5rem 1.1rem', background: 'transparent', border: 'none', color: 'var(--c-text3)', fontSize: '0.875rem', cursor: 'pointer' },
  tabActive: { background: 'var(--c-border)', color: 'var(--c-text1)', fontWeight: 600 },
  exportBtn: {
    marginLeft: 'auto', padding: '0.55rem 1rem',
    background: 'var(--c-blue)', border: 'none', borderRadius: '8px',
    color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
  },
  content: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  sectionTitle: { fontSize: '1.05rem', fontWeight: 700, color: 'var(--c-text1)' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' },
  summaryCard: { background: 'var(--c-bg-panel)', border: '1px solid var(--c-border)', borderRadius: '10px', padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  summaryLabel: { fontSize: '0.75rem', color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  summaryVal: { fontSize: '1.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: { textAlign: 'left', padding: '0.6rem 0.9rem', color: 'var(--c-text3)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--c-border)' },
  tr: { borderBottom: '1px solid var(--c-border)' },
  td: { padding: '0.6rem 0.9rem', color: 'var(--c-text2)' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  breakdownGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' },
  breakdownCard: { background: 'var(--c-bg-panel)', border: '1px solid var(--c-border)', borderRadius: '10px', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  breakdownTitle: { fontSize: '0.8rem', color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  breakdownName: { fontSize: '0.8rem', color: 'var(--c-text2)', width: '90px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  barWrap: { flex: 1, height: 6, background: 'var(--c-border)', borderRadius: 999, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 999, transition: 'width 0.5s ease' },
  breakdownCount: { fontSize: '0.8rem', color: 'var(--c-text3)', whiteSpace: 'nowrap', flexShrink: 0 },
  noData: { fontSize: '0.85rem', color: 'var(--c-border)' },
}
