import { useState, useEffect } from 'react'

const AGE_RANGES = ['', 'Under 18', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']

const ENTITY_PILLS = [
  ['individual',     'Individual'],
  ['small_business', 'Small Business'],
  ['nonprofit',      'Nonprofit'],
]

const ATTRIBUTE_PILLS = [
  ['is_student',   'Student'],
  ['is_veteran',   'Veteran'],
  ['is_homeowner', 'Homeowner'],
]

const F = '"Inter", system-ui, -apple-system, sans-serif'

export default function ProfileModal({ profile, onSave, onClose }) {
  const [form, setForm] = useState({
    name:         profile?.name         || '',
    zip:          profile?.zip          || '',
    age_range:    profile?.age_range    || '',
    entity_type:  profile?.entity_type  || '',
    is_student:   profile?.is_student   || false,
    is_veteran:   profile?.is_veteran   || false,
    is_homeowner: profile?.is_homeowner || false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(field) {
    return (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  function setEntityType(value) {
    setForm(prev => ({ ...prev, entity_type: prev.entity_type === value ? '' : value }))
  }

  function toggleAttr(field) {
    setForm(prev => ({ ...prev, [field]: !prev[field] }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onSave(data)
    } catch (err) {
      setError(err.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.accentBar} />
        <div style={styles.body}>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">✕</button>

          <h2 style={styles.title}>Edit Profile</h2>
          <p style={styles.subtitle}>Update your details to refresh your grant matches.</p>

          <div style={styles.grid}>
            <Field label="Name">
              <input style={styles.input} value={form.name} onChange={set('name')} placeholder="Optional" />
            </Field>
            <Field label="ZIP Code">
              <input style={styles.input} value={form.zip} onChange={set('zip')} placeholder="e.g. 90210" maxLength={5} />
            </Field>
          </div>
          <Field label="Age Range">
            <select style={{ ...styles.select, maxWidth: 180 }} value={form.age_range} onChange={set('age_range')}>
              {AGE_RANGES.map(r => <option key={r} value={r}>{r || 'Select...'}</option>)}
            </select>
          </Field>

          <Field label="I am applying as a...">
            <div style={styles.pillRow}>
              {ENTITY_PILLS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEntityType(value)}
                  style={{ ...styles.pill, ...(form.entity_type === value ? styles.pillActive : {}) }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="I also identify as...">
            <div style={styles.pillRow}>
              {ATTRIBUTE_PILLS.map(([field, label]) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => toggleAttr(field)}
                  style={{ ...styles.pill, ...(form[field] ? styles.pillActive : {}) }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {error && <p style={styles.error}>{error}</p>}

          <div style={styles.actions}>
            <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={styles.label}>{label}</div>
      {children}
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15,23,42,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    animation: 'fadeUp 0.18s ease',
  },
  modal: {
    background: '#fff',
    borderRadius: 18,
    maxWidth: 500, width: '100%',
    maxHeight: '90vh',
    position: 'relative',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.07), 0 8px 16px rgba(0,0,0,0.08), 0 32px 64px rgba(0,0,0,0.16)',
    overflow: 'hidden',
    fontFamily: F,
    display: 'flex',
    flexDirection: 'column',
  },
  accentBar: {
    height: 4,
    background: 'linear-gradient(90deg, #4f46e5, #818cf8)',
    flexShrink: 0,
  },
  body: {
    padding: '24px 26px 26px',
    position: 'relative',
    overflowY: 'auto',
    flex: 1,
  },
  closeBtn: {
    position: 'absolute', top: 16, right: 16,
    background: '#f1f5f9', border: 'none',
    width: 28, height: 28, borderRadius: '50%',
    fontSize: 12, cursor: 'pointer', color: '#64748b',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1, fontFamily: F,
  },
  title: {
    margin: '0 0 4px',
    fontSize: 19, fontWeight: 700,
    color: '#0f172a', letterSpacing: '-0.02em',
  },
  subtitle: {
    margin: '0 0 20px',
    fontSize: 13, color: '#94a3b8',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px 16px',
    marginBottom: 16,
  },
  label: {
    fontSize: 11, fontWeight: 600,
    color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 7,
  },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    fontSize: 14, color: '#1e293b',
    fontFamily: F, outline: 'none',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    fontSize: 14, color: '#1e293b',
    fontFamily: F, outline: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  pillRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    padding: '8px 16px',
    borderRadius: 20,
    border: '1.5px solid #e2e8f0',
    background: '#f8fafc',
    color: '#475569',
    fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: F,
    transition: 'all 0.15s',
  },
  pillActive: {
    background: '#eef2ff',
    border: '1.5px solid #6366f1',
    color: '#4338ca',
    fontWeight: 600,
  },
  error: {
    fontSize: 13, color: '#dc2626',
    margin: '0 0 14px',
  },
  actions: {
    display: 'flex', gap: 10,
  },
  saveBtn: {
    padding: '10px 22px',
    borderRadius: 9, border: 'none',
    background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
    boxShadow: '0 1px 3px rgba(79,70,229,0.45), 0 4px 12px rgba(79,70,229,0.22)',
    color: '#fff',
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
    fontFamily: F, letterSpacing: '0.01em',
  },
  cancelBtn: {
    padding: '10px 18px',
    borderRadius: 9,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 14, fontWeight: 500, cursor: 'pointer',
    fontFamily: F,
  },
}
