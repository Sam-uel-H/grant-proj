# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

Two servers must run simultaneously — open two terminals:

```bash
# Terminal 1 — backend (Express on port 3001)
cd server && node --watch index.js

# Terminal 2 — frontend (Vite/React on port 5173)
cd client && npm run dev
```

Postgres must be running locally (port 5432, database: `grantfinder`, user: `postgres`, password: `postgres`). The server connects on startup and will crash if Postgres is not available.

The backend syncs 500 grants from grants.gov into Postgres immediately on startup, then every hour via cron. The California scraper runs every Sunday at 2am.

## Architecture

**Stack:** React/Vite frontend · Express backend · PostgreSQL · no test suite

```
client/src/App.jsx                — search form + grant card grid
client/src/components/
  GrantCard.jsx                   — single grant card
  GrantModal.jsx                  — detail modal on card click
client/src/utils.js               — formatSync() for synced-at display
server/index.js                   — Express API + cron sync + DB (entire backend)
server/scrapers/california.js     — Playwright scraper for grants.ca.gov
```

**Single API endpoint:** `GET /api/grants?zip=XXXXX&entityType=any|individual|small_business|nonprofit`

## Request routing logic

Every request first resolves zip → `state` + `city` via `api.zippopotam.us`. Then:

**`entityType = any` (DB-first path):**
- No zip → DB cache, 25 most recently synced grants
- Zip provided → three tiers merged in parallel, earlier tiers win:
  1. Scraped state grants from DB (`source = STATE_SOURCES[state]`, e.g. `'california'`)
  2. Live grants.gov search — keyword: city name (rows 25)
  3. Live grants.gov search — keyword: full state name (rows 50)

**`entityType = individual | small_business | nonprofit` (live path):**
- No zip → single grants.gov call, `eligibilities` code, empty keyword
- Zip provided → three calls in parallel, merged city-first:
  1. grants.gov — keyword: city, eligibility filter
  2. grants.gov — keyword: full state name, eligibility filter
  3. grants.gov — keyword: empty (general), eligibility filter

`normalizeGrant()` maps the camelCase grants.gov API shape to the snake_case DB column shape so React always receives the same field names regardless of source.

**Why two paths exist:** grants.gov search results don't include per-grant eligibility data, so filtering from the DB isn't possible. The live path hits grants.gov directly with the matching eligibility code (individual=21, small\_business=23, nonprofit=12).

## Key lookup tables in server/index.js

| Constant | Purpose |
|---|---|
| `ELIGIBILITY` | entityType → grants.gov eligibility code |
| `STATE_SOURCES` | state abbreviation → DB `source` column value (e.g. `CA → 'california'`) |
| `STATE_NAMES` | state abbreviation → full name used as grants.gov keyword |

Add to `STATE_SOURCES` when a new state scraper is added; `STATE_NAMES` already has all 50 states + DC.

## Database

```sql
-- Single table
opportunities (
  id TEXT PRIMARY KEY,    -- grants.gov ID or 'ca-{portalId}' for CA scraper
  source TEXT,            -- 'grants.gov' | 'california'
  number, title, agency, agency_code, status,
  open_date, close_date,  -- TEXT in MM/DD/YYYY format from grants.gov
  doc_type, cfda_list TEXT[],
  link TEXT,
  synced_at TIMESTAMPTZ
)
```

Connect: `psql -U postgres -d grantfinder`

The `ON CONFLICT (id) DO UPDATE` upsert in `syncGrants()` and the CA scraper is safe to run repeatedly.

## Deployment gaps (not yet set up)

- No `"start"` script in `server/package.json` (currently dev-only `node --watch`)
- Express does not serve the built Vite frontend (`client/dist/`)
- No DB schema migration file for provisioning a fresh Postgres instance
- Playwright (CA scraper) requires browser binaries — needs a guard for environments where it's unavailable
- `.env` files contain only localhost values; production env vars not documented

## Known gaps

- **HTML entities in titles:** grants.gov returns `&ndash;` and `&amp;` — rendered raw.
- **No amount data:** grants.gov search2 doesn't return award amounts; would need per-grant detail API calls.
- **No user profiles:** eligibility matching is per-request via grants.gov, not stored.
- **Rate limiter is in-memory:** `express-rate-limit` resets on restart; doesn't work across multiple instances.
- **Postgres PATH (Windows):** Add `C:\Program Files\PostgreSQL\17\bin` to user PATH if `psql` is not found.
