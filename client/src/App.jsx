import { useState, useEffect } from 'react'
import GrantCard from './components/GrantCard'
import GrantModal from './components/GrantModal'
import ProfileModal from './components/ProfileModal'
import ProfileSetup from './components/ProfileSetup'
import { formatSync } from './utils.js'

const API = import.meta.env.VITE_API_URL

const F = '"Inter", system-ui, -apple-system, sans-serif'

export default function App() {
  // 'setup' = profile intake page | 'results' = grant results page
  const [view, setView]   = useState('setup')
  const [profile, setProfile] = useState(null)

  const [grants, setGrants]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [grantState, setGrantState] = useState(null)  // 2-letter state from zip lookup
  const [syncedAt, setSyncedAt] = useState(null)
  const [relevantCount, setRelevantCount] = useState(null)
  const [limit, setLimit]       = useState(25)

  const [selectedGrant, setSelectedGrant]   = useState(null)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [showSaved, setShowSaved]             = useState(false)
  const [savedGrants, setSavedGrants]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('grantfinder_saved') || '[]') }
    catch { return [] }
  })

  useEffect(() => {
    localStorage.setItem('grantfinder_saved', JSON.stringify(savedGrants))
  }, [savedGrants])

  // On first load, check if there's a saved profile ID in localStorage.
  // If there is, restore the profile from the server and jump straight to results.
  useEffect(() => {
    const storedId = localStorage.getItem('grantfinder_profile_id')
    if (!storedId) return  // stay on setup page
    fetch(`${API}/api/profile/${storedId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          localStorage.removeItem('grantfinder_profile_id')
          return  // stay on setup page
        }
        setProfile(data)
        setView('results')
        fetchGrants(data.zip || '', data.entity_type || 'any', data.id)
      })
      .catch(() => {})  // stay on setup if network fails
  }, [])

  // Fetch grants from the API.
  // zip and entityType come from the profile; profileId triggers server-side scoring.
  function fetchGrants(zip, entityType, profileId, newLimit = 25) {
    setLoading(true)
    setError(null)
    setLimit(newLimit)
    const params = new URLSearchParams({ entityType: entityType || 'any', limit: newLimit })
    if (zip && zip.length === 5) params.set('zip', zip)
    if (profileId)               params.set('profileId', profileId)

    fetch(`${API}/api/grants?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError('Something went wrong. Please try again.'); setLoading(false); return }
        setGrants(data.grants ?? [])
        setGrantState(data.state)
        setSyncedAt(data.syncedAt)
        setRelevantCount(data.relevantCount ?? null)
        setLoading(false)
      })
      .catch(() => { setError('Could not reach the server. Please try again.'); setLoading(false) })
  }

  function handleShowMore() {
    const newLimit = limit + 25
    fetchGrants(profile?.zip || '', profile?.entity_type || 'any', profile?.id || null, newLimit)
  }

  // Called by ProfileSetup and ProfileModal after a successful save.
  // Stores the profile ID, switches to the results view, and fetches personalised grants.
  function handleProfileSave(savedProfile) {
    setProfile(savedProfile)
    localStorage.setItem('grantfinder_profile_id', savedProfile.id)
    setShowEditProfile(false)
    setView('results')
    fetchGrants(savedProfile.zip || '', savedProfile.entity_type || 'any', savedProfile.id)
  }

  // Called from the "Browse all grants" link on the setup page.
  // Skips profile creation and shows the generic grant list.
  function handleBrowse() {
    setView('results')
    fetchGrants('', 'any', null)
  }

  // Wipes the saved profile and returns to the setup page.
  function handleClearProfile() {
    setProfile(null)
    setRelevantCount(null)
    setGrants([])
    localStorage.removeItem('grantfinder_profile_id')
    setView('setup')
  }

  function toggleSave(grant) {
    setSavedGrants(prev =>
      prev.some(g => g.id === grant.id)
        ? prev.filter(g => g.id !== grant.id)
        : [...prev, grant]
    )
  }

  const savedIds      = new Set(savedGrants.map(g => g.id))
  const displayGrants = showSaved ? savedGrants : grants

  // ── Setup page ───────────────────────────────────────────────────────────────
  if (view === 'setup') {
    return (
      <>
        <ProfileSetup onSave={handleProfileSave} onBrowse={handleBrowse} />
        {/* Grant and profile modals aren't needed on the setup page */}
      </>
    )
  }

  // ── Results page ─────────────────────────────────────────────────────────────
  return (
    <div style={styles.page}>

      {/* Compact top bar — replaces the big hero now that the profile drives search */}
      <header style={styles.topBar}>
        <span style={styles.topLogo}>
          Grant<span style={styles.logoAccent}>Finder</span>
        </span>
        <div style={styles.topActions}>
          <button onClick={() => setShowEditProfile(true)} style={styles.editBtn}>
            {profile
              ? (profile.name ? `${profile.name} ✎` : 'Edit Profile ✎')
              : 'Add Profile'}
          </button>
          <button onClick={handleClearProfile} style={styles.clearBtn}>
            Start over
          </button>
          <button
            onClick={() => setShowSaved(s => !s)}
            style={{ ...styles.savedBtn, ...(showSaved ? styles.savedBtnActive : {}) }}
          >
            {showSaved ? '★' : '☆'} Saved{savedGrants.length > 0 ? ` (${savedGrants.length})` : ''}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={styles.main}>

        {/* Toolbar row — label on left, sync chip on right */}
        <div style={styles.toolbar}>
          <span style={styles.toolbarLabel}>
            {showSaved
              ? <><strong>{savedGrants.length}</strong> saved grant{savedGrants.length !== 1 ? 's' : ''}</>
              : grantState ? <>Grants for <strong>{grantState}</strong></> : 'All grants'
            }
          </span>
          {!showSaved && syncedAt && (
            <span style={styles.syncChip}>Synced {formatSync(syncedAt)}</span>
          )}
        </div>

        {/* Relevance banner — appears when a profile is active and scoring ran */}
        {profile && relevantCount !== null && !showSaved && !loading && !error && (
          <div style={styles.banner}>
            <span style={styles.bannerIcon}>✦</span>
            Based on your profile,{' '}
            <strong>{relevantCount} grant{relevantCount !== 1 ? 's' : ''}</strong>{' '}
            may be relevant to you{relevantCount > 0 ? ' — shown first.' : '.'}
          </div>
        )}

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

        {!loading && !error && !showSaved && grants.length >= limit && (
          <div style={styles.showMoreRow}>
            <button onClick={handleShowMore} style={styles.showMoreBtn}>
              Show more grants
            </button>
          </div>
        )}

        {!showSaved && grants.some(g => g.source === 'careeronestop') && (
          <p style={styles.cosAttribution}>
            Some results powered by <strong>CareerOneStop</strong> — data provided by the U.S. Department of Labor Employment and Training Administration (DOLETA) and the Minnesota Department of Employment &amp; Economic Development (DEED).
          </p>
        )}

        {!loading && !error && displayGrants.length === 0 && (
          <div style={styles.center}>
            <p style={styles.hint}>
              {showSaved
                ? 'No saved grants yet — click the bookmark on any card to save it.'
                : 'No grants found.'}
            </p>
          </div>
        )}
      </main>

      {/* Grant detail modal */}
      {selectedGrant && (
        <GrantModal
          grant={selectedGrant}
          isSaved={savedIds.has(selectedGrant.id)}
          onToggleSave={toggleSave}
          onClose={() => setSelectedGrant(null)}
          profile={profile}
        />
      )}

      {/* Profile edit modal (only on results page — setup uses full-page form) */}
      {showEditProfile && (
        <ProfileModal
          profile={profile}
          onSave={handleProfileSave}
          onClose={() => setShowEditProfile(false)}
        />
      )}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    fontFamily: F,
    color: '#0f172a',
  },

  /* ── Top bar ── */
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    background: 'linear-gradient(160deg, #050c1f 0%, #0b1c42 100%)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  topLogo: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.8px',
    color: '#fff',
    fontFamily: F,
  },
  logoAccent: {
    color: '#818cf8',
  },
  topActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  editBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.07)',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: F,
  },
  clearBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid rgba(248,113,113,0.35)',
    background: 'rgba(248,113,113,0.1)',
    color: 'rgba(252,165,165,0.9)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: F,
  },
  savedBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: F,
  },
  savedBtnActive: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    border: '1px solid transparent',
    color: '#fff',
    boxShadow: '0 1px 3px rgba(245,158,11,0.45)',
  },

  /* ── Main ── */
  main: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '28px 20px 72px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
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
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    borderRadius: 10,
    padding: '10px 16px',
    fontSize: 13,
    color: '#3730a3',
    fontWeight: 500,
    marginBottom: 16,
    lineHeight: 1.5,
  },
  bannerIcon: {
    fontSize: 14,
    color: '#6366f1',
    flexShrink: 0,
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
  showMoreRow: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  showMoreBtn: {
    padding: '10px 28px',
    borderRadius: 9,
    border: '1.5px solid #c7d2fe',
    background: '#eef2ff',
    color: '#4338ca',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: F,
    letterSpacing: '0.01em',
  },
  cosAttribution: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    margin: '16px 0 0',
    lineHeight: 1.6,
  },
}
