import { useEffect, useMemo, useRef, useState } from 'react'

// ── Contrato de GET /api/spaces/overview (congelado) ────────────────────────
interface BuildingOverview {
  id: number
  name: string
  sede_id: number | null
  sede_code: string | null
  sede_name: string | null
  capacity: number
  current_occupancy: number
  occupancy_percent: number
  entries_today: number
  exits_today: number
}

interface OverviewResponse {
  as_of: string
  totals: {
    capacity: number
    current_occupancy: number
    occupancy_percent: number
    buildings: number
  }
  buildings: BuildingOverview[]
}

const REFRESH_MS = 30000
const RETRY_MS = 8000

type SortMode = 'occupancy' | 'alpha'

// Umbrales de estado — mismo criterio en toda la app: <50 verde, 50–80 ámbar, >80 rojo.
function statusColor(pct: number): string {
  if (pct > 80) return 'var(--c-red)'
  if (pct >= 50) return 'var(--c-amber)'
  return 'var(--c-green)'
}

function fmtInt(n: number): string {
  return n.toLocaleString('es-PE')
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`
}

// ── HomeDashboard ────────────────────────────────────────────────────────────
export function HomeDashboard(): JSX.Element {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('occupancy')

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Fetch + refetch cada 30s. Si falla, reintenta más seguido (8s) hasta que
  // vuelva a responder — nunca se queda colgada en un spinner infinito: si ya
  // había datos, se quedan visibles (con aviso discreto) mientras reintenta.
  useEffect(() => {
    let cancelled = false
    let timeoutId: number

    const tick = async () => {
      try {
        const res = await fetch('/api/spaces/overview')
        if (!res.ok) throw new Error('bad status')
        const json: OverviewResponse = await res.json()
        if (cancelled || !mountedRef.current) return
        setData(json)
        setError(false)
        timeoutId = window.setTimeout(tick, REFRESH_MS)
      } catch {
        if (cancelled || !mountedRef.current) return
        setError(true)
        timeoutId = window.setTimeout(tick, RETRY_MS)
      }
    }

    tick()
    return () => { cancelled = true; window.clearTimeout(timeoutId) }
  }, [])

  const goToKiosko = () => { window.location.href = '/kiosko' }

  // ── Filtro + agrupación por campus + orden ──────────────────────────────
  const groups = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? data.buildings.filter(b =>
          b.name.toLowerCase().includes(q) || (b.sede_name ?? '').toLowerCase().includes(q))
      : data.buildings

    const byKey = new Map<string, { key: string; label: string; items: BuildingOverview[] }>()
    for (const b of filtered) {
      const key = b.sede_id !== null ? `sede-${b.sede_id}` : '__sin_sede__'
      const label = b.sede_name ?? 'Otros'
      let g = byKey.get(key)
      if (!g) { g = { key, label, items: [] }; byKey.set(key, g) }
      g.items.push(b)
    }

    const sortItems = (items: BuildingOverview[]) => {
      const arr = [...items]
      if (sortMode === 'alpha') {
        arr.sort((a, b) => a.name.localeCompare(b.name, 'es'))
      } else {
        arr.sort((a, b) => b.occupancy_percent - a.occupancy_percent || a.name.localeCompare(b.name, 'es'))
      }
      return arr
    }

    const list = Array.from(byKey.values()).map(g => ({ ...g, items: sortItems(g.items) }))
    list.sort((a, b) => {
      if (a.label === 'Otros') return 1
      if (b.label === 'Otros') return -1
      return a.label.localeCompare(b.label, 'es')
    })
    return list
  }, [data, query, sortMode])

  // Orden estable de entrada (stagger) — asignado una sola vez por edificio,
  // nunca recalculado cuando cambia el sort/orden, así el toggle no re-dispara
  // la animación de montaje.
  const mountOrderRef = useRef(new Map<number, number>())
  const nextIdxRef = useRef(0)
  const mountDelay = (id: number): number => {
    let idx = mountOrderRef.current.get(id)
    if (idx === undefined) {
      idx = nextIdxRef.current++
      mountOrderRef.current.set(id, idx)
    }
    return Math.min(idx, 10) * 30
  }

  const showGroupHeaders = groups.length > 1
  const totalMatches = groups.reduce((sum, g) => sum + g.items.length, 0)
  const hasBuildings = (data?.buildings.length ?? 0) > 0

  return (
    <div className="hd-page">
      <style>{CSS}</style>

      <div className="hd-topbar">
        <span className="hd-brand">InOut · Ocupación en vivo</span>
        <button className="hd-kiosk-link" onClick={goToKiosko}>
          Configurar este kiosko
        </button>
      </div>

      {/* ── Sin datos todavía, sin error: primera carga ── */}
      {!data && !error && (
        <div className="hd-state">
          <span className="hd-state-title">Cargando ocupación…</span>
        </div>
      )}

      {/* ── Sin datos, y el primer intento falló ── */}
      {!data && error && (
        <div className="hd-state">
          <span className="hd-state-title">Sin conexión con el servidor</span>
          <span className="hd-state-sub">
            Reintentando automáticamente cada {RETRY_MS / 1000}s. Esta página se
            actualizará sola apenas vuelva la conexión.
          </span>
        </div>
      )}

      {/* ── Hay datos: dashboard completo (0 edificios incluido) ── */}
      {data && (
        <>
          {error && (
            <div className="hd-error-banner" role="status">
              <span>⚠</span>
              <span>Sin conexión — mostrando el último dato recibido, reintentando…</span>
            </div>
          )}

          <TotalsBand totals={data.totals} asOf={data.as_of} />

          {!hasBuildings ? (
            <div className="hd-state">
              <span className="hd-state-title">No hay edificios configurados</span>
              <span className="hd-state-sub">
                Todavía no se registró ningún espacio para monitorear aforo. Un
                administrador debe crear los edificios en el panel de
                administración, o puedes configurar este dispositivo como
                kiosko de un edificio ya existente.
              </span>
              <button className="hd-state-action" onClick={goToKiosko}>
                Configurar este kiosko
              </button>
            </div>
          ) : (
            <>
              <div className="hd-controls">
                <input
                  className="hd-search"
                  type="text"
                  placeholder="Buscar edificio o campus…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  aria-label="Buscar edificio o campus"
                />
                <div className="hd-sort" role="group" aria-label="Ordenar por">
                  <button
                    className="hd-sort-btn"
                    data-active={sortMode === 'occupancy'}
                    onClick={() => setSortMode('occupancy')}
                  >
                    % Ocupación
                  </button>
                  <button
                    className="hd-sort-btn"
                    data-active={sortMode === 'alpha'}
                    onClick={() => setSortMode('alpha')}
                  >
                    A–Z
                  </button>
                </div>
              </div>

              {totalMatches === 0 ? (
                <div className="hd-state hd-state-compact">
                  <span className="hd-state-title">Sin resultados para “{query}”</span>
                  <span className="hd-state-sub">Probá con otro nombre de edificio o campus.</span>
                  <button className="hd-state-action" onClick={() => setQuery('')}>
                    Limpiar búsqueda
                  </button>
                </div>
              ) : (
                groups.map(group => (
                  <section className="hd-group" key={group.key}>
                    {showGroupHeaders && (
                      <h2 className="hd-group-label">
                        {group.label}
                        <span className="hd-group-count">{group.items.length}</span>
                      </h2>
                    )}
                    <div className="hd-grid">
                      {group.items.map(b => (
                        <BuildingCard key={b.id} building={b} delayMs={mountDelay(b.id)} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── TotalsBand ───────────────────────────────────────────────────────────────
function TotalsBand({
  totals, asOf,
}: { totals: OverviewResponse['totals']; asOf: string }) {
  const color = statusColor(totals.occupancy_percent)
  const barWidth = Math.min(100, Math.max(0, totals.occupancy_percent))
  const asOfTime = new Date(asOf).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="hd-totals">
      <div className="hd-totals-main">
        <span className="hd-totals-number" style={{ color }}>{fmtInt(totals.current_occupancy)}</span>
        <span className="hd-totals-of">/ {fmtInt(totals.capacity)} personas</span>
      </div>
      <div className="hd-totals-side">
        <span className="hd-totals-pct" style={{ color }}>{fmtPct(totals.occupancy_percent)}</span>
        <span className="hd-totals-label">
          ocupación combinada · {totals.buildings} {totals.buildings === 1 ? 'edificio' : 'edificios'}
        </span>
      </div>
      <div className="hd-totals-bar-wrap">
        <div className="hd-totals-bar">
          <div className="hd-totals-bar-fill" style={{ width: `${barWidth}%`, background: color }} />
        </div>
      </div>
      <span className="hd-totals-asof">Actualizado {asOfTime}</span>
    </div>
  )
}

// ── BuildingCard ─────────────────────────────────────────────────────────────
function BuildingCard({
  building, delayMs,
}: { building: BuildingOverview; delayMs: number }) {
  const color = statusColor(building.occupancy_percent)
  const barWidth = Math.min(100, Math.max(0, building.occupancy_percent))

  return (
    <article className="hd-card" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="hd-card-header">
        <span className="hd-card-name">{building.name}</span>
        <span className="hd-card-pct" style={{ color }}>{fmtPct(building.occupancy_percent)}</span>
      </div>

      <div className="hd-card-occ">
        <span className="hd-card-occ-num" style={{ color }}>{fmtInt(building.current_occupancy)}</span>
        <span className="hd-card-occ-cap">/ {fmtInt(building.capacity)}</span>
      </div>

      <div className="hd-meter" role="img" aria-label={`${fmtPct(building.occupancy_percent)} de aforo ocupado`}>
        <div className="hd-meter-fill" style={{ width: `${barWidth}%`, background: color }} />
      </div>

      <div className="hd-card-flow">
        <span className="hd-flow-item"><span aria-hidden="true">↑</span> {fmtInt(building.entries_today)} hoy</span>
        <span className="hd-flow-item"><span aria-hidden="true">↓</span> {fmtInt(building.exits_today)} hoy</span>
      </div>
    </article>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const CSS = `
.hd-page {
  min-height: 100vh;
  width: 100%;
  box-sizing: border-box;
  background: var(--c-bg);
  color: var(--c-text1);
  font-family: 'Barlow', system-ui, sans-serif;
  padding: clamp(20px, 3vw, 40px) clamp(16px, 4vw, 56px) clamp(48px, 6vw, 80px);
}
.hd-page * { box-sizing: border-box; }

.hd-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: clamp(20px, 3vh, 32px);
}
.hd-brand {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--c-text3);
}
.hd-kiosk-link {
  background: none;
  border: none;
  color: var(--c-text4);
  font-family: 'Barlow', sans-serif;
  font-size: 12px;
  letter-spacing: 0.02em;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 7px;
  transition: color 160ms ease-out, background 160ms ease-out;
}
.hd-kiosk-link:hover { color: var(--c-text2); background: var(--c-bg-panel); }
.hd-kiosk-link:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }

/* ── Totals band ── */
.hd-totals {
  border: 1px solid var(--c-border);
  background: var(--c-bg-panel);
  border-radius: 16px;
  padding: clamp(20px, 3vh, 32px) clamp(20px, 3vw, 36px);
  margin-bottom: clamp(24px, 3.5vh, 40px);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 6px clamp(16px, 3vw, 40px);
}
.hd-totals-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.hd-totals-number {
  font-family: 'Bebas Neue', 'Arial Narrow', impact, sans-serif;
  font-size: clamp(44px, 7vw, 88px);
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.hd-totals-of {
  font-size: clamp(15px, 2vw, 22px);
  color: var(--c-text3);
  font-weight: 500;
}
.hd-totals-side {
  margin-left: auto;
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hd-totals-pct {
  font-family: 'Bebas Neue', 'Arial Narrow', impact, sans-serif;
  font-size: clamp(26px, 3.4vw, 38px);
  line-height: 1;
  letter-spacing: 0.01em;
}
.hd-totals-label {
  font-size: 13px;
  color: var(--c-text3);
}
.hd-totals-bar-wrap { flex-basis: 100%; }
.hd-totals-bar {
  height: 8px;
  border-radius: 99px;
  background: var(--c-border);
  overflow: hidden;
  margin-top: 6px;
}
.hd-totals-bar-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 700ms cubic-bezier(0.22,1,0.36,1), background 400ms ease-out;
}
.hd-totals-asof {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--c-text4);
  margin-top: -2px;
}

/* ── Error banner (no bloqueante) ── */
.hd-error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  font-size: 13px;
  color: var(--c-amber);
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 8px 14px;
  margin-bottom: clamp(16px, 2vh, 24px);
}

/* ── Controls ── */
.hd-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: clamp(20px, 3vh, 28px);
}
.hd-search {
  flex: 1 1 240px;
  min-width: 180px;
  max-width: 420px;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 10px 14px;
  color: var(--c-text1);
  font-family: 'Barlow', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 160ms ease-out;
}
.hd-search::placeholder { color: var(--c-text4); }
.hd-search:focus { border-color: var(--c-blue); }

.hd-sort {
  display: flex;
  gap: 3px;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 3px;
}
.hd-sort-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 7px 13px;
  border-radius: 7px;
  font-family: 'Barlow', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text3);
  transition: background 160ms ease-out, color 160ms ease-out;
}
.hd-sort-btn:hover { color: var(--c-text1); }
.hd-sort-btn:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }
.hd-sort-btn[data-active="true"] {
  background: var(--c-border);
  color: var(--c-text1);
}

/* ── Groups / grid ── */
.hd-group + .hd-group { margin-top: clamp(28px, 4vh, 44px); }
.hd-group-label {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--c-text3);
  margin: 0 0 14px;
}
.hd-group-count {
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--c-text4);
}
.hd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: clamp(12px, 1.6vw, 20px);
}

/* ── Card ── */
.hd-card {
  border: 1px solid var(--c-border);
  background: var(--c-bg-panel);
  border-radius: 14px;
  padding: clamp(16px, 2vw, 22px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  animation: hdCardIn 380ms cubic-bezier(0.23,1,0.32,1) forwards;
}
@keyframes hdCardIn {
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.hd-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.hd-card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text1);
  line-height: 1.25;
}
.hd-card-pct {
  font-family: 'Bebas Neue', 'Arial Narrow', impact, sans-serif;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.hd-card-occ {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.hd-card-occ-num {
  font-family: 'Bebas Neue', 'Arial Narrow', impact, sans-serif;
  font-size: clamp(32px, 4vw, 42px);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.hd-card-occ-cap {
  font-size: 14px;
  color: var(--c-text3);
}
.hd-meter {
  height: 6px;
  border-radius: 99px;
  background: var(--c-border);
  overflow: hidden;
}
.hd-meter-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 700ms cubic-bezier(0.22,1,0.36,1);
}
.hd-card-flow {
  display: flex;
  gap: 18px;
  font-size: 13px;
  color: var(--c-text2);
}
.hd-flow-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

/* ── Estados vacío / error ── */
.hd-state {
  min-height: 46vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 40px 20px;
}
.hd-state-compact { min-height: 20vh; padding: 32px 20px; }
.hd-state-title {
  font-size: clamp(17px, 2.2vw, 21px);
  font-weight: 700;
  color: var(--c-text1);
}
.hd-state-sub {
  font-size: 14px;
  color: var(--c-text3);
  max-width: 440px;
  line-height: 1.5;
}
.hd-state-action {
  margin-top: 6px;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  color: var(--c-text1);
  font-family: 'Barlow', sans-serif;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 160ms ease-out, transform 160ms ease-out;
}
.hd-state-action:hover { border-color: var(--c-blue); }
.hd-state-action:active { transform: scale(0.97); }
.hd-state-action:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .hd-card { animation: none; opacity: 1; transform: none; }
  .hd-totals-bar-fill, .hd-meter-fill { transition: none; }
}
`
