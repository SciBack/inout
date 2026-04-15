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
  typical_avg_stay_seconds: number | null
  peak_hour: number | null
  typical_peak_hour: number | null
  current_male: number
  current_female: number
  total_male_today: number
  total_female_today: number
  category_breakdown: { category: string; label: string; count: number }[]
  faculty_breakdown: { faculty: string; label: string; count: number }[]
  faculty_no_data: number
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
  prev_day_visitors: number
  prev_day_label: string
}

// ── Paleta OKLCH ────────────────────────────────────────────────────────────
const C = {
  bg:     'oklch(7% 0.018 232)',
  card:   'oklch(15% 0.024 229)',
  border: 'oklch(25% 0.028 228)',
  text1:  'oklch(88% 0.010 222)',
  text2:  'oklch(78% 0.010 222)',
  text3:  'oklch(62% 0.012 222)',
  green:  'oklch(73% 0.21 148)',
  amber:  'oklch(82% 0.17 76)',
  red:    'oklch(66% 0.24 25)',
  blue:   'oklch(68% 0.17 244)',
  rose:   'oklch(73% 0.17 352)',
  cyan:   'oklch(73% 0.18 211)',
}

const FONT_DISPLAY = "'Bebas Neue', 'Arial Narrow', impact, sans-serif"
const FONT_BODY    = "'Barlow', system-ui, sans-serif"

const FAC_COLORS = [
  'oklch(62% 0.20 256)',
  'oklch(73% 0.18 211)',
  'oklch(60% 0.24 299)',
  'oklch(73% 0.21 148)',
  'oklch(80% 0.18 76)',
  'oklch(65% 0.24 25)',
]

const CATEGORY_MAP: Record<string, { short: string; bg: string; color: string }> = {
  'ESTUDI':   { short: 'EST', bg: 'oklch(73% 0.18 211 / 0.14)', color: 'oklch(73% 0.18 211)' },
  'DOCENTE':  { short: 'DOC', bg: 'oklch(68% 0.17 244 / 0.14)', color: 'oklch(68% 0.17 244)' },
  'DOCEN':    { short: 'DOC', bg: 'oklch(68% 0.17 244 / 0.14)', color: 'oklch(68% 0.17 244)' },
  'INVESTI':  { short: 'INV', bg: 'oklch(68% 0.18 295 / 0.14)', color: 'oklch(68% 0.18 295)' },
  'VISITA':   { short: 'VIS', bg: 'oklch(73% 0.17 76 / 0.14)',  color: 'oklch(73% 0.17 76)' },
  'STAFF':    { short: 'STF', bg: 'oklch(70% 0.15 148 / 0.14)', color: 'oklch(70% 0.15 148)' },
  'ADMINI':   { short: 'ADM', bg: 'oklch(82% 0.17 76 / 0.14)',  color: 'oklch(82% 0.17 76)' },
  'EXTERNO':  { short: 'EXT', bg: 'oklch(32% 0.012 222 / 0.35)', color: C.text2 },
}

const CATEGORY_COLORS: string[] = [
  'oklch(73% 0.18 211)',  // cyan — Estudiantes
  'oklch(68% 0.17 244)',  // blue — Docentes
  'oklch(73% 0.17 76)',   // amber — Visitantes
  'oklch(68% 0.18 295)',  // purple — Investigadores
  'oklch(70% 0.15 148)',  // green — Staff
  'oklch(65% 0.24 25)',   // red — otros
]

// ── Íconos estáticos — hoisted (no re-created per render) ───────────────────
const ICON_ENTRY = (
  <svg width="26" height="26" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
    <path d="M10 17 L10 4 M5 9.5 L10 3.5 L15 9.5"
      stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
)

const ICON_EXIT = (
  <svg width="26" height="26" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
    <path d="M10 3 L10 16 M5 10.5 L10 16.5 L15 10.5"
      stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
)

// ── Utilidades ───────────────────────────────────────────────────────────────
function firstNameCapitalized(fullName: string): string {
  if (!fullName) return ''
  const first = fullName.trim().split(/\s+/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function fmtStay(s: number | null): string {
  if (s === null || s <= 0) return '—'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtPeakHour(h: number | null): string {
  if (h === null) return '—'
  return `${String(h).padStart(2, '0')}:00`
}

function fmtDelta(today: number, yesterday: number): { text: string; color: string } | null {
  if (yesterday <= 0) return null
  const d = today - yesterday
  const sign = d >= 0 ? '+' : ''
  return {
    text: `${sign}${d} vs ayer`,
    color: d >= 0 ? C.green : C.red,
  }
}


// ── ArcGauge ─────────────────────────────────────────────────────────────────
function ArcGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(1, max > 0 ? value / max : 0)
  const R = 34
  const cx = 50, cy = 46
  const circumference = 2 * Math.PI * R
  const arcFraction = 0.72
  const arcLength = circumference * arcFraction
  const filledLength = arcLength * pct
  const rot = `rotate(144, ${cx}, ${cy})`

  return (
    <svg viewBox="0 0 100 82" style={{ width: '100%', maxWidth: '150px', display: 'block' }}>
      <circle cx={cx} cy={cy} r={R}
        fill="none" stroke={C.border} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        transform={rot}
      />
      <circle cx={cx} cy={cy} r={R}
        fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${filledLength.toFixed(2)} ${(circumference - filledLength).toFixed(2)}`}
        transform={rot}
        style={{ transition: 'stroke-dasharray 0.7s ease, stroke 0.4s ease' }}
      />
      <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="middle"
        fontSize="30" fontWeight="400" fill={color}
        style={{ fontFamily: FONT_DISPLAY, letterSpacing: '0.02em' }}>
        {value}
      </text>
      <text x={cx} y={cy + 17} textAnchor="middle"
        fontSize="10.5" fill={C.text2}
        style={{ fontFamily: FONT_BODY }}>
        de {max}
      </text>
    </svg>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: number | string
  valueRef?: React.Ref<HTMLSpanElement>
  color: string
  sub?: string
  subColor?: string
  wide?: boolean
  numSize?: string
}

const StatCard = memo(function StatCard({
  label, value, valueRef, color, sub, subColor, wide, numSize,
}: StatCardProps) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 'clamp(14px,1.9vh,26px) clamp(16px,2vh,24px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
      textAlign: 'center' as const,
      gap: 4,
      gridColumn: wide ? 'span 2' : undefined,
      overflow: 'hidden',
    }}>
      <span style={{
        fontSize: 'clamp(11px,1.3vh,16px)',
        color: C.text3,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.12em',
        fontFamily: FONT_BODY,
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span
        ref={valueRef}
        style={{
          fontSize: numSize ?? 'clamp(42px,6.0vh,78px)',
          lineHeight: 1,
          fontFamily: FONT_DISPLAY,
          color,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.02em',
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{
          fontSize: 'clamp(12px,1.5vh,18px)',
          color: subColor ?? C.text2,
          fontFamily: FONT_BODY,
          fontWeight: 500,
          marginTop: 2,
        }}>
          {sub}
        </span>
      )}
    </div>
  )
})

// ── ProfilesCard ─────────────────────────────────────────────────────────────
const ProfilesCard = memo(function ProfilesCard({
  breakdown,
}: { breakdown: { category: string; label: string; count: number }[] }) {
  const total = breakdown.reduce((s, r) => s + r.count, 0)
  const sorted = [...breakdown].sort((a, b) => b.count - a.count)

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 'clamp(14px,1.9vh,26px) clamp(16px,2vh,24px)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'clamp(8px,1.0vh,14px)',
      overflow: 'hidden',
    }}>
      <span style={{
        fontSize: 'clamp(11px,1.3vh,16px)',
        color: C.text3,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.12em',
        fontFamily: FONT_BODY,
        fontWeight: 600,
        flexShrink: 0,
      }}>
        Perfiles hoy
      </span>

      {total === 0 ? (
        <span style={{ color: C.text3, fontFamily: FONT_BODY, fontSize: 'clamp(12px,1.4vh,16px)' }}>
          Sin registros aún
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(5px,0.7vh,9px)', flex: 1, justifyContent: 'center' }}>
          {sorted.map((row, i) => {
            const pct = total > 0 ? Math.round((row.count / total) * 100) : 0
            const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length]
            return (
              <div key={row.category} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{
                    fontFamily: FONT_BODY,
                    fontSize: 'clamp(11px,1.25vh,15px)',
                    color: C.text2,
                    fontWeight: 500,
                  }}>
                    {row.label}
                  </span>
                  <span style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 'clamp(14px,1.8vh,22px)',
                    color,
                    letterSpacing: '0.03em',
                    lineHeight: 1,
                  }}>
                    {row.count}
                  </span>
                </div>
                <div style={{
                  height: 'clamp(3px,0.4vh,5px)',
                  background: C.border,
                  borderRadius: 99,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: color,
                    borderRadius: 99,
                    transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

// ── PatronAvatar ──────────────────────────────────────────────────────────────
const PatronAvatar = memo(function PatronAvatar({
  cardnumber, name,
}: { cardnumber: string; name: string }) {
  const [failed, setFailed] = useState(false)

  const initials = name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w.charAt(0).toUpperCase()).join('')

  const SIZE = 'clamp(38px,5.0vh,60px)'

  if (failed) {
    return (
      <div style={{
        width: SIZE, height: SIZE, borderRadius: '50%', flexShrink: 0,
        background: C.card, border: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'clamp(12px,1.5vh,17px)',
        fontFamily: FONT_DISPLAY,
        color: C.text2,
        letterSpacing: '0.04em',
        userSelect: 'none' as const,
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
        border: `1px solid ${C.border}`,
        background: C.card,
      }}
    />
  )
})

// ── FacultyBarChart ───────────────────────────────────────────────────────────
const FacultyBarChart = memo(function FacultyBarChart({
  rows,
}: { rows: { faculty: string; label: string; count: number }[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 'clamp(13px,1.6vh,20px)', color: C.text3, fontFamily: FONT_BODY }}>
          Sin entradas registradas hoy
        </span>
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => b.count - a.count)
  const max = Math.max(...sorted.map(r => r.count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px,0.9vh,11px)' }}>
      {sorted.map((row, idx) => {
        const pct = (row.count / max) * 100
        const isSinFac = row.faculty === 'Sin Facultad'
        const color = isSinFac ? C.border : FAC_COLORS[idx % FAC_COLORS.length]
        return (
          <div key={row.faculty || idx} style={{ position: 'relative', height: 'clamp(26px,3.4vh,42px)' }}>
            {/* Track (fondo) — muestra label en gris cuando la barra no lo cubre */}
            <div style={{
              position: 'absolute', inset: 0,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 'clamp(8px,1vh,14px)',
              paddingRight: 'clamp(8px,1vh,14px)',
            }}>
              <span style={{
                fontSize: 'clamp(11px,1.4vh,16px)',
                fontFamily: FONT_BODY,
                fontWeight: 600,
                color: C.text3,
                letterSpacing: '0.06em',
                whiteSpace: 'nowrap' as const,
              }}>
                {row.label}
              </span>
            </div>
            {/* Barra rellena — encima del track */}
            <div style={{
              position: 'absolute', inset: 0,
              width: `${pct}%`,
              background: color,
              borderRadius: 8,
              transition: 'width 0.6s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 'clamp(8px,1vh,14px)',
              paddingRight: 'clamp(8px,1vh,14px)',
              overflow: 'hidden',
            }}>
              <span style={{
                fontSize: 'clamp(11px,1.4vh,16px)',
                fontFamily: FONT_BODY,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.95)',
                letterSpacing: '0.06em',
                whiteSpace: 'nowrap' as const,
              }}>
                {row.label}
              </span>
              <span style={{
                fontSize: 'clamp(13px,1.7vh,20px)',
                fontFamily: FONT_DISPLAY,
                color: 'rgba(255,255,255,0.95)',
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}>
                {row.count}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
})

// ── OccupancyPanel ────────────────────────────────────────────────────────────
export function OccupancyPanel({ spaceId }: { spaceId?: number }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

  const refVisitors = useRef<HTMLSpanElement>(null)
  const refMale     = useRef<HTMLSpanElement>(null)
  const refFemale   = useRef<HTMLSpanElement>(null)

  const prevVisitors = useRef(0)
  const prevMale     = useRef(0)
  const prevFemale   = useRef(0)
  const prevFirstId  = useRef<number | null>(null)

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
        ref.current.style.animation = 'none'
        void ref.current.offsetWidth
        ref.current.style.animation = 'metricPulse 0.5s ease'
        prev.current = val
      }
    }
    pulse(refVisitors, prevVisitors, data.unique_visitors_today)
    pulse(refMale,     prevMale,     data.current_male)
    pulse(refFemale,   prevFemale,   data.current_female)
  }, [data])

  if (error) {
    return (
      <div style={{ ...s.stateMsg, color: C.red, fontFamily: FONT_BODY }}>
        Sin conexión con el servidor
      </div>
    )
  }
  if (!data) {
    return (
      <div style={{ ...s.stateMsg, color: C.text3, fontFamily: FONT_BODY }}>
        Cargando...
      </div>
    )
  }

  const pct      = Math.min(100, data.occupancy_percent)
  const barColor = pct < 60 ? C.green : pct < 85 ? C.amber : C.red

  const todayLabel = new Date().toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const todayCapitalized = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)

  const prevDaySub    = data.prev_day_label && data.prev_day_visitors > 0
    ? `${data.prev_day_label.charAt(0).toUpperCase() + data.prev_day_label.slice(1)}: ${data.prev_day_visitors}`
    : undefined
  const avgStayStr    = fmtStay(data.avg_stay_seconds)
  const peakHourStr   = fmtPeakHour(data.peak_hour)

  const DOW_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const dowName = DOW_ES[new Date().getDay()]
  const typicalPeakSub = data.typical_peak_hour !== null
    ? `Típico ${dowName} · ${fmtPeakHour(data.typical_peak_hour)}`
    : undefined
  const typicalStaySub = data.typical_avg_stay_seconds != null
    ? `Típico ${dowName} · ${fmtStay(data.typical_avg_stay_seconds)}`
    : undefined

  const firstEventId  = data.recent_events[0]?.id ?? null
  const isNewEvent    = firstEventId !== null && firstEventId !== prevFirstId.current
  if (isNewEvent) prevFirstId.current = firstEventId

  return (
    <div style={s.container}>

      {/* ── HEADER ── */}
      <div style={s.header}>
        <span style={s.spaceName}>{data.space_name.toUpperCase()}</span>
        <span style={s.dateLabel}>{todayCapitalized}</span>
      </div>

      {/* ── CUERPO: 2 columnas ── */}
      <div style={s.body}>

        {/* COLUMNA IZQUIERDA */}
        <div style={s.leftCol}>

          {/* Gauge compacto */}
          <div style={s.gaugeCard}>
            <span style={s.sectionLabel}>En edificio ahora</span>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <ArcGauge value={data.current_occupancy} max={data.capacity} color={barColor} />
            </div>
            <span style={{ textAlign: 'center', fontSize: 'clamp(13px,1.6vh,19px)', color: barColor, fontWeight: 600, fontFamily: FONT_BODY }}>
              {pct.toFixed(0)}% del aforo máximo
            </span>
          </div>

          {/* Tarjetas estadísticas — grid 2 cols */}
          <div style={s.statGrid}>

            {/* Visitantes hoy */}
            <StatCard
              label="Visitantes hoy"
              value={data.unique_visitors_today}
              valueRef={refVisitors}
              color={C.cyan}
              sub={prevDaySub}
              subColor={C.text3}
              numSize="clamp(52px,7.0vh,92px)"
            />

            {/* Perfiles hoy */}
            <ProfilesCard breakdown={data.category_breakdown ?? []} />

            {/* Hombres */}
            <StatCard
              label="Hombres en edificio"
              value={data.current_male}
              valueRef={refMale}
              color={C.blue}
              sub={`${data.total_male_today} total hoy`}
              subColor={C.text3}
            />

            {/* Mujeres */}
            <StatCard
              label="Mujeres en edificio"
              value={data.current_female}
              valueRef={refFemale}
              color={C.rose}
              sub={`${data.total_female_today} total hoy`}
              subColor={C.text3}
            />

            {/* Permanencia media */}
            <StatCard
              label="Prom. permanencia"
              value={avgStayStr}
              color={C.text1}
              numSize="clamp(34px,4.8vh,64px)"
              sub={typicalStaySub}
              subColor={C.text3}
            />

            {/* Hora punta */}
            <StatCard
              label="Hora punta"
              value={peakHourStr}
              color={C.amber}
              numSize="clamp(34px,4.8vh,64px)"
              sub={typicalPeakSub}
              subColor={C.text3}
            />

          </div>

          {/* Barras por facultad — dentro de col izquierda */}
          <div style={s.facultyInCol}>
            <span style={s.sectionLabel}>Visitantes por facultad · hoy</span>
            <FacultyBarChart rows={data.faculty_breakdown} />
          </div>

        </div>

        {/* COLUMNA DERECHA: feed sin padding vertical */}
        <div style={s.feedSection}>
          <div style={s.feedList}>
            {data.recent_events.map((ev, idx) => {
              const isEntry = ev.event_type === 'entry'
              const isFirst = idx === 0
              const entryColor = 'oklch(73% 0.21 148)'
              const exitColor  = 'oklch(68% 0.18 295)'
              const accentColor = isEntry ? entryColor : exitColor
              const cat = CATEGORY_MAP[ev.patron_category?.toUpperCase?.() ?? '']
              const firstBg = isEntry
                ? 'oklch(18% 0.035 148)'
                : 'oklch(18% 0.030 295)'
              const firstGlow = isEntry
                ? '0 0 0 1px oklch(73% 0.21 148 / 0.25), inset 0 1px 0 oklch(73% 0.21 148 / 0.10)'
                : '0 0 0 1px oklch(68% 0.18 295 / 0.25), inset 0 1px 0 oklch(68% 0.18 295 / 0.10)'

              return (
                <div
                  key={isFirst && isNewEvent ? ev.id + '-anim' : ev.id}
                  style={{
                    ...s.feedItem,
                    position: 'relative',
                    background: isFirst
                      ? firstBg
                      : idx % 2 === 0 ? 'transparent' : 'oklch(13% 0.018 228 / 0.5)',
                    borderLeft: isFirst
                      ? `3px solid ${accentColor}`
                      : '3px solid transparent',
                    boxShadow: isFirst ? firstGlow : undefined,
                    animation: isFirst && isNewEvent
                      ? 'feedSlideIn 0.35s cubic-bezier(0.22,1,0.36,1)' : undefined,
                  }}
                >
                  <PatronAvatar cardnumber={ev.cardnumber} name={ev.patron_name || ev.cardnumber} />
                  {isEntry ? ICON_ENTRY : ICON_EXIT}
                  <span style={{
                    ...s.feedName,
                    color: isFirst ? 'oklch(97% 0.005 220)' : C.text1,
                    fontWeight: isFirst ? 700 : 500,
                  }}>
                    {firstNameCapitalized(ev.patron_name || ev.cardnumber)}
                  </span>
                  {isFirst && (
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0,
                      flexShrink: 0,
                      animation: 'badgeFloat 2s ease-in-out infinite',
                    }}>
                      {/* flecha izquierda apuntando al nombre */}
                      <span style={{
                        width: 0,
                        height: 0,
                        borderTop: '4px solid transparent',
                        borderBottom: '4px solid transparent',
                        borderRight: '6px solid oklch(87% 0.28 135)',
                      }} />
                      <span style={{
                        fontSize: 'clamp(8px,0.85vh,10px)',
                        fontWeight: 800,
                        letterSpacing: '0.12em',
                        color: 'oklch(10% 0.015 140)',
                        background: 'oklch(87% 0.28 135)',
                        borderRadius: '0 999px 999px 0',
                        padding: '2px 8px 2px 5px',
                        lineHeight: 1.5,
                        fontFamily: FONT_BODY,
                        boxShadow: '0 0 10px oklch(87% 0.28 135 / 0.5)',
                      }}>NEW</span>
                    </span>
                  )}
                  {cat && (
                    <span style={{
                      fontSize: 'clamp(10px,1.3vh,16px)',
                      fontFamily: FONT_BODY,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: cat.color,
                      background: cat.bg,
                      borderRadius: 4,
                      padding: '3px 8px',
                      flexShrink: 0,
                    }}>
                      {cat.short}
                    </span>
                  )}
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

    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 'clamp(10px,1.2vh,18px) clamp(12px,1.5vh,20px)',
    gap: 'clamp(7px,0.9vh,12px)',
    background: C.bg,
    overflow: 'hidden',
    boxSizing: 'border-box',
    fontFamily: FONT_BODY,
  },
  stateMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', fontSize: '1rem',
  },

  // Header
  header: {
    flex: '0 0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  spaceName: {
    fontSize: 'clamp(14px,1.9vh,24px)',
    fontWeight: 700,
    color: C.text2,
    letterSpacing: '0.12em',
    fontFamily: FONT_BODY,
  },
  dateLabel: {
    fontSize: 'clamp(13px,1.6vh,20px)',
    color: C.text3,
    textTransform: 'capitalize',
    fontFamily: FONT_BODY,
  },

  // Cuerpo
  body: {
    flex: '1 1 0',
    minHeight: 0,
    display: 'flex',
    gap: 'clamp(7px,0.9vh,12px)',
  },

  // Columna izquierda
  leftCol: {
    flex: '0 0 57%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(7px,0.9vh,12px)',
    minHeight: 0,
  },

  // Gauge card — compacto, no crece
  gaugeCard: {
    flex: '0 0 auto',
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 'clamp(10px,1.2vh,16px) clamp(14px,1.8vh,20px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'clamp(4px,0.5vh,7px)',
  },

  // Grid de tarjetas de estadísticas
  statGrid: {
    flex: '1 1 0',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: 'repeat(3, 1fr)',
    gap: 'clamp(5px,0.7vh,9px)',
  },

  // Etiqueta de sección
  sectionLabel: {
    flex: '0 0 auto',
    fontSize: 'clamp(11px,1.3vh,16px)',
    color: C.text3,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    fontFamily: FONT_BODY,
    fontWeight: 600,
    alignSelf: 'flex-start',
  },

  // Columna derecha: feed
  feedSection: {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 0,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },

  // Barras de facultad dentro de col izquierda
  facultyInCol: {
    flex: '0 0 auto',
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 'clamp(8px,1vh,14px) clamp(10px,1.2vh,16px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(5px,0.7vh,9px)',
  },
  feedList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(1px,0.3vh,4px)',
    overflow: 'hidden',
  },
  feedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(7px,0.9vh,12px)',
    borderRadius: 8,
    padding: 'clamp(6px,0.85vh,11px) clamp(8px,1vh,12px)',
    flexShrink: 0,
  },
  feedName: {
    flex: 1,
    fontSize: 'clamp(16px,2.1vh,27px)',
    color: C.text1,
    fontWeight: 500,
    fontFamily: FONT_BODY,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  feedTime: {
    fontSize: 'clamp(14px,1.75vh,22px)',
    color: C.text3,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: FONT_BODY,
    flexShrink: 0,
  },

}
