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
          <span style={s.logoText}>InOut Admin</span>
        </div>
        <p style={s.subtitle}>Panel de administración</p>

        <div style={s.field}>
          <label style={s.label}>Usuario</label>
          <input style={s.input} type="text" value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus autoComplete="username" disabled={loading} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Contraseña</label>
          <input style={s.input} type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" disabled={loading} />
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
          {loading ? 'Iniciando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  bg: {
    width: '100vw', height: '100vh',
    background: '#0a1628',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: '#0d1f35',
    border: '1px solid #1e293b',
    borderRadius: '14px',
    padding: '2.5rem 2rem',
    width: '100%', maxWidth: '360px',
    display: 'flex', flexDirection: 'column', gap: '1.1rem',
  },
  logo: { display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'center' },
  logoIcon: { fontSize: '1.6rem', color: '#3b82f6' },
  logoText: { fontSize: '1.3rem', fontWeight: 700, color: '#f1f5f9' },
  subtitle: { fontSize: '0.8rem', color: '#475569', textAlign: 'center', marginTop: '-0.5rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: { fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: {
    padding: '0.65rem 0.9rem',
    background: '#0a1628', border: '1px solid #1e293b', borderRadius: '8px',
    color: '#f1f5f9', fontSize: '0.95rem', outline: 'none',
  },
  error: { fontSize: '0.85rem', color: '#ef4444', textAlign: 'center' },
  btn: {
    padding: '0.7rem', background: '#3b82f6', border: 'none',
    borderRadius: '8px', color: '#fff', fontSize: '0.95rem',
    fontWeight: 600, cursor: 'pointer', marginTop: '0.25rem',
  },
}
