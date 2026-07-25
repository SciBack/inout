import { useState } from 'react'

interface Props {
  onLogin: (token: string, role: string) => void
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        const data = await res.json()
        onLogin(data.access_token, data.role)
      } else {
        const err = await res.json()
        setError(err.detail || 'Credenciales incorrectas')
      }
    } catch {
      setError('Sin conexión con el servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.bg}>
      <form style={s.card} onSubmit={handleSubmit}>
        <div style={s.logo}>
          <span style={s.logoIcon}>⬡</span>
          <span style={s.logoText}>InOut</span>
        </div>
        <p style={s.subtitle}>Panel de administración</p>

        <div style={s.field}>
          <label style={s.label} htmlFor="login-user">Usuario</label>
          <input id="login-user" style={s.input} type="text" value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus autoComplete="username" disabled={loading} />
        </div>
        <div style={s.field}>
          <label style={s.label} htmlFor="login-pass">Contraseña</label>
          <input id="login-pass" style={s.input} type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" disabled={loading} />
        </div>

        {error && <p style={s.error} role="alert">{error}</p>}

        <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
          {loading ? 'Iniciando...' : 'Ingresar'}
        </button>

        <a style={s.backLink} href="/">← Volver al panel de inicio</a>
      </form>
    </div>
  )
}

const FONT = "'Barlow', system-ui, -apple-system, sans-serif"

const s: Record<string, React.CSSProperties> = {
  bg: {
    width: '100vw', height: '100vh',
    background: 'var(--c-bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1.5rem',
    fontFamily: FONT,
  },
  card: {
    background: 'var(--c-bg-panel)',
    border: '1px solid var(--c-border)',
    borderRadius: '14px',
    padding: '2.5rem 2rem',
    width: '100%', maxWidth: '360px',
    display: 'flex', flexDirection: 'column', gap: '1.1rem',
    boxShadow: '0 12px 32px rgba(0,0,0,0.10)',
  },
  logo: { display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'center' },
  logoIcon: { fontSize: '1.6rem', color: 'var(--c-blue)' },
  logoText: { fontSize: '1.3rem', fontWeight: 700, color: 'var(--c-text1)' },
  subtitle: { fontSize: '0.8rem', color: 'var(--c-text3)', textAlign: 'center', marginTop: '-0.5rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: {
    fontSize: '0.75rem', color: 'var(--c-text3)',
    textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
  },
  input: {
    padding: '0.65rem 0.9rem',
    background: 'var(--c-bg)',
    border: '1px solid var(--c-border)',
    borderRadius: '8px',
    color: 'var(--c-text1)',
    fontSize: '0.95rem',
    fontFamily: FONT,
    outline: 'none',
  },
  error: { fontSize: '0.85rem', color: 'var(--c-red)', textAlign: 'center' },
  btn: {
    padding: '0.7rem', background: 'var(--c-blue)', border: 'none',
    borderRadius: '8px', color: '#fff', fontSize: '0.95rem',
    fontWeight: 700, fontFamily: FONT, cursor: 'pointer', marginTop: '0.25rem',
  },
  backLink: {
    fontSize: '0.8rem', color: 'var(--c-text3)',
    textAlign: 'center', textDecoration: 'none', marginTop: '0.2rem',
  },
}
