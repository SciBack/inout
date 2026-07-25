import { useState, useEffect } from 'react'
import { LoginPage } from './LoginPage'
import { SedesPage } from './SedesPage'
import { SpacesPage } from './SpacesPage'
import { StatsPage } from './StatsPage'
import { ADMIN_TOKEN_KEY, clearAdminSession, getAdminSession } from '../../utils/adminSession'

type Tab = 'sedes' | 'spaces' | 'stats'

export function AdminApp() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY))
  const [session, setSession] = useState(getAdminSession)
  const [tab, setTab] = useState<Tab>('sedes')

  // Verificar token al montar
  useEffect(() => {
    if (!token) return
    fetch('/api/admin/spaces', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (r.status === 401) handleLogout()
    })
  }, [])

  const handleLogin = (newToken: string, newRole: string) => {
    localStorage.setItem(ADMIN_TOKEN_KEY, newToken)
    setToken(newToken)
    setSession(getAdminSession() ?? { username: '', role: newRole })
  }

  const handleLogout = () => {
    clearAdminSession()
    setToken(null)
    setSession(null)
  }

  if (!token) return <LoginPage onLogin={handleLogin} />

  return (
    <div style={s.shell}>
      {/* Barra lateral */}
      <aside style={s.sidebar}>
        <div style={s.brand}>
          <span style={s.brandIcon}>⬡</span>
          <div>
            <span style={s.brandName}>InOut</span>
            <span style={s.brandSub}>Admin</span>
          </div>
        </div>

        <nav style={s.nav}>
          {([
            { id: 'sedes',  label: 'Sedes',        icon: '⊞' },
            { id: 'spaces', label: 'Espacios',     icon: '▦' },
            { id: 'stats',  label: 'Estadísticas', icon: '▲' },
          ] as { id: Tab; label: string; icon: string }[]).map(item => (
            <button
              key={item.id}
              style={{ ...s.navBtn, ...(tab === item.id ? s.navActive : {}) }}
              onClick={() => setTab(item.id)}
            >
              <span style={s.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div style={s.sidebarBottom}>
          {session?.username && (
            <div style={s.userChip}>
              <span style={s.userAvatar}>{session.username.charAt(0)}</span>
              <span style={s.userName} title={session.username}>{session.username}</span>
            </div>
          )}
          <a href="/" style={s.backLink}>← Ir al panel de inicio</a>
          <button style={s.logoutBtn} onClick={handleLogout}>Cerrar sesión</button>
        </div>
      </aside>

      {/* Contenido principal */}
      <main style={s.main}>
        {tab === 'sedes'  && <SedesPage token={token} />}
        {tab === 'spaces' && <SpacesPage token={token} />}
        {tab === 'stats'  && <StatsPage token={token} />}
      </main>
    </div>
  )
}

const FONT = "'Barlow', system-ui, -apple-system, sans-serif"

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex', width: '100vw', height: '100vh',
    background: 'var(--c-bg)', overflow: 'hidden',
    fontFamily: FONT,
  },
  sidebar: {
    width: '200px', flexShrink: 0,
    background: 'var(--c-bg-panel)', borderRight: '1px solid var(--c-border)',
    display: 'flex', flexDirection: 'column',
    padding: '1.25rem 0',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: '0.7rem',
    padding: '0 1.25rem', marginBottom: '1.5rem',
  },
  brandIcon: { fontSize: '1.4rem', color: 'var(--c-blue)' },
  brandName: { display: 'block', fontSize: '1rem', fontWeight: 700, color: 'var(--c-text1)' },
  brandSub: { display: 'block', fontSize: '0.7rem', color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em' },
  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 0.5rem' },
  navBtn: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.6rem 0.75rem', background: 'transparent',
    border: 'none', borderRadius: '8px', color: 'var(--c-text3)',
    fontSize: '0.875rem', fontFamily: FONT,
    cursor: 'pointer', textAlign: 'left', width: '100%',
    transition: 'background 0.15s, color 0.15s',
  },
  navActive: {
    background: 'color-mix(in oklch, var(--c-blue) 14%, transparent)',
    color: 'var(--c-text1)', fontWeight: 600,
  },
  navIcon: { fontSize: '0.8rem', width: '16px', textAlign: 'center' },
  sidebarBottom: {
    padding: '1rem 0.75rem 0',
    borderTop: '1px solid var(--c-border)',
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
  },
  userChip: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0 0.5rem 0.35rem',
  },
  userAvatar: {
    width: '26px', height: '26px', flexShrink: 0,
    borderRadius: '50%',
    background: 'var(--c-blue)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
  },
  userName: {
    fontSize: '0.85rem', fontWeight: 600, color: 'var(--c-text1)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  backLink: {
    fontSize: '0.8rem', color: 'var(--c-text3)',
    textDecoration: 'none', padding: '0.4rem 0.5rem',
  },
  logoutBtn: {
    padding: '0.45rem 0.75rem',
    background: 'transparent', border: '1px solid var(--c-border)',
    borderRadius: '7px', color: 'var(--c-text2)',
    fontSize: '0.8rem', fontFamily: FONT,
    cursor: 'pointer', textAlign: 'left',
  },
  main: {
    flex: 1, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    background: 'var(--c-bg)',
  },
}
