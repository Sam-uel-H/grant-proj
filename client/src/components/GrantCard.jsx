import { useState } from 'react'
import { decode, deadlineLabel } from '../utils.js'

const STATUS_LABEL = {
  posted:     'Open',
  active:     'Active',
  closed:     'Closed',
  forecasted: 'Forecasted',
  archived:   'Archived',
}

const SHADOW   = '0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.07), 0 4px 8px rgba(0,0,0,0.04)'
const SHADOW_H = '0 0 0 1px rgba(0,0,0,0.07), 0 4px 8px rgba(0,0,0,0.07), 0 16px 32px rgba(0,0,0,0.09)'

const F = '"Inter", system-ui, -apple-system, sans-serif'

export default function GrantCard({ grant, isSaved, onToggleSave, onCardClick }) {
  const [hovered, setHovered] = useState(false)

  const title   = decode(grant.title)
  const urgency = deadlineLabel(grant.close_date)
  const isCA    = grant.source === 'california'
  const isOpen  = grant.status === 'posted' || grant.status === 'active'

  const statusLabel = STATUS_LABEL[grant.status] || grant.status || 'Unknown'
  const statusStyle = isOpen
    ? { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }
    : { background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }

  const accentColor = urgency?.color ?? (isOpen ? '#10b981' : '#cbd5e1')

  return (
    <article
      style={{
        ...styles.card,
        borderLeft: `3px solid ${accentColor}`,
        boxShadow: hovered ? SHADOW_H : SHADOW,
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onCardClick}
    >
      <div style={styles.topRow}>
        <div style={styles.badges}>
          <span style={{ ...styles.badge, ...statusStyle }}>{statusLabel}</span>
          {isCA && (
            <span style={{ ...styles.badge, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
              California
            </span>
          )}
        </div>
        <div style={styles.topRight}>
          {urgency && (
            <span style={{ fontSize: 11, fontWeight: 600, color: urgency.color, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
              {urgency.text}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onToggleSave(grant) }}
            style={{ ...styles.bookmark, color: isSaved ? '#f59e0b' : '#cbd5e1' }}
            title={isSaved ? 'Remove bookmark' : 'Save grant'}
          >
            {isSaved ? '★' : '☆'}
          </button>
        </div>
      </div>

      <h2 style={styles.title}>{title}</h2>
      <p style={styles.agency}>{grant.agency}</p>

      <div style={styles.metaRow}>
        <MetaField label="Opened"   value={grant.open_date  || '—'} />
        <MetaField label="Deadline" value={grant.close_date || 'Rolling'} />
        {grant.number && <MetaField label="ID" value={grant.number} />}
      </div>

      <a
        href={grant.link || `https://www.grants.gov/search-results-detail/${grant.id}`}
        target="_blank"
        rel="noreferrer"
        style={styles.viewLink}
        onClick={e => e.stopPropagation()}
      >
        View listing →
      </a>
    </article>
  )
}

function MetaField({ label, value }) {
  return (
    <div>
      <div style={styles.metaLabel}>{label}</div>
      <div style={styles.metaValue}>{value}</div>
    </div>
  )
}

const styles = {
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '18px 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    cursor: 'pointer',
    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
    fontFamily: F,
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  badges: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 20,
    letterSpacing: '0.01em',
  },
  topRight: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexShrink: 0,
  },
  bookmark: {
    background: 'none',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 1px',
    lineHeight: 1,
    transition: 'color 0.15s',
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
    lineHeight: 1.5,
    letterSpacing: '-0.01em',
  },
  agency: {
    margin: 0,
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
  metaRow: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap',
    paddingTop: 6,
    borderTop: '1px solid #f1f5f9',
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 12,
    color: '#475569',
    fontWeight: 500,
  },
  viewLink: {
    fontSize: 12,
    color: '#6366f1',
    fontWeight: 600,
    textDecoration: 'none',
    letterSpacing: '0.01em',
  },
}
