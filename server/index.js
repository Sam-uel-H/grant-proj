import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import pg from 'pg'
import cron from 'node-cron'
import { scrapeCalifornia } from './scrapers/california.js'
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

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      source TEXT, number TEXT, title TEXT, agency TEXT, agency_code TEXT,
      status TEXT, open_date TEXT, close_date TEXT, doc_type TEXT,
      cfda_list TEXT[], link TEXT, synced_at TIMESTAMPTZ DEFAULT NOW()
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

const CORS_ORIGIN = process.env.CORS_ORIGIN
const PORT = Number(process.env.PORT) || 3001

if (process.env.NODE_ENV === 'production' && !CORS_ORIGIN) {
  console.error('FATAL: CORS_ORIGIN env var is required in production')
  process.exit(1)
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

const app = express()
app.use(helmet())
app.use(cors({ origin: CORS_ORIGIN }))
app.use('/api/grants', rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }))

app.get('/api/grants', async (req, res) => {
  const { zip, entityType = 'any' } = req.query

  if (!ELIGIBILITY[entityType]) {
    return res.status(400).json({ error: 'Invalid entityType' })
  }

  let state = null
  let city  = null
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

      return res.json({ state, grants, syncedAt: null })
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

      return res.json({
        state,
        grants:   mergeTiers(dbResult.rows, cityGrants, stateGrants),
        syncedAt: syncResult.rows[0].last_sync,
      })
    }

    // No state: serve from local DB cache (fast path, no live calls)
    const grantsResult = await pool.query(`
      SELECT * FROM opportunities
      WHERE status IN ('posted', 'active')
      ORDER BY synced_at DESC
      LIMIT 25
    `)

    res.json({ state: null, grants: grantsResult.rows, syncedAt: syncResult.rows[0].last_sync })
  } catch (err) {
    res.status(500).json({ error: 'Database error' })
  }
})

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  const dist = join(__dirname, '../client/dist')
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))
}

// grants.gov: every hour
ensureSchema().then(() => {
  syncGrants()
  cron.schedule('0 * * * *', syncGrants)
})

// California scraper: every Sunday at 2am (skip on hosts without Playwright browsers)
if (!process.env.PLAYWRIGHT_SKIP) {
  cron.schedule('0 2 * * 0', () => scrapeCalifornia(pool))
}

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
