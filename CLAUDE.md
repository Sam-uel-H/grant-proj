# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

Two servers must run simultaneously — open two terminals:

```bash
# Terminal 1 — backend (Express on port 3001)
cd server && npm run dev

# Terminal 2 — frontend (Vite/React on port 5173)
cd client && npm run dev
```

Postgres must be running locally (port 5432, database: `grantfinder`, user: `postgres`, password: `postgres`). The server connects on startup and will crash if Postgres is not available.

The backend syncs 500 grants from grants.gov on startup and hourly via cron. The California scraper runs every Sunday at 2am. Set `PLAYWRIGHT_SKIP=1` to skip Playwright scrapers.

## Architecture

**Stack:** React/Vite frontend · Express backend · PostgreSQL · no test suite

```
client/src/App.jsx                     — two-view shell: 'setup' and 'results'
client/src/components/
  ProfileSetup.jsx                     — full-page profile intake form (setup view)
  ProfileModal.jsx                     — modal to edit profile from results view
  GrantCard.jsx                        — single grant card with match reason pills
  GrantModal.jsx                       — grant detail modal with match section
client/src/utils.js                    — formatSync(), decode(), deadlineLabel()
server/index.js                        — Express API + cron sync + DB (entire backend)
server/scrapers/california.js          — Playwright scraper for grants.ca.gov
```

### Frontend flow

The app starts on the `setup` view (ProfileSetup). When the user saves a profile, the UUID is stored in `localStorage` and the app switches to the `results` view. On reload, the stored UUID is fetched from `GET /api/profile/:id` to restore the session and skip the setup page.

Saved grants are stored in `localStorage` under `grantfinder_saved` as a JSON array of full grant objects.

## Data strategy (three tiers)

**Tier 1 — grants.gov** (primary): 500 grants synced hourly to DB. Live keyword searches on every request, targeted by profile attributes (veteran, student, low-income, etc.).

**Tier 2 — Curated programs** (seeded): 14 well-known individual-facing programs (GI Bill, LIHEAP, Job Corps, SBIR, etc.) stored with `source='curated'`. Seeded on startup via `ensureCurated()`, never overwritten. These are what grants.gov search doesn't surface well — direct-to-individual programs.

**Tier 3 — CareerOneStop** (optional): DOL API for scholarships and workforce training. Enabled when `CAREERONESTOP_USER_ID` + `CAREERONESTOP_TOKEN` env vars are set. Results have `source='careeronestop'`. **Attribution is required by ToS (condition 6)** — the app displays a footer attribution whenever COS results appear.

## API endpoints

**`GET /api/grants?zip=&entityType=&profileId=&limit=`**

- `entityType`: `any` | `individual` | `small_business` | `nonprofit` (default: `any`)
- `profileId`: UUID — triggers server-side relevance scoring; each grant gets `relevance_score` + `match_reasons[]`
- `limit`: 1–100 (default: 25)
- Response: `{ state, grants[], syncedAt, relevantCount }`

**`POST /api/profile`** — creates a user profile, returns the saved row with generated UUID

**`GET /api/profile/:id`** — retrieves a profile by UUID (used to restore sessions)

## Request routing logic

Every request first resolves zip → `state` + `city` via `api.zippopotam.us`. Then:

**`entityType = any` (DB-first path, with zip):**
Tiers run in parallel, earlier tiers win deduplication:
1. Scraped state grants from DB (`source = STATE_SOURCES[state]`, e.g. `'california'`)
2. Curated programs from DB (when profile is active)
3. CareerOneStop results (when COS keys are set and profile is active)
4. Live grants.gov searches — one per profile keyword term (all in parallel)
5. Live grants.gov search — keyword: city name
6. Live grants.gov search — keyword: full state name

**`entityType = any` (DB-first path, no zip):**
Tiers: curated → COS → profile keyword live searches → DB cache (25 most recent)

**`entityType = individual | small_business | nonprofit` (live path):**
Hits grants.gov directly with eligibility codes. Three parallel calls (city, state, general). No curated/COS on this path.

`normalizeGrant()` maps the camelCase grants.gov API shape to snake_case so React always receives the same field names regardless of source.

### Profile-driven keyword search

`buildProfileSearchTerms(profile)` returns one search term per active flag — all run in parallel so a veteran+student fires two simultaneous grants.gov searches:
- `is_student` → `'scholarship education fellowship'`
- `is_veteran` → `'veteran military service'`
- `is_homeowner` → `'home repair weatherization housing'`
- low income (Under $25k or $25k–$50k) → `'housing assistance energy utility LIHEAP'`
- `small_business` → `'small business entrepreneur workforce'`
- `nonprofit` → `'nonprofit community development capacity'`
- fallback (no flags) → `'workforce training employment'`

### Profile-based scoring

`scoreGrant(grant, profile)` returns `{ score, reasons[] }`. Searches title + agency + description (so curated programs with rich descriptions score correctly). `withScoring()` attaches `relevance_score` and `match_reasons` to each grant and sorts highest-first.

Score contributors: veteran (CFDA 64.x, +7 max), student (CFDA 84.x, +7 max), homeowner (CFDA 14.x, +5 max), low-income (CFDA 93.568/81.042, +7 max), nonprofit (+3), small_business (+3), workforce (+1).

## Key lookup tables in server/index.js

| Constant | Purpose |
|---|---|
| `ELIGIBILITY` | entityType → grants.gov eligibility code |
| `STATE_SOURCES` | state abbreviation → DB `source` column value (e.g. `CA → 'california'`) |
| `STATE_NAMES` | state abbreviation → full name used as grants.gov keyword |
| `CURATED_PROGRAMS` | 14 curated program records seeded into `opportunities` table |

Add to `STATE_SOURCES` when a new state scraper is added; `STATE_NAMES` already has all 50 states + DC.

## Database

```sql
-- Grants table
opportunities (
  id TEXT PRIMARY KEY,    -- grants.gov ID | 'ca-{portalId}' | 'curated-{slug}' | 'cos-{type}-{id}'
  source TEXT,            -- 'grants.gov' | 'california' | 'curated' | 'careeronestop'
  number, title, agency, agency_code, status,
  open_date, close_date,  -- TEXT in MM/DD/YYYY format from grants.gov
  doc_type, cfda_list TEXT[],
  description TEXT,       -- added via ALTER TABLE ADD COLUMN IF NOT EXISTS on startup
  link TEXT,
  synced_at TIMESTAMPTZ
)

-- User profiles table
users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name, state, zip, age_range, income_range, occupation, entity_type TEXT,
  is_student, is_veteran, is_homeowner BOOLEAN,
  created_at TIMESTAMPTZ
)
```

Both tables are created automatically on startup. `income_range` is added via `ALTER TABLE ADD COLUMN IF NOT EXISTS` — safe on existing databases.

Connect: `psql -U postgres -d grantfinder`

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | server | If set, overrides individual DB_ vars (uses SSL) |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | server | Local Postgres config |
| `PORT` | server | Defaults to 3001 |
| `CORS_ORIGIN` | server | Allowed origin; defaults to `*` with a warning |
| `NODE_ENV` | server | `production` enables static file serving from `client/dist/` |
| `PLAYWRIGHT_SKIP` | server | Set to any value to skip CA scraper |
| `VITE_API_URL` | client | Backend base URL (e.g. `http://localhost:3001`) |
| `CAREERONESTOP_USER_ID` | server | DOL CareerOneStop user ID (optional) |
| `CAREERONESTOP_TOKEN` | server | DOL CareerOneStop Bearer token (optional) |

CareerOneStop ToS requires attribution on every page showing COS data — the app shows a footer automatically when COS results are present.

## Deployment gaps

- No DB schema migration file for provisioning a fresh Postgres instance (schema is auto-created on startup)
- `.env` files contain only localhost values; production env vars not documented
- Playwright CA scraper requires browser binaries — use `PLAYWRIGHT_SKIP=1` in environments where they're unavailable

## Known gaps

- **HTML entities in titles:** grants.gov returns `&ndash;` and `&amp;` — rendered raw.
- **No amount data:** grants.gov search2 doesn't return award amounts; would need per-grant detail API calls.
- **Rate limiter is in-memory:** `express-rate-limit` resets on restart; doesn't work across multiple instances.
- **Postgres PATH (Windows):** Add `C:\Program Files\PostgreSQL\17\bin` to user PATH if `psql` is not found.
