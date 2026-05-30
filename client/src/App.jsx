import { useState, useEffect } from 'react'
import GrantCard from './components/GrantCard'
import GrantModal from './components/GrantModal'
import { formatSync } from './utils.js'

const ENTITY_TYPES = [
  { value: 'any',            label: 'Anyone' },
  { value: 'individual',     label: 'Individual' },
  { value: 'small_business', label: 'Small Business' },
  { value: 'nonprofit',      label: 'Nonprofit' },
]

export default function App() {
  const [grants, setGrants]         = useState([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [state, setState]           = useState(null)
  const [syncedAt, setSyncedAt]     = useState(null)
  const [zip, setZip]               = useState('')
  const [entityType, setEntityType] = useState('any')
  const [selectedGrant, setSelectedGrant] = useState(null)
  const [showSaved, setShowSaved]         = useState(false)
  const [savedGrants, setSavedGrants]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('grantfinder_saved') || '[]') }
    catch { return [] }
  })

  useEffect(() => {
    localStorage.setItem('grantfinder_saved', JSON.stringify(savedGrants))
  }, [savedGrants])

  function toggleSave(grant) {
    setSavedGrants(prev =>
      prev.some(g => g.id === grant.id)
        ? prev.filter(g => g.id !== grant.id)
        : [...prev, grant]
    )
  }

  function fetchGrants(zipValue, entityValue) {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ entityType: entityValue })
    if (zipValue.length === 5) params.set('zip', zipValue)
    fetch(`${import.meta.env.VITE_API_URL}/api/grants?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError('Something went wrong. Please try again.')
          setLoading(false)
          return
        }
        setGrants(data.grants ?? [])
        setState(data.state)
        setSyncedAt(data.syncedAt)
        setLoading(false)
      })
      .catch(() => {
        setError('Could not reach the server. Please try again.')
        setLoading(false)
      })
  }

  useEffect(() => { fetchGrants('', 'any') }, [])

  function handleSubmit(e) {
    e.preventDefault()
    setShowSaved(false)
    fetchGrants(zip, entityType)
  }

  const savedIds      = new Set(savedGrants.map(g => g.id))
  const displayGrants = showSaved ? savedGrants : grants

  return (
    <div style={styles.page}>

      {/* ── Hero ── */}
      <header style={styles.hero}>
        <div style={styles.heroDots} />
        <div style={styles.heroGlow} />
        <div style={styles.heroContent}>
          <h1 style={styles.logo}>
            Grant<span style={styles.logoAccent}>Finder</span>
          </h1>
          <p style={styles.tagline}>
            Discover federal and state grants matched to you — free, public data.
          </p>
          <form onSubmit={handleSubmit} style={styles.searchBar}>
            <input
              type="text"
              placeholder="Zip code"
              value={zip}
              onChange={e => setZip(e.target.value)}
              maxLength={5}
              style={styles.input}
            />
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              style={styles.select}
            >
              {ENTITY_TYPES.map(t => (
                <option key={t.value} value={t.value} style={{ color: '#0f172a', background: '#fff' }}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="submit" style={styles.findBtn}>Find grants</button>
            <button
              type="button"
              onClick={() => setShowSaved(s => !s)}
              style={{ ...styles.savedBtn, ...(showSaved ? styles.savedBtnActive : {}) }}
            >
              {showSaved ? '★' : '☆'} Saved{savedGrants.length > 0 ? ` (${savedGrants.length})` : ''}
            </button>
          </form>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={styles.main}>
        <div style={styles.toolbar}>
          <span style={styles.toolbarLabel}>
            {showSaved
              ? <><strong>{savedGrants.length}</strong> saved grant{savedGrants.length !== 1 ? 's' : ''}</>
              : state ? <>Grants for <strong>{state}</strong></> : 'All grants'
            }
          </span>
          {!showSaved && syncedAt && (
            <span style={styles.syncChip}>Synced {formatSync(syncedAt)}</span>
          )}
        </div>

        {loading && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p style={styles.hint}>Loading grants…</p>
          </div>
        )}

        {error && (
          <div style={styles.center}>
            <p style={{ ...styles.hint, color: '#dc2626' }}>{error}</p>
          </div>
        )}

        {!loading && !error && displayGrants.length > 0 && (
          <>
            {!showSaved && (
              <p style={styles.countLine}>{grants.length} opportunities</p>
            )}
            <div style={styles.grid}>
              {displayGrants.map(grant => (
                <GrantCard
                  key={grant.id}
                  grant={grant}
                  isSaved={savedIds.has(grant.id)}
                  onToggleSave={toggleSave}
                  onCardClick={() => setSelectedGrant(grant)}
                />
              ))}
            </div>
          </>
        )}

        {!loading && !error && displayGrants.length === 0 && (
          <div style={styles.center}>
            <p style={styles.hint}>
              {showSaved
                ? 'No saved grants yet — click the bookmark on any card to save it.'
                : 'No grants found. Try a different filter.'}
            </p>
          </div>
        )}
      </main>

      {selectedGrant && (
        <GrantModal
          grant={selectedGrant}
          isSaved={savedIds.has(selectedGrant.id)}
          onToggleSave={toggleSave}
          onClose={() => setSelectedGrant(null)}
        />
      )}
    </div>
  )
}

const F = '"Inter", system-ui, -apple-system, sans-serif'

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    fontFamily: F,
    color: '#0f172a',
  },

  /* ── Hero ── */
  hero: {
    position: 'relative',
    overflow: 'hidden',
    background: 'linear-gradient(160deg, #050c1f 0%, #0b1c42 55%, #0d2255 100%)',
    padding: '60px 24px 56px',
    textAlign: 'center',
  },
  heroDots: {
    position: 'absolute', inset: 0,
    backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)',
    backgroundSize: '28px 28px',
    pointerEvents: 'none',
  },
  heroGlow: {
    position: 'absolute',
    top: '-40%', left: '50%',
    transform: 'translateX(-50%)',
    width: '80%', height: '80%',
    background: 'radial-gradient(ellipse, rgba(99,102,241,0.2) 0%, transparent 65%)',
    pointerEvents: 'none',
  },
  heroContent: {
    position: 'relative',
    maxWidth: 640,
    margin: '0 auto',
  },
  logo: {
    margin: '0 0 14px',
    fontSize: 46,
    fontWeight: 800,
    letterSpacing: '-1.5px',
    color: '#fff',
    lineHeight: 1,
  },
  logoAccent: {
    color: '#818cf8',
  },
  tagline: {
    margin: '0 0 36px',
    fontSize: 16,
    color: 'rgba(255,255,255,0.52)',
    fontWeight: 400,
    lineHeight: 1.6,
    letterSpacing: '0.01em',
  },
  searchBar: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  input: {
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontSize: 14,
    width: 130,
    outline: 'none',
    fontFamily: F,
    letterSpacing: '0.01em',
  },
  select: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
    outline: 'none',
    fontFamily: F,
  },
  findBtn: {
    padding: '12px 24px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
    boxShadow: '0 1px 3px rgba(79,70,229,0.5), 0 4px 14px rgba(79,70,229,0.3)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: F,
    letterSpacing: '0.01em',
  },
  savedBtn: {
    padding: '12px 18px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: F,
  },
  savedBtnActive: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    border: '1px solid transparent',
    color: '#fff',
    boxShadow: '0 1px 3px rgba(245,158,11,0.45), 0 4px 12px rgba(245,158,11,0.25)',
  },

  /* ── Main ── */
  main: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '32px 20px 72px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 8,
  },
  toolbarLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: '#334155',
  },
  syncChip: {
    fontSize: 12,
    color: '#94a3b8',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    padding: '4px 10px',
    fontWeight: 500,
  },
  countLine: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: 500,
    marginBottom: 16,
    marginTop: 0,
    letterSpacing: '0.01em',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  hint: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    margin: 0,
  },
  spinner: {
    width: 24,
    height: 24,
    border: '2.5px solid #e2e8f0',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  grid: {
    display: 'grid',
    gap: 14,
    gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
    animation: 'fadeUp 0.3s ease',
  },
}
