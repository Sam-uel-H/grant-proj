import { useEffect } from 'react'
import { decode, deadlineLabel } from '../utils.js'

const STATUS_LABEL = {
  posted:     'Open',
  active:     'Active',
  closed:     'Closed',
  forecasted: 'Forecasted',
  archived:   'Archived',
}

const F = '"Inter", system-ui, -apple-system, sans-serif'

// Returns a list of human-readable reasons why this grant matches the profile,
// or an empty array if nothing matched. Returns null if there's no profile.
function buildMatchReasons(grant, profile) {
  if (!profile) return null
  const reasons = []
  const text     = ((grant.title || '') + ' ' + (grant.agency || '')).toLowerCase()
  const cfdaStr  = (grant.cfda_list || []).join(',')

  if (profile.is_veteran && (/veteran|military|armed forces|service member/.test(text) || /\b64\./.test(cfdaStr)))
    reasons.push('Relates to veterans or military service')
  if (profile.is_student && (/student|education|scholarship|college|university|academic|school/.test(text) || /\b84\./.test(cfdaStr)))
    reasons.push('Education-focused grant')
  if (profile.is_homeowner && (/homeowner|housing|home buyer|residential|mortgage|property/.test(text) || /\b14\./.test(cfdaStr)))
    reasons.push('Housing or homeownership related')
  if (profile.entity_type === 'nonprofit'      && /nonprofit|non-profit|community organization|charity/.test(text))
    reasons.push('Targets nonprofits and community organizations')
  if (profile.entity_type === 'small_business' && /small business|entrepreneur|startup|business development/.test(text))
    reasons.push('Designed for small businesses')
  if (profile.entity_type === 'individual'     && /individual|personal|citizen|family|household/.test(text))
    reasons.push('Open to individual applicants')

  return reasons
}

export default function GrantModal({ grant, isSaved, onToggleSave, onClose, profile }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title    = decode(grant.title)
  const urgency  = deadlineLabel(grant.close_date)
  const grantUrl = grant.link || `https://www.grants.gov/search-results-detail/${grant.id}`
  const isOpen   = grant.status === 'posted' || grant.status === 'active'
  const statusLabel = STATUS_LABEL[grant.status] || grant.status || 'Unknown'

  const statusStyle = isOpen
    ? { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }
    : { background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }

  const accentColor = urgency?.color ?? (isOpen ? '#10b981' : '#e2e8f0')

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={{ ...styles.accentBar, background: accentColor }} />

        <div style={styles.body}>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">✕</button>

          <div style={styles.badgeRow}>
            <span style={{ ...styles.badge, ...statusStyle }}>{statusLabel}</span>
            {grant.source === 'california' && (
              <span style={{ ...styles.badge, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                California
              </span>
            )}
            {urgency && (
              <span style={{ ...styles.badge, background: '#fff', color: urgency.color, border: `1px solid ${urgency.color}` }}>
                {urgency.text}
              </span>
            )}
          </div>

          <h2 style={styles.title}>{title}</h2>
          <p style={styles.agency}>{grant.agency}</p>

          <div style={styles.divider} />

          {grant.description && (
            <p style={styles.description}>{grant.description}</p>
          )}

          <div style={styles.grid}>
            <Field label="Opened"   value={grant.open_date  || '—'} />
            <Field label="Deadline" value={grant.close_date || 'Rolling'} />
            {grant.number      && <Field label="Grant #"     value={grant.number} />}
            {grant.doc_type    && <Field label="Type"        value={grant.doc_type} />}
            {grant.agency_code && <Field label="Agency Code" value={grant.agency_code} />}
            {grant.cfda_list?.length > 0 && (
              <Field label="CFDA" value={grant.cfda_list.join(', ')} />
            )}
          </div>

          <MatchSection grant={grant} profile={profile} />

          <div style={styles.actions}>
            <button
              onClick={() => onToggleSave(grant)}
              style={{ ...styles.saveBtn, ...(isSaved ? styles.savedActive : {}) }}
            >
              {isSaved ? '★ Saved' : '☆ Save'}
            </button>
            <a href={grantUrl} target="_blank" rel="noreferrer" style={styles.viewBtn}>
              View full listing →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function MatchSection({ grant, profile }) {
  const reasons = buildMatchReasons(grant, profile)
  if (reasons === null) return null  // no profile active

  if (reasons.length === 0) {
    return (
      <div style={matchStyles.none}>
        <span style={matchStyles.noneIcon}>○</span>
        No direct match with your profile — you may still be eligible. Check the full listing for details.
      </div>
    )
  }

  return (
    <div style={matchStyles.box}>
      <div style={matchStyles.heading}>✦ Why this may fit you</div>
      <ul style={matchStyles.list}>
        {reasons.map(r => <li key={r} style={matchStyles.item}>{r}</li>)}
      </ul>
    </div>
  )
}

const matchStyles = {
  box: {
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 20,
  },
  heading: {
    fontSize: 12,
    fontWeight: 700,
    color: '#4338ca',
    letterSpacing: '0.03em',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  list: {
    margin: 0,
    padding: '0 0 0 16px',
  },
  item: {
    fontSize: 13,
    color: '#3730a3',
    fontWeight: 500,
    lineHeight: 1.6,
  },
  none: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: 400,
    lineHeight: 1.6,
    marginBottom: 20,
  },
  noneIcon: {
    flexShrink: 0,
    marginTop: 1,
  },
}

function Field({ label, value }) {
  return (
    <div>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{value}</div>
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
    maxWidth: 560, width: '100%',
    maxHeight: '88vh',
    position: 'relative',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.07), 0 8px 16px rgba(0,0,0,0.08), 0 32px 64px rgba(0,0,0,0.16)',
    overflow: 'hidden',
    fontFamily: F,
    display: 'flex',
    flexDirection: 'column',
  },
  accentBar: {
    height: 4,
    flexShrink: 0,
  },
  body: {
    padding: '24px 28px 28px',
    position: 'relative',
    overflowY: 'auto',
    flex: 1,
  },
  closeBtn: {
    position: 'absolute', top: 16, right: 16,
    background: '#f1f5f9',
    border: 'none',
    width: 28, height: 28,
    borderRadius: '50%',
    fontSize: 12, cursor: 'pointer',
    color: '#64748b',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
    fontFamily: F,
  },
  badgeRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap',
    marginBottom: 14,
  },
  badge: {
    fontSize: 11, fontWeight: 600,
    padding: '3px 8px', borderRadius: 20,
    letterSpacing: '0.01em',
  },
  title: {
    margin: '0 0 6px',
    fontSize: 19, fontWeight: 700,
    color: '#0f172a', lineHeight: 1.4,
    letterSpacing: '-0.02em',
    paddingRight: 36,
  },
  agency: {
    margin: 0,
    fontSize: 13, color: '#94a3b8', fontWeight: 500,
    letterSpacing: '0.01em',
  },
  description: {
    margin: '0 0 18px',
    fontSize: 14,
    color: '#334155',
    lineHeight: 1.65,
  },
  divider: {
    height: 1,
    background: 'linear-gradient(90deg, #f8fafc 0%, #e2e8f0 40%, #e2e8f0 60%, #f8fafc 100%)',
    margin: '20px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px 28px',
    marginBottom: 24,
  },
  fieldLabel: {
    fontSize: 10, fontWeight: 700,
    color: '#cbd5e1', textTransform: 'uppercase',
    letterSpacing: '0.07em', marginBottom: 4,
  },
  fieldValue: {
    fontSize: 14, color: '#1e293b', fontWeight: 500,
  },
  actions: {
    display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
  },
  saveBtn: {
    padding: '10px 20px', borderRadius: 9,
    border: '1px solid #e2e8f0',
    background: '#f8fafc', color: '#475569',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    fontFamily: F,
    letterSpacing: '0.01em',
  },
  savedActive: {
    background: '#fffbeb', color: '#92400e',
    border: '1px solid #fde68a',
  },
  viewBtn: {
    display: 'inline-block',
    padding: '10px 20px', borderRadius: 9,
    background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
    boxShadow: '0 1px 3px rgba(79,70,229,0.45), 0 4px 12px rgba(79,70,229,0.22)',
    color: '#fff',
    fontSize: 13, fontWeight: 600,
    textDecoration: 'none',
    fontFamily: F,
    letterSpacing: '0.01em',
  },
}
