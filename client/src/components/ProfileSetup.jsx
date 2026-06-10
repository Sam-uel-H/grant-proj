import { useState, useEffect } from 'react'

const AGE_RANGES    = ['', 'Under 18', '18–24', '25–34', '35–44', '45–54', '55–64', '65+']
const INCOME_RANGES = ['', 'Under $25,000', '$25,000–$50,000', '$50,000–$75,000', '$75,000–$100,000', 'Over $100,000', 'Prefer not to say']
const OCCUPATIONS   = [
  '', 'Teacher / Educator', 'Nurse / Healthcare Worker', 'Farmer / Agriculture',
  'Social Worker / Counselor', 'Artist / Creative', 'Engineer / Scientist',
  'Construction / Skilled Trades', 'Lawyer / Legal', 'Cook / Food Service',
  'Driver / Logistics', 'Firefighter / First Responder', 'Accountant / Finance',
  'Mechanic / Technician', 'Programmer / IT', 'Child Care / Early Childhood', 'Other',
]

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

export default function ProfileSetup({ onSave, onBrowse }) {
  const [form, setForm] = useState({
    name: '', zip: '', age_range: '', income_range: '', occupation: '',
    entity_type: '',
    is_student: false, is_veteran: false, is_homeowner: false,
  })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [zipPlace, setZipPlace] = useState(null)  // e.g. "Beverly Hills, CA"

  // Live ZIP → location lookup. Fires when the user has typed a full 5-digit ZIP.
  useEffect(() => {
    if (form.zip.length !== 5) { setZipPlace(null); return }
    fetch(`https://api.zippopotam.us/us/${form.zip}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setZipPlace(data.places[0]['place name'] + ', ' + data.places[0]['state abbreviation'])
        else setZipPlace(null)
      })
      .catch(() => setZipPlace(null))
  }, [form.zip])

  function set(field) {
    return (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  // Single-select: clicking the active pill deselects it
  function setEntityType(value) {
    setForm(prev => ({ ...prev, entity_type: prev.entity_type === value ? '' : value }))
  }

  // Multi-select: each pill independently toggles its boolean field
  function toggleAttr(field) {
    setForm(prev => ({ ...prev, [field]: !prev[field] }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
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
      setSaving(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.dots} />
      <div style={styles.glow} />

      <div style={styles.content}>
        <h1 style={styles.logo}>
          Grant<span style={styles.accent}>Finder</span>
        </h1>
        <p style={styles.tagline}>
          Answer a few quick questions and we'll surface grants most relevant to you.
        </p>

        <form onSubmit={handleSubmit} style={styles.card}>
          <h2 style={styles.cardTitle}>Tell us about yourself</h2>
          <p style={styles.cardSub}>All fields are optional.</p>

          {/* Basic info — Name + ZIP on one row, Age Range below */}
          <div style={styles.grid}>
            <Field label="Your name">
              <input style={styles.input} value={form.name} onChange={set('name')} placeholder="Optional" />
            </Field>
            <div>
              <Field label="ZIP Code">
                <input style={styles.input} value={form.zip} onChange={set('zip')} placeholder="e.g. 90210" maxLength={5} />
              </Field>
              {zipPlace && (
                <div style={styles.zipHint}>📍 {zipPlace}</div>
              )}
            </div>
          </div>
          <Field label="Age Range">
            <select style={{ ...styles.select, maxWidth: 200 }} value={form.age_range} onChange={set('age_range')}>
              {AGE_RANGES.map(r => <option key={r} value={r}>{r || 'Select...'}</option>)}
            </select>
          </Field>
          <Field label="Annual Household Income">
            <select style={{ ...styles.select, maxWidth: 260 }} value={form.income_range} onChange={set('income_range')}>
              {INCOME_RANGES.map(r => <option key={r} value={r}>{r || 'Select...'}</option>)}
            </select>
          </Field>
          <Field label="Occupation (optional)">
            <select style={styles.select} value={form.occupation} onChange={set('occupation')}>
              {OCCUPATIONS.map(o => <option key={o} value={o}>{o || 'Select...'}</option>)}
            </select>
          </Field>

          {/* Entity type — pick one */}
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

          {/* Attributes — pick any that apply */}
          <Field label="I also identify as... (select all that apply)">
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

          <button type="submit" disabled={saving} style={styles.submitBtn}>
            {saving ? 'Finding grants…' : 'Find my grants →'}
          </button>
        </form>

        <button type="button" onClick={onBrowse} style={styles.browseLink}>
          Browse all grants without a profile
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <div style={styles.label}>{label}</div>
      {children}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #050c1f 0%, #0b1c42 55%, #0d2255 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: F,
    position: 'relative',
    overflow: 'hidden',
  },
  dots: {
    position: 'absolute', inset: 0,
    backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)',
    backgroundSize: '28px 28px',
    pointerEvents: 'none',
  },
  glow: {
    position: 'absolute',
    top: '-30%', left: '50%',
    transform: 'translateX(-50%)',
    width: '80%', height: '80%',
    background: 'radial-gradient(ellipse, rgba(99,102,241,0.18) 0%, transparent 65%)',
    pointerEvents: 'none',
  },
  content: {
    position: 'relative',
    width: '100%',
    maxWidth: 520,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logo: {
    margin: '0 0 10px',
    fontSize: 42,
    fontWeight: 800,
    letterSpacing: '-1.5px',
    color: '#fff',
    lineHeight: 1,
  },
  accent: { color: '#818cf8' },
  tagline: {
    margin: '0 0 26px',
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: 380,
  },
  card: {
    width: '100%',
    background: '#fff',
    borderRadius: 18,
    padding: '26px 26px 22px',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.07), 0 8px 24px rgba(0,0,0,0.18), 0 32px 64px rgba(0,0,0,0.2)',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.02em',
  },
  cardSub: {
    margin: '-8px 0 0',
    fontSize: 13,
    color: '#94a3b8',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px 16px',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 7,
  },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    fontSize: 14,
    color: '#1e293b',
    fontFamily: F,
    outline: 'none',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    fontSize: 14,
    color: '#1e293b',
    fontFamily: F,
    outline: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  zipHint: {
    marginTop: 5,
    fontSize: 12,
    fontWeight: 500,
    color: '#6366f1',
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
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: F,
    transition: 'all 0.15s',
  },
  pillActive: {
    background: '#eef2ff',
    border: '1.5px solid #6366f1',
    color: '#4338ca',
    fontWeight: 600,
  },
  error: {
    fontSize: 13,
    color: '#dc2626',
    margin: 0,
  },
  submitBtn: {
    width: '100%',
    padding: '13px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
    boxShadow: '0 1px 3px rgba(79,70,229,0.45), 0 4px 14px rgba(79,70,229,0.3)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: F,
    letterSpacing: '0.01em',
    marginTop: 4,
  },
  browseLink: {
    marginTop: 16,
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: F,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  },
}
