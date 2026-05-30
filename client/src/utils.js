export function decode(str) {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&#8211;/g, '–')
}

export function formatSync(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts)) / 60000)
  if (diff < 1)    return 'just now'
  if (diff < 60)   return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function deadlineLabel(closeDate) {
  if (!closeDate) return null
  const parsed = new Date(closeDate)
  if (isNaN(parsed)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  parsed.setHours(0, 0, 0, 0)
  const days = Math.round((parsed - today) / (1000 * 60 * 60 * 24))
  if (days < 0)    return { text: 'Closed',        color: '#9ca3af' }
  if (days === 0)  return { text: 'Closes today',  color: '#dc2626' }
  if (days <= 7)   return { text: `${days}d left`, color: '#dc2626' }
  if (days <= 30)  return { text: `${days}d left`, color: '#d97706' }
  return            { text: `${days}d left`,        color: '#16a34a' }
}
