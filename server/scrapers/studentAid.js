// StudentAid.gov scraper — uses plain fetch (no browser) since studentaid.gov
// blocks headless Playwright. Falls back to hardcoded program data if the
// site's HTML doesn't contain parseable grant links (client-side rendered).

const BASE = 'https://studentaid.gov'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Known federal student grant programs — used as fallback if the site can't
// be fetched, and as the source of truth for CFDA codes and IDs.
const KNOWN_PROGRAMS = [
  {
    id:          'studentaid-pell',
    title:       'Federal Pell Grant',
    description: 'Need-based grant for undergraduate students who have not yet earned a bachelor\'s degree. Does not need to be repaid. Award amounts depend on financial need, cost of attendance, enrollment status, and plans to attend for a full academic year.',
    cfda_list:   ['84.063'],
    link:        `${BASE}/understand-aid/types/grants/pell`,
  },
  {
    id:          'studentaid-seog',
    title:       'Federal Supplemental Educational Opportunity Grant (FSEOG)',
    description: 'Additional need-based grant for undergraduate students with exceptional financial need. Priority is given to students who receive Federal Pell Grants. Awards range from $100 to $4,000 per year.',
    cfda_list:   ['84.007'],
    link:        `${BASE}/understand-aid/types/grants/seog`,
  },
  {
    id:          'studentaid-teach-grant',
    title:       'TEACH Grant — Teacher Education Assistance for College and Higher Education',
    description: 'Grant for students completing coursework to become a teacher in a high-need field at a low-income school. Up to $4,000 per year. Requires a service agreement to teach for at least 4 years after graduation.',
    cfda_list:   ['84.379'],
    link:        `${BASE}/teach-grant-program`,
  },
  {
    id:          'studentaid-iraq-afghanistan',
    title:       'Iraq and Afghanistan Service Grant',
    description: 'For students whose parent or guardian died as a result of military service in Iraq or Afghanistan after September 11, 2001. Available to students who do not qualify for a Pell Grant based on financial need.',
    cfda_list:   ['84.408'],
    link:        `${BASE}/understand-aid/types/grants/iraq-afghanistan-service`,
  },
]

export async function scrapeStudentAid(pool) {
  console.log('[StudentAid] Starting...')

  // Try live fetch first — if the page is server-rendered we get real data.
  // If not (JS-only site), we fall back to KNOWN_PROGRAMS.
  let livePrograms = []
  try {
    const res = await fetch(`${BASE}/understand-aid/types/grants`, { headers: HEADERS })
    if (res.ok) {
      const html = await res.text()
      // Look for href patterns linking to individual grant pages
      const hrefs = [...html.matchAll(/href="(\/understand-aid\/types\/grants\/[^"]+|\/teach-grant[^"]*)"/g)]
        .map(m => m[1])
        .filter(h => !h.endsWith('/grants'))
      const unique = [...new Set(hrefs)]

      for (const href of unique) {
        const fullUrl = BASE + href
        // Check if this matches a known program and enrich with our data
        const known = KNOWN_PROGRAMS.find(p => fullUrl.includes(p.link.replace(BASE, '')))
        if (known) livePrograms.push({ ...known, link: fullUrl })
      }
      console.log(`[StudentAid] Live fetch found ${livePrograms.length} matching program links`)
    }
  } catch (err) {
    console.warn(`[StudentAid] Live fetch failed: ${err.message} — using fallback data`)
  }

  // Use live results if we got them, otherwise fall back to the hardcoded list
  const programs = livePrograms.length > 0 ? livePrograms : KNOWN_PROGRAMS

  let saved = 0
  for (const p of programs) {
    try {
      await pool.query(`
        INSERT INTO opportunities
          (id, source, title, agency, agency_code, status, cfda_list, link, description)
        VALUES ($1, 'studentaid', $2, $3, 'ED', 'posted', $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          title       = EXCLUDED.title,
          description = EXCLUDED.description,
          synced_at   = NOW()
      `, [p.id, p.title, 'U.S. Department of Education', p.cfda_list, p.link, p.description])
      saved++
      console.log(`[StudentAid] Saved: ${p.title}`)
    } catch (err) {
      console.error(`[StudentAid] DB error for ${p.id}: ${err.message}`)
    }
  }

  console.log(`[StudentAid] Done. Saved ${saved} programs.`)
}
