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
const SPACE_ID_KEY = 'inout_space_id'

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

// ── Íconos del header — hoisted, heredan color vía currentColor ────────────
const ICON_BUILDING = (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="4" y="3" width="12" height="15" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7.2 6.6h1.4M11.4 6.6h1.4M7.2 10h1.4M11.4 10h1.4M7.2 13.4h1.4M11.4 13.4h1.4"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const ICON_GEAR = (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="2.7" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 3.3v2.1M10 14.6v2.1M16.7 10h-2.1M5.4 10H3.3M14.7 5.3l-1.5 1.5M6.8 13.2l-1.5 1.5M14.7 14.7l-1.5-1.5M6.8 6.8L5.3 5.3"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const ICON_CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M5.5 8 L10 12.5 L14.5 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ── HomeDashboard ────────────────────────────────────────────────────────────
export function HomeDashboard(): JSX.Element {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('occupancy')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(() => {
    const stored = localStorage.getItem(SPACE_ID_KEY)
    return stored ? Number(stored) : null
  })
  const pickerRef = useRef<HTMLDivElement>(null)

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

  const selectBuilding = (id: number) => {
    localStorage.setItem(SPACE_ID_KEY, String(id))
    window.location.href = '/kiosko'
  }

  // Cerrar el selector de edificio con click afuera o Escape.
  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  const activeBuilding = data?.buildings.find(b => b.id === activeSpaceId)

  // Agrupación por campus para el selector — TODOS los edificios, sin el
  // filtro de búsqueda del listado principal (son propósitos distintos).
  const pickerGroups = useMemo(() => {
    if (!data) return []
    const byKey = new Map<string, { key: string; label: string; items: BuildingOverview[] }>()
    for (const b of data.buildings) {
      const key = b.sede_id !== null ? `sede-${b.sede_id}` : '__sin_sede__'
      const label = b.sede_name ?? 'Otros'
      let g = byKey.get(key)
      if (!g) { g = { key, label, items: [] }; byKey.set(key, g) }
      g.items.push(b)
    }
    const list = Array.from(byKey.values())
    list.sort((a, b) => {
      if (a.label === 'Otros') return 1
      if (b.label === 'Otros') return -1
      return a.label.localeCompare(b.label, 'es')
    })
    return list
  }, [data])

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

        <div className="hd-topbar-actions">
          {hasBuildings && (
            <div className="hd-picker" ref={pickerRef}>
              <button
                className="hd-picker-trigger"
                onClick={() => setPickerOpen(v => !v)}
                aria-expanded={pickerOpen}
                aria-haspopup="true"
              >
                {ICON_BUILDING}
                {activeBuilding ? activeBuilding.name : 'Elegir edificio'}
                <span className="hd-picker-chevron">{ICON_CHEVRON}</span>
              </button>

              {pickerOpen && (
                <div className="hd-picker-menu" role="menu">
                  <span className="hd-picker-hint">Configurar este dispositivo como kiosko de…</span>
                  {pickerGroups.map(group => (
                    <div className="hd-picker-group" key={group.key}>
                      {pickerGroups.length > 1 && (
                        <span className="hd-picker-group-label">{group.label}</span>
                      )}
                      {group.items.map(b => (
                        <button
                          key={b.id}
                          className="hd-picker-item"
                          data-active={b.id === activeSpaceId}
                          role="menuitem"
                          onClick={() => selectBuilding(b.id)}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <a className="hd-admin-link" href="/admin" title="Administración">
            {ICON_GEAR}
            Admin
          </a>
        </div>
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
  flex-wrap: wrap;
  gap: 14px;
  padding-bottom: clamp(14px, 2vh, 20px);
  margin-bottom: clamp(22px, 3.2vh, 36px);
  border-bottom: 1px solid var(--c-border);
}
.hd-brand {
  font-size: clamp(13px, 1.6vw, 16px);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--c-text3);
}
.hd-topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ── Selector de edificio (popover) — la acción principal del header, con
   mayor peso visual que Admin: fondo propio, borde marcado, ícono a color. ── */
.hd-picker { position: relative; }
.hd-picker-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--c-bg-panel);
  border: 1.5px solid var(--c-border);
  border-radius: 11px;
  padding: 10px 16px;
  color: var(--c-text1);
  font-family: 'Barlow', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 160ms ease-out, background 160ms ease-out, transform 160ms ease-out;
}
.hd-picker-trigger svg { color: var(--c-blue); flex-shrink: 0; }
.hd-picker-trigger:hover { border-color: var(--c-blue); background: var(--c-bg); }
.hd-picker-trigger:active { transform: scale(0.97); }
.hd-picker-trigger:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }
.hd-picker-chevron {
  display: flex;
  color: var(--c-text3);
  margin-left: 1px;
  transition: transform 160ms ease-out;
}
.hd-picker-trigger[aria-expanded="true"] .hd-picker-chevron { transform: rotate(180deg); }

.hd-picker-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  max-width: 300px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.35);
  transform-origin: top right;
  animation: hdPickerIn 160ms cubic-bezier(0.23,1,0.32,1) forwards;
  z-index: 20;
}
@keyframes hdPickerIn {
  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.hd-picker-hint {
  display: block;
  font-size: 11px;
  color: var(--c-text4);
  padding: 4px 8px 8px;
}
.hd-picker-group + .hd-picker-group { margin-top: 6px; }
.hd-picker-group-label {
  display: block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-text4);
  padding: 4px 8px 2px;
}
.hd-picker-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 7px;
  padding: 7px 8px;
  color: var(--c-text2);
  font-family: 'Barlow', sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: background 130ms ease-out, color 130ms ease-out;
}
.hd-picker-item:hover { background: var(--c-border); color: var(--c-text1); }
.hd-picker-item:focus-visible { outline: 2px solid var(--c-blue); outline-offset: -2px; }
.hd-picker-item[data-active="true"] { color: var(--c-blue); font-weight: 600; }

/* ── Link a administración — visible pero secundario frente al selector ── */
.hd-admin-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--c-text2);
  font-family: 'Barlow', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  text-decoration: none;
  padding: 10px 15px;
  border-radius: 11px;
  border: 1.5px solid transparent;
  transition: color 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out;
}
.hd-admin-link svg { flex-shrink: 0; }
.hd-admin-link:hover { color: var(--c-text1); background: var(--c-bg-panel); border-color: var(--c-border); }
.hd-admin-link:active { transform: scale(0.97); }
.hd-admin-link:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }

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

/* ── Controls ──
   Utilitarios secundarios (filtrar/ordenar la lista de abajo), no acciones
   principales del dashboard — deliberadamente pequeños y discretos. */
.hd-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: clamp(16px, 2.4vh, 22px);
}
.hd-search {
  flex: 0 1 220px;
  min-width: 140px;
  max-width: 280px;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 6px 10px;
  color: var(--c-text1);
  font-family: 'Barlow', sans-serif;
  font-size: 13px;
  outline: none;
  transition: border-color 160ms ease-out;
}
.hd-search::placeholder { color: var(--c-text4); }
.hd-search:focus { border-color: var(--c-blue); }

.hd-sort {
  display: flex;
  gap: 2px;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 2px;
}
.hd-sort-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 6px;
  font-family: 'Barlow', sans-serif;
  font-size: 12px;
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
