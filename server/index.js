import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import pg from 'pg'
import cron from 'node-cron'
import { scrapeCalifornia } from './scrapers/california.js'
import { scrapeStudentAid } from './scrapers/studentAid.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new pg.Pool({
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    })

const ELIGIBILITY = {
  any:            '99',
  individual:     '21',
  small_business: '23',
  nonprofit:      '12',
}

const STATE_SOURCES = {
  CA: 'california',
}

const STATE_NAMES = {
  AL: 'Alabama',      AK: 'Alaska',         AZ: 'Arizona',       AR: 'Arkansas',
  CA: 'California',   CO: 'Colorado',        CT: 'Connecticut',   DE: 'Delaware',
  FL: 'Florida',      GA: 'Georgia',         HI: 'Hawaii',        ID: 'Idaho',
  IL: 'Illinois',     IN: 'Indiana',         IA: 'Iowa',          KS: 'Kansas',
  KY: 'Kentucky',     LA: 'Louisiana',       ME: 'Maine',         MD: 'Maryland',
  MA: 'Massachusetts',MI: 'Michigan',        MN: 'Minnesota',     MS: 'Mississippi',
  MO: 'Missouri',     MT: 'Montana',         NE: 'Nebraska',      NV: 'Nevada',
  NH: 'New Hampshire',NJ: 'New Jersey',      NM: 'New Mexico',    NY: 'New York',
  NC: 'North Carolina',ND: 'North Dakota',   OH: 'Ohio',          OK: 'Oklahoma',
  OR: 'Oregon',       PA: 'Pennsylvania',    RI: 'Rhode Island',  SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee',       TX: 'Texas',         UT: 'Utah',
  VT: 'Vermont',      VA: 'Virginia',        WA: 'Washington',    WV: 'West Virginia',
  WI: 'Wisconsin',    WY: 'Wyoming',         DC: 'District of Columbia',
}

// ─── Data helpers ────────────────────────────────────────────────────────────

function normalizeGrant(g) {
  return {
    id:          g.id,
    number:      g.number,
    title:       g.title,
    agency:      g.agency,
    agency_code: g.agencyCode,
    status:      g.oppStatus,
    open_date:   g.openDate,
    close_date:  g.closeDate,
    doc_type:    g.docType,
    cfda_list:   g.cfdaList,
    source:      'grants.gov',
    link:        `https://www.grants.gov/search-results-detail/${g.id}`
  }
}

// Merge tiers of grant arrays, deduplicating by id. Earlier tiers win.
function mergeTiers(...tiers) {
  const seen = new Set()
  const out  = []
  for (const tier of tiers) {
    for (const g of tier) {
      if (!seen.has(g.id)) { seen.add(g.id); out.push(g) }
    }
  }
  return out.slice(0, 25)
}

// Score a single grant against a user profile.
// Searches the grant title + agency for keywords that match the profile.
// Returns a number: 0 = not relevant, higher = more relevant.
// Grants are sorted by this score before being returned to the client.
function scoreGrant(grant, profile) {
  let score = 0
  const text    = ((grant.title || '') + ' ' + (grant.agency || '')).toLowerCase()
  const cfdaStr = (grant.cfda_list || []).join(',')

  if (profile.is_veteran) {
    if (/veteran|military|armed forces|service member/.test(text)) score += 3
    if (/\b64\./.test(cfdaStr)) score += 2   // Dept of Veterans Affairs CFDA prefix
  }
  if (profile.is_student) {
    if (/student|education|scholarship|college|university|academic|school/.test(text)) score += 3
    if (/\b84\./.test(cfdaStr)) score += 2   // Dept of Education CFDA prefix
  }
  if (profile.is_homeowner) {
    if (/homeowner|housing|home buyer|residential|mortgage|property/.test(text)) score += 2
    if (/\b14\./.test(cfdaStr)) score += 2   // HUD CFDA prefix
  }

  if (profile.entity_type === 'nonprofit'      && /nonprofit|non-profit|community organization|charity/.test(text)) score += 2
  if (profile.entity_type === 'small_business' && /small business|entrepreneur|startup|business development/.test(text)) score += 2
  if (profile.entity_type === 'individual'     && /individual|personal|citizen|family|household/.test(text)) score += 1

  return score
}

// ─── Database setup ───────────────────────────────────────────────────────────

// Creates the grants table if it doesn't already exist.
// The IF NOT EXISTS clause makes this safe to call every time the server starts.
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      source TEXT, number TEXT, title TEXT, agency TEXT, agency_code TEXT,
      status TEXT, open_date TEXT, close_date TEXT, doc_type TEXT,
      cfda_list TEXT[], link TEXT, synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  // Safe to run on existing DBs — adds description column if missing
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS description TEXT`)
}

// Creates the users (profiles) table if it doesn't already exist.
// gen_random_uuid() is built into PostgreSQL 13+ — no extension needed.
async function ensureUsers() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT,
      state       TEXT,
      zip         TEXT,
      age_range   TEXT,
      occupation  TEXT,
      entity_type TEXT,
      is_student  BOOLEAN DEFAULT FALSE,
      is_veteran  BOOLEAN DEFAULT FALSE,
      is_homeowner BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

async function syncGrants() {
  console.log('[sync] Fetching from grants.gov...')
  try {
    const response = await fetch('https://api.grants.gov/v1/api/search2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: '', rows: 500, sortBy: 'openDate|desc' })
    })
    const { data } = await response.json()

    for (const g of data.oppHits) {
      await pool.query(`
        INSERT INTO opportunities (id, number, title, agency, agency_code, status, open_date, close_date, doc_type, cfda_list, link)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          title      = EXCLUDED.title,
          status     = EXCLUDED.status,
          close_date = EXCLUDED.close_date,
          synced_at  = NOW()
      `, [g.id, g.number, g.title, g.agency, g.agencyCode, g.oppStatus,
          g.openDate, g.closeDate, g.docType, g.cfdaList,
          `https://www.grants.gov/search-results-detail/${g.id}`])
    }
    console.log(`[sync] Saved ${data.oppHits.length} grants to database`)
  } catch (err) {
    console.error('[sync] Failed:', err.message)
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────

const CORS_ORIGIN = process.env.CORS_ORIGIN
const PORT = Number(process.env.PORT) || 3001

if (process.env.NODE_ENV === 'production' && !CORS_ORIGIN) {
  console.warn('WARNING: CORS_ORIGIN not set, allowing all origins temporarily')
}

const app = express()
app.use(helmet())
app.use(cors({ origin: CORS_ORIGIN || '*' }))
app.use(express.json())  // enables req.body parsing for POST endpoints
app.use('/api/grants',  rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }))
app.use('/api/profile', rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }))

// ─── GET /api/grants ──────────────────────────────────────────────────────────
//
// Query params:
//   zip        — 5-digit US zip code (optional)
//   entityType — 'any' | 'individual' | 'small_business' | 'nonprofit'  (default: 'any')
//   profileId  — UUID of a saved user profile (optional)
//
// When profileId is provided, grants are scored against the profile and
// sorted by relevance. The response also includes `relevantCount` so the
// frontend can show "X grants matched your profile".
//
app.get('/api/grants', async (req, res) => {
  const { zip, entityType = 'any', profileId } = req.query

  if (!ELIGIBILITY[entityType]) {
    return res.status(400).json({ error: 'Invalid entityType' })
  }

  // Load the user's profile from the database if a profileId was sent.
  // We use a UUID format check before hitting the DB to avoid wasting a query
  // on obviously invalid input.
  let profile = null
  if (profileId && /^[0-9a-f-]{36}$/.test(profileId)) {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [profileId])
      if (r.rows.length > 0) profile = r.rows[0]
    } catch { /* profile unavailable — continue without scoring */ }
  }

  // withScoring wraps a grants array before sending it to the client.
  // If no profile is active, it passes grants through untouched.
  // If a profile exists, it scores each grant, sorts highest-first, and
  // counts how many had at least one keyword match (relevantCount).
  //
  // NOTE: `state` is set later in the function but withScoring closes over it.
  // We declare `state` with let before defining withScoring so it's in scope.
  let state = null
  let city  = null

  function withScoring(grants, syncedAt) {
    if (!profile) return { state, grants, syncedAt, relevantCount: null }
    const scored = grants
      .map(g => ({ ...g, relevance_score: scoreGrant(g, profile) }))
      .sort((a, b) => b.relevance_score - a.relevance_score)
    return {
      state,
      grants: scored,
      syncedAt,
      relevantCount: scored.filter(g => g.relevance_score > 0).length,
    }
  }

  if (zip && /^\d{5}$/.test(zip)) {
    try {
      const geo = await fetch(`https://api.zippopotam.us/us/${zip}`)
      if (geo.ok) {
        const geoData = await geo.json()
        state = geoData.places[0]['state abbreviation']
        city  = geoData.places[0]['place name']
      }
    } catch (err) {
      console.warn(`[geo] zip lookup failed for ${zip}: ${err.message}`)
    }
  }

  if (entityType !== 'any') {
    try {
      const stateName = state ? STATE_NAMES[state] : null
      const baseBody = {
        rows: 25,
        eligibilities: ELIGIBILITY[entityType],
        oppStatuses: 'posted',
        sortBy: 'openDate|desc',
      }

      const fetchGov = (keyword) =>
        fetch('https://api.grants.gov/v1/api/search2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...baseBody, keyword }),
        }).then(r => r.json()).then(({ data }) => data.oppHits.map(normalizeGrant))

      let grants
      if (stateName) {
        // Three tiers in parallel: city-specific → state-specific → general
        const [cityGrants, stateGrants, generalGrants] = await Promise.all([
          city ? fetchGov(city) : Promise.resolve([]),
          fetchGov(stateName),
          fetchGov(''),
        ])
        grants = mergeTiers(cityGrants, stateGrants, generalGrants)
      } else {
        grants = await fetchGov('')
      }

      return res.json(withScoring(grants, null))
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch grants' })
    }
  }

  try {
    const syncResult = await pool.query(`SELECT MAX(synced_at) AS last_sync FROM opportunities`)

    if (state) {
      const stateName   = STATE_NAMES[state]
      const stateSource = STATE_SOURCES[state]

      // Three tiers in parallel: scraped state DB grants, city-keyword live, state-keyword live
      const [dbResult, cityGrants, stateGrants] = await Promise.all([
        stateSource
          ? pool.query(
              `SELECT * FROM opportunities WHERE status IN ('posted','active') AND source = $1 ORDER BY synced_at DESC LIMIT 25`,
              [stateSource]
            )
          : Promise.resolve({ rows: [] }),
        city
          ? fetch('https://api.grants.gov/v1/api/search2', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keyword: city, rows: 25, oppStatuses: 'posted', sortBy: 'openDate|desc' }),
            }).then(r => r.json()).then(({ data }) => data.oppHits.map(normalizeGrant)).catch(() => [])
          : Promise.resolve([]),
        fetch('https://api.grants.gov/v1/api/search2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: stateName, rows: 50, oppStatuses: 'posted', sortBy: 'openDate|desc' }),
        }).then(r => r.json()).then(({ data }) => data.oppHits.map(normalizeGrant)).catch(() => []),
      ])

      return res.json(withScoring(
        mergeTiers(dbResult.rows, cityGrants, stateGrants),
        syncResult.rows[0].last_sync
      ))
    }

    // No state: serve from local DB cache (fast path, no live calls)
    const grantsResult = await pool.query(`
      SELECT * FROM opportunities
      WHERE status IN ('posted', 'active')
      ORDER BY synced_at DESC
      LIMIT 25
    `)

    res.json(withScoring(grantsResult.rows, syncResult.rows[0].last_sync))
  } catch (err) {
    res.status(500).json({ error: 'Database error' })
  }
})

// ─── POST /api/profile ────────────────────────────────────────────────────────
//
// Creates a new user profile and stores it in the `users` table.
//
// Request body (all fields optional except where noted):
//   name        — display name (optional)
//   state       — 2-letter state abbreviation, e.g. "CA"
//   zip         — 5-digit zip code
//   age_range   — one of: "Under 18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"
//   occupation  — free-text, e.g. "Teacher"
//   entity_type — "individual" | "small_business" | "nonprofit" (or blank)
//   is_student  — boolean
//   is_veteran  — boolean
//   is_homeowner — boolean
//
// Response: the full saved row including the generated UUID `id`.
// The client stores this `id` in localStorage and sends it with future grant requests.
//
app.post('/api/profile', async (req, res) => {
  const {
    name, state, zip, age_range, occupation, entity_type,
    is_student = false, is_veteran = false, is_homeowner = false,
  } = req.body

  // entity_type must be one of the known values (or blank/omitted)
  if (entity_type && !ELIGIBILITY[entity_type]) {
    return res.status(400).json({ error: 'Invalid entity_type' })
  }

  try {
    const result = await pool.query(`
      INSERT INTO users (name, state, zip, age_range, occupation, entity_type, is_student, is_veteran, is_homeowner)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      name       || null,
      state      || null,
      zip        || null,
      age_range  || null,
      occupation || null,
      entity_type || null,
      Boolean(is_student),
      Boolean(is_veteran),
      Boolean(is_homeowner),
    ])
    res.json(result.rows[0])
  } catch (err) {
    console.error('[profile] Failed to save:', err.message)
    res.status(500).json({ error: 'Failed to save profile' })
  }
})

// ─── GET /api/profile/:id ─────────────────────────────────────────────────────
//
// Retrieves a user profile by its UUID.
// Used on app load to restore a profile saved in a previous session.
//
// Response: the full profile row, or 404 if the ID doesn't exist.
//
app.get('/api/profile/:id', async (req, res) => {
  // Validate UUID format before querying — prevents malformed input from reaching the DB
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid profile ID' })
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('[profile] Failed to fetch:', err.message)
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

// ─── Production static serving ────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const dist = join(__dirname, '../client/dist')
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))
}

// ─── Startup ──────────────────────────────────────────────────────────────────

// Create both tables, then start syncs.
Promise.all([ensureSchema(), ensureUsers()]).then(async () => {
  syncGrants()
  cron.schedule('0 * * * *', syncGrants)

  if (!process.env.PLAYWRIGHT_SKIP) {
    // California: every Sunday at 2am
    cron.schedule('0 2 * * 0', () => scrapeCalifornia(pool))

    // StudentAid.gov: monthly on the 1st at 3am
    cron.schedule('0 3 1 * *', () => scrapeStudentAid(pool))

    // Run StudentAid on first boot if the table has no records from it yet
    const { rows } = await pool.query(`SELECT 1 FROM opportunities WHERE source = 'studentaid' LIMIT 1`)
    if (rows.length === 0) scrapeStudentAid(pool).catch(e => console.error('[StudentAid] Uncaught:', e.message))
  }
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
