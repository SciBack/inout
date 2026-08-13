import { useEffect, useMemo, useRef, useState } from 'react'
import { clearAdminSession, getAdminSession } from '../utils/adminSession'
import ThemePicker from '../components/ThemePicker'
import type { ThemePreference } from '../utils/themePreference'

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

interface CampusGroup {
  key: string
  label: string
  items: BuildingOverview[]
  capacity: number
  occupancy: number
  occupancyPercent: number
}

const REFRESH_MS = 30000
const RETRY_MS = 8000
const SPACE_ID_KEY = 'inout_space_id'

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Administrador',
  admin: 'Administrador',
}

// Umbrales de estado — mismo criterio en toda la app: <50 verde, 50–80 ámbar, >80 rojo.
function statusColor(pct: number): string {
  if (pct > 80) return 'var(--c-red)'
  if (pct >= 50) return 'var(--c-amber)'
  return 'var(--c-green)'
}

function statusLabel(pct: number): string {
  if (pct > 80) return 'Alto'
  if (pct >= 50) return 'Moderado'
  return 'Normal'
}

function fmtInt(n: number): string {
  return n.toLocaleString('es-PE')
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`
}

// ── Íconos — hoisted, heredan color vía currentColor ────────────────────────
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

const ICON_PIN = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M10 18s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="10" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const ICON_ARROW_LEFT = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12.5 4.5 6 10l6.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ICON_ARROW_RIGHT = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ICON_USER = (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4 16.5c0-2.6 2.7-4.2 6-4.2s6 1.6 6 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const ICON_LOGOUT = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12.5 14v2.2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M8.5 10h8.2M14 7.2 16.8 10 14 12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ── HomeDashboard ────────────────────────────────────────────────────────────
interface HomeDashboardProps {
  /** Repinta el tema al elegir apariencia; lo resuelve App. */
  onThemeChange: (pref: ThemePreference) => void
}

export function HomeDashboard({ onThemeChange }: HomeDashboardProps): JSX.Element {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(() => {
    const stored = localStorage.getItem(SPACE_ID_KEY)
    return stored ? Number(stored) : null
  })
  const [session, setSession] = useState(getAdminSession)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  // Flujo guiado de selección: paso 1 (campus === null) → paso 2 (campus
  // elegido, se listan sus edificios) → confirmar edificio (barra inferior).
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
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

  const logout = () => {
    clearAdminSession()
    setSession(null)
    setUserMenuOpen(false)
  }

  // Cerrar popovers de la topbar (selector de edificio, menú de usuario) con
  // click afuera o Escape — mismo comportamiento para los dos.
  useEffect(() => {
    if (!pickerOpen && !userMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (pickerRef.current && !pickerRef.current.contains(t)) setPickerOpen(false)
      if (userMenuRef.current && !userMenuRef.current.contains(t)) setUserMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPickerOpen(false)
      setUserMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen, userMenuOpen])

  const activeBuilding = data?.buildings.find(b => b.id === activeSpaceId)

  // Agrupación por campus — fuente única para el selector rápido de la
  // topbar y para el flujo guiado de 2 pasos del cuerpo de la página.
  const campusGroups: CampusGroup[] = useMemo(() => {
    if (!data) return []
    const byKey = new Map<string, CampusGroup>()
    for (const b of data.buildings) {
      const key = b.sede_id !== null ? `sede-${b.sede_id}` : '__sin_sede__'
      const label = b.sede_name ?? 'Otros'
      let g = byKey.get(key)
      if (!g) { g = { key, label, items: [], capacity: 0, occupancy: 0, occupancyPercent: 0 }; byKey.set(key, g) }
      g.items.push(b)
      g.capacity += b.capacity
      g.occupancy += b.current_occupancy
    }
    const list = Array.from(byKey.values())
    for (const g of list) {
      g.occupancyPercent = g.capacity > 0 ? (g.occupancy / g.capacity) * 100 : 0
      g.items.sort((a, b) => b.occupancy_percent - a.occupancy_percent || a.name.localeCompare(b.name, 'es'))
    }
    list.sort((a, b) => {
      if (a.label === 'Otros') return 1
      if (b.label === 'Otros') return -1
      return a.label.localeCompare(b.label, 'es')
    })
    return list
  }, [data])

  const currentGroup = campusGroups.find(g => g.key === selectedCampus) ?? null
  // Si el campus elegido desapareció de los datos (sede eliminada en vivo),
  // cae con gracia al paso 1 en vez de quedar en una pantalla vacía.
  useEffect(() => {
    if (selectedCampus !== null && !currentGroup) setSelectedCampus(null)
  }, [selectedCampus, currentGroup])

  const confirmingBuilding = data?.buildings.find(b => b.id === confirmingId) ?? null

  const pickCampus = (key: string) => { setSelectedCampus(key); setConfirmingId(null) }
  const backToCampuses = () => { setSelectedCampus(null); setConfirmingId(null) }

  // Orden estable de entrada (stagger) — asignado una sola vez por tarjeta,
  // para que no se re-dispare la animación al refrescar datos cada 30s.
  const mountOrderRef = useRef(new Map<string, number>())
  const nextIdxRef = useRef(0)
  const mountDelay = (key: string): number => {
    let idx = mountOrderRef.current.get(key)
    if (idx === undefined) {
      idx = nextIdxRef.current++
      mountOrderRef.current.set(key, idx)
    }
    return Math.min(idx, 10) * 30
  }

  const hasBuildings = (data?.buildings.length ?? 0) > 0
  const entriesToday = useMemo(() => data?.buildings.reduce((s, b) => s + b.entries_today, 0) ?? 0, [data])
  const exitsToday = useMemo(() => data?.buildings.reduce((s, b) => s + b.exits_today, 0) ?? 0, [data])
  const alertBuildings = useMemo(() => data?.buildings.filter(b => b.occupancy_percent > 80) ?? [], [data])

  return (
    <div className="hd-page">
      <style>{CSS}</style>

      <div className="hd-topbar">
        <span className="hd-brand">InOut · Control de aforo</span>

        <div className="hd-topbar-actions">
          <ThemePicker onChange={onThemeChange} />
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
                  {campusGroups.map(group => (
                    <div className="hd-picker-group" key={group.key}>
                      {campusGroups.length > 1 && (
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

          {/* Sesión — patrón estándar: sin sesión, "Iniciar sesión"; con
              sesión, el usuario con su menú (configuración / cerrar sesión). */}
          {!session ? (
            <a className="hd-admin-link" href="/admin">
              {ICON_USER}
              Iniciar sesión
            </a>
          ) : (
            <div className="hd-user" ref={userMenuRef}>
              <button
                className="hd-user-trigger"
                onClick={() => setUserMenuOpen(v => !v)}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
              >
                <span className="hd-user-avatar" aria-hidden="true">{session.username.charAt(0)}</span>
                <span className="hd-user-name">{session.username}</span>
                <span className="hd-picker-chevron">{ICON_CHEVRON}</span>
              </button>

              {userMenuOpen && (
                <div className="hd-user-menu" role="menu">
                  <div className="hd-user-menu-head">
                    <span className="hd-user-menu-name">{session.username}</span>
                    {ROLE_LABELS[session.role] && (
                      <span className="hd-user-menu-role">{ROLE_LABELS[session.role]}</span>
                    )}
                  </div>
                  <a className="hd-user-menu-item" href="/admin" role="menuitem">
                    {ICON_GEAR}
                    Configuración
                  </a>
                  <button className="hd-user-menu-item" onClick={logout} role="menuitem">
                    {ICON_LOGOUT}
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          )}
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

          <MetricsStrip
            totals={data.totals}
            entriesToday={entriesToday}
            exitsToday={exitsToday}
            alertBuildings={alertBuildings}
          />

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
          ) : !currentGroup ? (
            <>
              <h1 className="hd-section-title">Selecciona tu campus</h1>
              <p className="hd-section-sub">Elige la sede para continuar al control de acceso del edificio</p>
              <div className="hd-campus-grid">
                {campusGroups.map(group => (
                  <CampusCard
                    key={group.key}
                    group={group}
                    delayMs={mountDelay(group.key)}
                    onClick={() => pickCampus(group.key)}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="hd-step-header">
                <button className="hd-back-btn" onClick={backToCampuses}>
                  {ICON_ARROW_LEFT} Cambiar campus
                </button>
                <div>
                  <h1 className="hd-section-title">Selecciona el edificio · {currentGroup.label}</h1>
                  <p className="hd-section-sub">Toca un edificio para continuar al control de acceso</p>
                </div>
              </div>
              <div className="hd-grid">
                {currentGroup.items.map(b => (
                  <BuildingCard
                    key={b.id}
                    building={b}
                    selected={b.id === confirmingId}
                    delayMs={mountDelay(`${currentGroup.key}-${b.id}`)}
                    onClick={() => setConfirmingId(b.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {confirmingBuilding && (
        <div className="hd-confirm-bar" role="status">
          <span className="hd-confirm-text">
            <strong>{confirmingBuilding.name}</strong> · {fmtPct(confirmingBuilding.occupancy_percent)} de aforo
          </span>
          <button className="hd-confirm-btn" onClick={() => selectBuilding(confirmingBuilding.id)}>
            Ingresar al control de acceso {ICON_ARROW_RIGHT}
          </button>
        </div>
      )}
    </div>
  )
}

// ── MetricsStrip — panorama general pequeño, "de yapa" ─────────────────────
function MetricsStrip({
  totals, entriesToday, exitsToday, alertBuildings,
}: {
  totals: OverviewResponse['totals']
  entriesToday: number
  exitsToday: number
  alertBuildings: BuildingOverview[]
}) {
  const occColor = statusColor(totals.occupancy_percent)
  const alertColor = alertBuildings.length > 0 ? 'var(--c-red)' : 'var(--c-text1)'

  return (
    <div className="hd-metrics-strip">
      <div className="hd-metric-card">
        <span className="hd-metric-label">Ocupación global</span>
        <div className="hd-metric-value-row">
          <span className="hd-metric-value" style={{ color: occColor }}>{fmtPct(totals.occupancy_percent)}</span>
          <span className="hd-metric-sub">{fmtInt(totals.current_occupancy)} / {fmtInt(totals.capacity)} personas</span>
        </div>
        <div className="hd-metric-bar">
          <div className="hd-metric-bar-fill" style={{ width: `${Math.min(100, totals.occupancy_percent)}%`, background: occColor }} />
        </div>
      </div>

      <div className="hd-metric-card">
        <span className="hd-metric-label">Ingresos hoy</span>
        <span className="hd-metric-value" style={{ color: 'var(--c-blue)' }}>{fmtInt(entriesToday)}</span>
        <span className="hd-metric-sub">en los {totals.buildings} {totals.buildings === 1 ? 'edificio activo' : 'edificios activos'}</span>
      </div>

      <div className="hd-metric-card">
        <span className="hd-metric-label">Salidas hoy</span>
        <span className="hd-metric-value">{fmtInt(exitsToday)}</span>
        <span className="hd-metric-sub">balance neto: {fmtInt(totals.current_occupancy)} dentro</span>
      </div>

      <div className="hd-metric-card">
        <span className="hd-metric-label">Edificios en alerta</span>
        <span className="hd-metric-value" style={{ color: alertColor }}>{alertBuildings.length}</span>
        <span className="hd-metric-sub">
          {alertBuildings.length > 0
            ? `de ${totals.buildings} · >80% de aforo`
            : `de ${totals.buildings} · todo normal`}
        </span>
        {alertBuildings[0] && (
          <span className="hd-metric-alert-name">{alertBuildings[0].name}</span>
        )}
      </div>
    </div>
  )
}

// ── CampusCard — paso 1 del selector guiado ─────────────────────────────────
function CampusCard({
  group, delayMs, onClick,
}: { group: CampusGroup; delayMs: number; onClick: () => void }) {
  const color = statusColor(group.occupancyPercent)
  const barWidth = Math.min(100, Math.max(0, group.occupancyPercent))

  return (
    <button className="hd-campus-card" style={{ animationDelay: `${delayMs}ms` }} onClick={onClick}>
      <div className="hd-campus-card-header">
        <span className="hd-campus-card-icon">{ICON_PIN}</span>
        <span className="hd-campus-card-name">{group.label}</span>
        <span className="hd-campus-card-badge" style={{ color, background: `color-mix(in oklch, ${color} 16%, transparent)` }}>
          {statusLabel(group.occupancyPercent)}
        </span>
      </div>

      <div className="hd-campus-card-pct" style={{ color }}>{fmtPct(group.occupancyPercent)}</div>
      <span className="hd-campus-card-pct-label">ocupación promedio</span>

      <div className="hd-meter">
        <div className="hd-meter-fill" style={{ width: `${barWidth}%`, background: color }} />
      </div>

      <div className="hd-campus-card-footer">
        <span>{group.items.length} {group.items.length === 1 ? 'edificio' : 'edificios'}</span>
        <span>{fmtInt(group.occupancy)} / {fmtInt(group.capacity)} personas</span>
      </div>
    </button>
  )
}

// ── BuildingCard — paso 2 del selector guiado ───────────────────────────────
function BuildingCard({
  building, delayMs, selected, onClick,
}: { building: BuildingOverview; delayMs: number; selected: boolean; onClick: () => void }) {
  const color = statusColor(building.occupancy_percent)
  const barWidth = Math.min(100, Math.max(0, building.occupancy_percent))

  return (
    <button
      className="hd-card"
      data-selected={selected}
      style={{ animationDelay: `${delayMs}ms` }}
      onClick={onClick}
    >
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
    </button>
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
  padding: clamp(20px, 3vw, 40px) clamp(16px, 4vw, 56px) clamp(96px, 10vw, 120px);
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

/* ── Selector rápido de edificio (popover) ── */
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

/* ── Menú de usuario (sesión iniciada) ── */
.hd-user { position: relative; }
.hd-user-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  background: none;
  border: 1.5px solid transparent;
  border-radius: 11px;
  padding: 7px 12px 7px 8px;
  color: var(--c-text1);
  font-family: 'Barlow', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out;
}
.hd-user-trigger:hover { background: var(--c-bg-panel); border-color: var(--c-border); }
.hd-user-trigger:active { transform: scale(0.97); }
.hd-user-trigger:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }
.hd-user-avatar {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--c-blue);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
.hd-user-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.hd-user-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 200px;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.18);
  transform-origin: top right;
  animation: hdPickerIn 160ms cubic-bezier(0.23,1,0.32,1) forwards;
  z-index: 20;
}
.hd-user-menu-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 10px 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--c-border);
}
.hd-user-menu-name { font-size: 13.5px; font-weight: 700; color: var(--c-text1); }
.hd-user-menu-role { font-size: 11.5px; color: var(--c-text3); }
.hd-user-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 8px;
  padding: 9px 10px;
  color: var(--c-text2);
  font-family: 'Barlow', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background 130ms ease-out, color 130ms ease-out;
}
.hd-user-menu-item svg { flex-shrink: 0; color: var(--c-text3); }
.hd-user-menu-item:hover { background: var(--c-border); color: var(--c-text1); }
.hd-user-menu-item:focus-visible { outline: 2px solid var(--c-blue); outline-offset: -2px; }

/* ── Link de inicio de sesión (sin sesión activa) ── */
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

/* ── Franja de métricas generales — pequeña, secundaria, "de yapa" ── */
.hd-metrics-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: clamp(10px, 1.4vw, 16px);
  margin-bottom: clamp(24px, 3.5vh, 40px);
}
.hd-metric-card {
  border: 1px solid var(--c-border);
  background: var(--c-bg-panel);
  border-radius: 14px;
  padding: clamp(14px, 1.8vh, 18px) clamp(16px, 2vw, 20px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hd-metric-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text3);
}
.hd-metric-value-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.hd-metric-value {
  font-family: 'Bebas Neue', 'Arial Narrow', impact, sans-serif;
  font-size: clamp(28px, 3.2vw, 36px);
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--c-text1);
}
.hd-metric-sub {
  font-size: 12.5px;
  color: var(--c-text3);
}
.hd-metric-bar {
  height: 5px;
  border-radius: 99px;
  background: var(--c-border);
  overflow: hidden;
  margin-top: 4px;
}
.hd-metric-bar-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 700ms cubic-bezier(0.22,1,0.36,1), background 400ms ease-out;
}
.hd-metric-alert-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-red);
  margin-top: 2px;
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

/* ── Encabezados de sección / paso ── */
.hd-section-title {
  font-size: clamp(18px, 2.2vw, 24px);
  font-weight: 700;
  color: var(--c-text1);
  margin: 0 0 4px;
}
.hd-section-sub {
  font-size: 14px;
  color: var(--c-text3);
  margin: 0 0 clamp(16px, 2.2vh, 22px);
}
.hd-step-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: clamp(12px, 2vw, 20px);
  margin-bottom: clamp(16px, 2.2vh, 22px);
}
.hd-step-header .hd-section-title,
.hd-step-header .hd-section-sub { margin-bottom: 0; }
.hd-back-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 9px 14px;
  color: var(--c-text2);
  font-family: 'Barlow', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 160ms ease-out, color 160ms ease-out, transform 160ms ease-out;
}
.hd-back-btn:hover { border-color: var(--c-blue); color: var(--c-text1); }
.hd-back-btn:active { transform: scale(0.97); }
.hd-back-btn:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }

/* ── Paso 1: grid de campus ── */
.hd-campus-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: clamp(14px, 1.8vw, 22px);
}
.hd-campus-card {
  text-align: left;
  border: 1px solid var(--c-border);
  background: var(--c-bg-panel);
  border-radius: 16px;
  padding: clamp(18px, 2.2vw, 26px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  font-family: 'Barlow', sans-serif;
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  animation: hdCardIn 380ms cubic-bezier(0.23,1,0.32,1) forwards;
  transition: border-color 160ms ease-out, transform 160ms ease-out;
}
.hd-campus-card:hover { border-color: var(--c-blue); }
.hd-campus-card:active { transform: scale(0.98); }
.hd-campus-card:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }
.hd-campus-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hd-campus-card-icon { display: flex; color: var(--c-text3); flex-shrink: 0; }
.hd-campus-card-name {
  font-size: clamp(18px, 2vw, 22px);
  font-weight: 700;
  color: var(--c-text1);
  flex: 1;
}
.hd-campus-card-badge {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 99px;
  flex-shrink: 0;
}
.hd-campus-card-pct {
  font-family: 'Bebas Neue', 'Arial Narrow', impact, sans-serif;
  font-size: clamp(38px, 5vw, 52px);
  line-height: 1;
  letter-spacing: 0.01em;
}
.hd-campus-card-pct-label {
  font-size: 13px;
  color: var(--c-text3);
  margin-top: -8px;
}
.hd-campus-card-footer {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--c-text3);
  margin-top: 2px;
}

/* ── Groups / grid (paso 2) ── */
.hd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: clamp(12px, 1.6vw, 20px);
}

/* ── Card de edificio (paso 2) — ahora es un <button> seleccionable ── */
.hd-card {
  text-align: left;
  border: 1.5px solid var(--c-border);
  background: var(--c-bg-panel);
  border-radius: 14px;
  padding: clamp(16px, 2vw, 22px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  cursor: pointer;
  font-family: 'Barlow', sans-serif;
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  animation: hdCardIn 380ms cubic-bezier(0.23,1,0.32,1) forwards;
  transition: border-color 160ms ease-out, transform 160ms ease-out;
}
.hd-card:hover { border-color: var(--c-blue); }
.hd-card:active { transform: scale(0.98); }
.hd-card:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }
.hd-card[data-selected="true"] { border-color: var(--c-blue); background: color-mix(in oklch, var(--c-blue) 8%, var(--c-bg-panel)); }
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

/* ── Barra de confirmación flotante ── */
.hd-confirm-bar {
  position: fixed;
  left: 50%;
  bottom: clamp(20px, 4vh, 36px);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: clamp(14px, 2vw, 22px);
  background: oklch(20% 0.03 230);
  border: 1px solid oklch(32% 0.03 230);
  border-radius: 999px;
  padding: 10px 12px 10px 22px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.35);
  z-index: 30;
  animation: hdConfirmIn 220ms cubic-bezier(0.23,1,0.32,1) forwards;
  max-width: calc(100vw - 32px);
}
@keyframes hdConfirmIn {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.hd-confirm-text {
  color: oklch(90% 0.01 230);
  font-size: 14px;
  white-space: nowrap;
}
.hd-confirm-text strong { font-weight: 700; }
.hd-confirm-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-blue);
  border: none;
  border-radius: 999px;
  padding: 11px 20px;
  color: white;
  font-family: 'Barlow', sans-serif;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 160ms ease-out, transform 160ms ease-out;
}
.hd-confirm-btn:hover { filter: brightness(1.1); }
.hd-confirm-btn:active { transform: scale(0.97); }
.hd-confirm-btn:focus-visible { outline: 2px solid white; outline-offset: 2px; }

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
  .hd-card, .hd-campus-card { animation: none; opacity: 1; transform: none; }
  .hd-confirm-bar { animation: none; }
  .hd-totals-bar-fill, .hd-meter-fill, .hd-metric-bar-fill { transition: none; }
}
`
