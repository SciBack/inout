import { useState, useEffect } from 'react'
import { LoginPage } from './LoginPage'
import { SedesPage } from './SedesPage'
import { SpacesPage } from './SpacesPage'
import { StatsPage } from './StatsPage'

type Tab = 'sedes' | 'spaces' | 'stats'

const STORAGE_KEY = 'inout_admin_token'

export function AdminApp() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))
  const [role, setRole] = useState<string>('')
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
    localStorage.setItem(STORAGE_KEY, newToken)
    setToken(newToken)
    setRole(newRole)
  }

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setToken(null)
    setRole('')
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
          <a href="/" style={s.backLink}>← Ir al kiosko</a>
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

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex', width: '100vw', height: '100vh',
    background: '#0a1628', overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sidebar: {
    width: '200px', flexShrink: 0,
    background: '#0d1f35', borderRight: '1px solid #1e293b',
    display: 'flex', flexDirection: 'column',
    padding: '1.25rem 0',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: '0.7rem',
    padding: '0 1.25rem', marginBottom: '1.5rem',
  },
  brandIcon: { fontSize: '1.4rem', color: '#3b82f6' },
  brandName: { display: 'block', fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' },
  brandSub: { display: 'block', fontSize: '0.7rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' },
  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 0.5rem' },
  navBtn: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.6rem 0.75rem', background: 'transparent',
    border: 'none', borderRadius: '8px', color: '#475569',
    fontSize: '0.875rem', cursor: 'pointer', textAlign: 'left', width: '100%',
    transition: 'background 0.15s, color 0.15s',
  },
  navActive: { background: 'rgba(59,130,246,0.12)', color: '#e2e8f0' },
  navIcon: { fontSize: '0.8rem', width: '16px', textAlign: 'center' },
  sidebarBottom: {
    padding: '1rem 0.75rem 0',
    borderTop: '1px solid #1e293b',
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
  },
  backLink: {
    fontSize: '0.8rem', color: '#475569',
    textDecoration: 'none', padding: '0.4rem 0.5rem',
  },
  logoutBtn: {
    padding: '0.45rem 0.75rem',
    background: 'transparent', border: '1px solid #1e293b',
    borderRadius: '7px', color: '#64748b',
    fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left',
  },
  main: {
    flex: 1, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    background: '#0a1628',
  },
}
