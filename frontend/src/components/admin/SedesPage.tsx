import { useEffect, useState } from 'react'

interface Sede {
  id: number
  name: string
  code: string
  city: string | null
  active: boolean
}

interface Props { token: string }

const EMPTY = { name: '', code: '', city: '', active: true }

export function SedesPage({ token }: Props) {
  const [sedes, setSedes] = useState<Sede[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Sede | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const load = async () => {
    setLoading(true)
    const res = await fetch('/api/admin/sedes', { headers })
    if (res.ok) setSedes(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null); setForm({ ...EMPTY }); setError(''); setModalOpen(true)
  }

  const openEdit = (s: Sede) => {
    setEditing(s)
    setForm({ name: s.name, code: s.code, city: s.city || '', active: s.active })
    setError(''); setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) { setError('Nombre y código son obligatorios'); return }
    setSaving(true); setError('')
    const body = { name: form.name.trim(), code: form.code.trim().toUpperCase(), city: form.city || null, active: form.active }
    const url = editing ? `/api/admin/sedes/${editing.id}` : '/api/admin/sedes'
    const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers, body: JSON.stringify(body) })
    if (res.ok) { setModalOpen(false); load() }
    else { const e = await res.json(); setError(e.detail || 'Error al guardar') }
    setSaving(false)
  }

  const handleDeactivate = async (s: Sede) => {
    if (!confirm(`¿Desactivar "${s.name}"?`)) return
    await fetch(`/api/admin/sedes/${s.id}`, { method: 'DELETE', headers })
    load()
  }

  const f = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  return (
    <div style={s.page}>
      <div style={s.toolbar}>
        <h2 style={s.title}>Sedes</h2>
        <button style={s.btnPrimary} onClick={openCreate}>+ Nueva sede</button>
      </div>

      {loading ? <p style={s.hint}>Cargando...</p> : sedes.length === 0 ? (
        <p style={s.hint}>No hay sedes registradas.</p>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>{['ID', 'Código', 'Nombre', 'Ciudad', 'Estado', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {sedes.map(sede => (
                <tr key={sede.id} style={s.tr}>
                  <td style={s.td}><span style={s.idBadge}>{sede.id}</span></td>
                  <td style={s.td}><code style={s.code}>{sede.code}</code></td>
                  <td style={{ ...s.td, fontWeight: 500, color: '#e2e8f0' }}>{sede.name}</td>
                  <td style={{ ...s.td, color: '#64748b' }}>{sede.city || '—'}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: sede.active ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)', color: sede.active ? '#22c55e' : '#64748b' }}>
                      {sede.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button style={s.btnSm} onClick={() => openEdit(sede)}>Editar</button>
                      {sede.active && (
                        <button style={{ ...s.btnSm, color: '#ef4444', borderColor: '#7f1d1d' }}
                          onClick={() => handleDeactivate(sede)}>Desactivar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={s.overlay} onClick={() => setModalOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h3 style={s.modalTitle}>{editing ? 'Editar sede' : 'Nueva sede'}</h3>
            <div style={s.formGrid}>
              <div style={s.formField}>
                <label style={s.label}>Nombre *</label>
                <input style={s.input} value={form.name} onChange={f('name')} placeholder="Ej: Lima" />
              </div>
              <div style={s.formField}>
                <label style={s.label}>Código *</label>
                <input style={{ ...s.input, textTransform: 'uppercase' }} value={form.code} onChange={f('code')} placeholder="Ej: BUL" maxLength={10} />
              </div>
              <div style={{ ...s.formField, gridColumn: '1 / -1' }}>
                <label style={s.label}>Ciudad</label>
                <input style={s.input} value={form.city} onChange={f('city')} placeholder="Ej: Lima" />
              </div>
            </div>
            {editing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.active}
                  onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))} />
                <span style={s.label}>Activa</span>
              </label>
            )}
            {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
            <div style={s.modalActions}>
              <button style={s.btnCancel} onClick={() => setModalOpen(false)}>Cancelar</button>
              <button style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' },
  hint: { color: '#475569', fontSize: '0.9rem' },
  btnPrimary: { padding: '0.55rem 1.2rem', background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },
  btnSm: { padding: '0.3rem 0.75rem', background: 'transparent', border: '1px solid #1e293b', borderRadius: '6px', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' },
  btnCancel: { padding: '0.55rem 1.2rem', background: 'transparent', border: '1px solid #1e293b', borderRadius: '8px', color: '#64748b', fontSize: '0.9rem', cursor: 'pointer' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: { textAlign: 'left', padding: '0.6rem 0.8rem', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #1e293b' },
  tr: { borderBottom: '1px solid #0f2540' },
  td: { padding: '0.65rem 0.8rem', color: '#cbd5e1', verticalAlign: 'middle' },
  idBadge: { background: '#132235', color: '#475569', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' },
  code: { background: '#132235', color: '#06b6d4', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'monospace' },
  badge: { padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 500 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '14px', padding: '2rem', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '1rem' },
  modalTitle: { fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0' },
  modalActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
  formField: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { padding: '0.55rem 0.8rem', background: '#0a1628', border: '1px solid #1e293b', borderRadius: '7px', color: '#f1f5f9', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
}
