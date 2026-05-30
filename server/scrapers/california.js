import { chromium } from 'playwright'

const BASE = 'https://www.grants.ca.gov'

// Pull text from a meta field like .single-grants__meta-item--grantor
function metaText(el, modifier) {
  const container = el.querySelector(`.single-grants__meta-item--${modifier}`)
  if (!container) return null
  const dd = container.querySelector('dd')
  return dd?.innerText?.trim() || null
}

export async function scrapeCalifornia(pool) {
  console.log('[CA] Starting California scraper...')
  const browser = await chromium.launch()

  try {
    const page = await browser.newPage()

    // Step 1 — collect all grant links from the listing page
    await page.goto(`${BASE}/grants/`, { waitUntil: 'networkidle', timeout: 30000 })

    const links = await page.evaluate((base) => {
      return Array.from(document.querySelectorAll('.entry-title a'))
        .map(a => ({ title: a.innerText.trim(), href: a.href }))
        .filter(g => g.href.startsWith(base + '/grants/'))
    }, BASE)

    console.log(`[CA] Found ${links.length} grants on listing page`)

    // Step 2 — visit each grant's detail page to get full metadata
    let saved = 0
    for (const { title, href } of links) {
      try {
        await page.goto(href, { waitUntil: 'networkidle', timeout: 20000 })

        const grant = await page.evaluate((pageUrl) => {
          function meta(modifier) {
            const el = document.querySelector(`.single-grants__meta-item--${modifier} dd`)
            return el?.innerText?.trim() || null
          }

          // portal ID is unique per grant on this site
          const portalId = meta('portal-id')
          const grantor  = document.querySelector('.single-grants__meta-item--grantor dd')?.innerText?.trim() || null
          const status   = document.querySelector('.single-grants__meta-item--status .status')?.innerText?.trim() || null
          const openDate = meta('open-date')
          const closeDate = meta('close-date')  // not all grants have this

          return { portalId, grantor, status, openDate, closeDate, pageUrl }
        }, href)

        if (!grant.portalId) continue  // skip if we couldn't parse the page

        await pool.query(`
          INSERT INTO opportunities
            (id, source, number, title, agency, status, open_date, close_date, link)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            title      = EXCLUDED.title,
            agency     = EXCLUDED.agency,
            status     = EXCLUDED.status,
            close_date = EXCLUDED.close_date,
            synced_at  = NOW()
        `, [
          `ca-${grant.portalId}`,   // unique ID — prefix avoids collision with grants.gov IDs
          'california',
          grant.portalId,
          title,
          grant.grantor,
          grant.status?.toLowerCase() || 'unknown',
          grant.openDate,
          grant.closeDate,
          href
        ])

        saved++
        console.log(`[CA] Saved: ${title.slice(0, 60)}`)
      } catch (err) {
        console.error(`[CA] Failed to scrape ${href}: ${err.message}`)
      }
    }

    console.log(`[CA] Done. Saved ${saved} California grants.`)
  } finally {
    await browser.close()
  }
}
