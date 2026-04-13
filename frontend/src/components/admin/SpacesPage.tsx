import { useEffect, useState } from 'react'

interface Sede { id: number; name: string; code: string }

interface Space {
  id: number
  sede_id: number | null
  sede: Sede | null
  name: string
  capacity: number
  location: string | null
  address: string | null
  description: string | null
  open_time: string | null
  close_time: string | null
  active: boolean
  created_at: string | null
}

interface Props {
  token: string
}

const EMPTY_FORM = {
  sede_id: '', name: '', capacity: '', location: '', address: '',
  description: '', open_time: '07:00', close_time: '21:00', active: true,
}

function fmtTime(t: string | null): string {
  if (!t) return '—'
  return t.slice(0, 5)
}

export function SpacesPage({ token }: Props) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [sedes, setSedes] = useState<Sede[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Space | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const load = async () => {
    setLoading(true)
    const [resSpaces, resSedes] = await Promise.all([
      fetch('/api/admin/spaces', { headers }),
      fetch('/api/admin/sedes', { headers }),
    ])
    if (resSpaces.ok) setSpaces(await resSpaces.json())
    if (resSedes.ok) setSedes(await resSedes.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  const openEdit = (sp: Space) => {
    setEditing(sp)
    setForm({
      sede_id: sp.sede_id ? String(sp.sede_id) : '',
      name: sp.name,
      capacity: String(sp.capacity),
      location: sp.location || '',
      address: sp.address || '',
      description: sp.description || '',
      open_time: sp.open_time ? sp.open_time.slice(0, 5) : '07:00',
      close_time: sp.close_time ? sp.close_time.slice(0, 5) : '21:00',
      active: sp.active,
    })
    setError('')
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.capacity) { setError('Nombre y aforo son obligatorios'); return }
    setSaving(true)
    setError('')
    const body = {
      sede_id: form.sede_id ? Number(form.sede_id) : null,
      name: form.name.trim(),
      capacity: Number(form.capacity),
      location: form.location || null,
      address: form.address || null,
      description: form.description || null,
      open_time: form.open_time || null,
      close_time: form.close_time || null,
      active: form.active,
    }
    const url = editing ? `/api/admin/spaces/${editing.id}` : '/api/admin/spaces'
    const method = editing ? 'PUT' : 'POST'
    const res = await fetch(url, { method, headers, body: JSON.stringify(body) })
    if (res.ok) {
      setModalOpen(false)
      load()
    } else {
      const err = await res.json()
      setError(err.detail || 'Error al guardar')
    }
    setSaving(false)
  }

  const handleDeactivate = async (sp: Space) => {
    if (!confirm(`¿Desactivar "${sp.name}"? El historial de datos se conserva.`)) return
    await fetch(`/api/admin/spaces/${sp.id}`, { method: 'DELETE', headers })
    load()
  }

  const f = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  return (
    <div style={s.page}>
      <div style={s.toolbar}>
        <h2 style={s.title}>Espacios</h2>
        <button style={s.btnPrimary} onClick={openCreate}>+ Nuevo espacio</button>
      </div>

      {loading ? (
        <p style={s.hint}>Cargando...</p>
      ) : spaces.length === 0 ? (
        <p style={s.hint}>No hay espacios creados.</p>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['ID', 'Sede', 'Nombre', 'Aforo', 'Horario', 'Estado', ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spaces.map(sp => (
                <tr key={sp.id} style={s.tr}>
                  <td style={s.td}><span style={s.idBadge}>{sp.id}</span></td>
                  <td style={s.td}>
                    {sp.sede
                      ? <><code style={s.code}>{sp.sede.code}</code><span style={{ marginLeft: '0.4rem', color: '#64748b', fontSize: '0.8rem' }}>{sp.sede.name}</span></>
                      : <span style={{ color: '#334155' }}>—</span>}
                  </td>
                  <td style={s.td}>
                    <span style={s.spaceName}>{sp.name}</span>
                    {sp.address && <span style={s.spaceAddr}>{sp.address}</span>}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {sp.capacity.toLocaleString()}
                  </td>
                  <td style={s.td}>{fmtTime(sp.open_time)} – {fmtTime(sp.close_time)}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: sp.active ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)', color: sp.active ? '#22c55e' : '#64748b' }}>
                      {sp.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button style={s.btnSm} onClick={() => openEdit(sp)}>Editar</button>
                      {sp.active && (
                        <button style={{ ...s.btnSm, color: '#ef4444', borderColor: '#7f1d1d' }}
                          onClick={() => handleDeactivate(sp)}>
                          Desactivar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Nota URL para kiosko */}
      {spaces.length > 0 && (
        <div style={s.hint2}>
          <strong style={{ color: '#64748b' }}>URLs de kiosko:</strong>{' '}
          {spaces.filter(sp => sp.active).map(sp => (
            <span key={sp.id} style={{ marginRight: '1rem' }}>
              <code style={s.code}>/?space={sp.id}</code>
              <span style={{ color: '#475569' }}> → {sp.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      {modalOpen && (
        <div style={s.overlay} onClick={() => setModalOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h3 style={s.modalTitle}>{editing ? 'Editar espacio' : 'Nuevo espacio'}</h3>

            <div style={s.formGrid}>
              <div style={{ ...s.formField, gridColumn: '1 / -1' }}>
                <label style={s.label}>Sede</label>
                <select style={s.input} value={form.sede_id}
                  onChange={e => setForm(prev => ({ ...prev, sede_id: e.target.value }))}>
                  <option value="">— Sin sede asignada —</option>
                  {sedes.filter(sd => sd).map(sd => (
                    <option key={sd.id} value={sd.id}>{sd.code} — {sd.name}</option>
                  ))}
                </select>
              </div>
              <div style={s.formField}>
                <label style={s.label}>Nombre *</label>
                <input style={s.input} value={form.name} onChange={f('name')} placeholder="Ej: CRAI Lima" />
              </div>
              <div style={s.formField}>
                <label style={s.label}>Aforo máximo *</label>
                <input style={s.input} type="number" value={form.capacity} onChange={f('capacity')} min="1" placeholder="150" />
              </div>
              <div style={s.formField}>
                <label style={s.label}>Ubicación</label>
                <input style={s.input} value={form.location} onChange={f('location')} placeholder="Ej: Campus Lima, Pabellón A" />
              </div>
              <div style={s.formField}>
                <label style={s.label}>Dirección</label>
                <input style={s.input} value={form.address} onChange={f('address')} placeholder="Ej: Av. Ñaña 123" />
              </div>
              <div style={s.formField}>
                <label style={s.label}>Apertura</label>
                <input style={s.input} type="time" value={form.open_time} onChange={f('open_time')} />
              </div>
              <div style={s.formField}>
                <label style={s.label}>Cierre</label>
                <input style={s.input} type="time" value={form.close_time} onChange={f('close_time')} />
              </div>
            </div>

            <div style={s.formField}>
              <label style={s.label}>Descripción</label>
              <textarea style={{ ...s.input, resize: 'vertical', minHeight: '60px' }}
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descripción breve del espacio..." />
            </div>

            {editing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.active}
                  onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))} />
                <span style={s.label}>Activo</span>
              </label>
            )}

            {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}

            <div style={s.modalActions}>
              <button style={s.btnCancel} onClick={() => setModalOpen(false)}>Cancelar</button>
              <button style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}
                onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear espacio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0, overflow: 'auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' },
  btnPrimary: { padding: '0.55rem 1.2rem', background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },
  btnSm: { padding: '0.3rem 0.75rem', background: 'transparent', border: '1px solid #1e293b', borderRadius: '6px', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' },
  btnCancel: { padding: '0.55rem 1.2rem', background: 'transparent', border: '1px solid #1e293b', borderRadius: '8px', color: '#64748b', fontSize: '0.9rem', cursor: 'pointer' },
  hint: { color: '#475569', fontSize: '0.9rem' },
  hint2: { fontSize: '0.8rem', color: '#475569', background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.75rem 1rem' },
  code: { background: '#132235', padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace', color: '#06b6d4', fontSize: '0.8rem' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: { textAlign: 'left', padding: '0.6rem 0.8rem', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #1e293b' },
  tr: { borderBottom: '1px solid #0f2540' },
  td: { padding: '0.65rem 0.8rem', color: '#cbd5e1', verticalAlign: 'middle' },
  idBadge: { background: '#132235', color: '#475569', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' },
  spaceName: { display: 'block', color: '#e2e8f0', fontWeight: 500 },
  spaceAddr: { display: 'block', color: '#475569', fontSize: '0.75rem' },
  badge: { padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 500 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#0d1f35', border: '1px solid #1e293b', borderRadius: '14px', padding: '2rem', width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0' },
  modalActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
  formField: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { padding: '0.55rem 0.8rem', background: '#0a1628', border: '1px solid #1e293b', borderRadius: '7px', color: '#f1f5f9', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
}
