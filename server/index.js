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

const POOL_FACTOR = 3   // collect this many × limit grants before scoring
const MAX_POOL    = 75  // hard cap on pool size

// Maps occupation keywords → grant text patterns for Tier 3 scoring
const OCCUPATION_BOOSTS = [
  { keywords: /teacher|educator|instructor|professor|tutor/,
    grant:    /teacher|educator|education|school|classroom|professional development/,
    cfda:     /\b84\./,
    label:    'Education professional match' },
  { keywords: /nurse|nursing|\brn\b|\blpn\b|healthcare|health care|medical|\bcna\b|phlebotomist|\bemt\b|paramedic/,
    grant:    /nurse|nursing|healthcare|health care|medical|clinical|hospital|rural health/,
    cfda:     /\b93\./,
    label:    'Healthcare worker match' },
  { keywords: /farmer|agriculture|rancher|grower|farm worker|agricultural/,
    grant:    /farmer|agriculture|farm|rural|crop|livestock|rancher/,
    cfda:     /\b10\./,
    label:    'Agriculture\/farming match' },
  { keywords: /social work|counselor|case manager|mental health|therapist/,
    grant:    /social service|mental health|counseling|behavioral|community health/,
    cfda:     /\b93\./,
    label:    'Social services match' },
  { keywords: /artist|musician|writer|filmmaker|designer|creative/,
    grant:    /artist|arts|creative|cultural|humanities/,
    cfda:     /\b45\./,
    label:    'Arts\/creative field match' },
  { keywords: /engineer|scientist|researcher|\bstem\b|technology|software|developer/,
    grant:    /stem|research|science|technology|engineering|innovation/,
    cfda:     /\b47\.|\b43\./,
    label:    'STEM\/research match' },
  { keywords: /construction|contractor|electrician|plumber|carpenter|tradesperson/,
    grant:    /construction|trade|apprenticeship|skilled|infrastructure/,
    cfda:     /\b17\./,
    label:    'Skilled trades match' },
  { keywords: /lawyer|attorney|legal|paralegal/,
    grant:    /legal|law|justice|civil rights|public interest|access to justice/,
    cfda:     /\b16\./,
    label:    'Legal field match' },
  { keywords: /cook|chef|restaurant|food service|culinary/,
    grant:    /food service|culinary|hospitality|nutrition workforce/,
    cfda:     /\b10\.5/,
    label:    'Food service match' },
  { keywords: /driver|trucker|logistics|transport|delivery/,
    grant:    /transportation|logistics|freight|transit|mobility/,
    cfda:     /\b20\./,
    label:    'Transportation match' },
  { keywords: /firefighter|police|law enforcement|first responder/,
    grant:    /public safety|first responder|emergency management|fire department/,
    cfda:     /\b97\.|\b16\./,
    label:    'Public safety match' },
  { keywords: /accountant|bookkeeper|\bcpa\b|auditor/,
    grant:    /financial|economic development|small business|community finance/,
    cfda:     /\b59\./,
    label:    'Finance\/accounting match' },
  { keywords: /mechanic|automotive|\bhvac\b|auto repair/,
    grant:    /technical|automotive|trades|maintenance|mechanical/,
    cfda:     /\b17\./,
    label:    'Technical trades match' },
  { keywords: /programmer|software developer|it professional|cybersecurity/,
    grant:    /technology|digital|cybersecurity|software|broadband|innovation/,
    cfda:     /\b47\.|\b11\./,
    label:    'IT\/technology match' },
  { keywords: /child care|daycare|early childhood|childcare/,
    grant:    /early childhood|child care|preschool|childcare|head start/,
    cfda:     /\b93\./,
    label:    'Early childhood match' },
]

// Maps occupation keywords → grants.gov search terms for buildProfileSearchTerms
const OCCUPATION_SEARCH_TERMS = [
  { keywords: /teacher|educator|instructor|professor/,    term: 'teacher education professional development' },
  { keywords: /nurse|nursing|healthcare|health care|medical|\bemt\b|paramedic/, term: 'healthcare worker nurse rural health' },
  { keywords: /farmer|agriculture|rancher|grower/,        term: 'farmer agriculture rural USDA' },
  { keywords: /social work|counselor|mental health/,      term: 'social services mental health community' },
  { keywords: /artist|musician|writer|filmmaker/,         term: 'arts creative cultural humanities' },
  { keywords: /engineer|scientist|researcher|\bstem\b/,   term: 'STEM research science innovation' },
  { keywords: /construction|electrician|plumber|carpenter/, term: 'construction trades apprenticeship workforce' },
  { keywords: /lawyer|attorney|legal|paralegal/,             term: 'legal services public interest justice' },
  { keywords: /cook|chef|restaurant|food service|culinary/,  term: 'food service culinary hospitality workforce' },
  { keywords: /driver|trucker|logistics|transport/,          term: 'transportation logistics workforce training' },
  { keywords: /firefighter|police|law enforcement|first responder/, term: 'public safety first responder emergency' },
  { keywords: /accountant|bookkeeper|\bcpa\b/,               term: 'business finance workforce development' },
  { keywords: /mechanic|automotive|\bhvac\b|auto repair/,    term: 'technical trades automotive workforce' },
  { keywords: /programmer|software developer|it professional|cybersecurity/, term: 'technology innovation digital workforce' },
  { keywords: /child care|daycare|early childhood|childcare/, term: 'early childhood childcare workforce' },
]

// Well-known individual-facing programs not well-represented in grants.gov search results.
// Seeded on startup via ensureCurated(). ON CONFLICT DO NOTHING makes it safe to run every boot.
const CURATED_PROGRAMS = [
  // Veterans
  {
    id: 'curated-gi-bill',
    title: 'Post-9/11 GI Bill (Chapter 33)',
    agency: 'U.S. Department of Veterans Affairs',
    agency_code: 'VA',
    link: 'https://www.va.gov/education/about-gi-bill-benefits/post-9-11/',
    description: 'Education and housing benefits for veterans who served on active duty after September 10, 2001. Covers tuition, a monthly housing allowance, and a book stipend.',
    cfda_list: ['64.124'],
  },
  {
    id: 'curated-va-voc-rehab',
    title: 'VA Vocational Rehabilitation & Employment (Chapter 31)',
    agency: 'U.S. Department of Veterans Affairs',
    agency_code: 'VA',
    link: 'https://www.va.gov/careers-employment/vocational-rehabilitation/',
    description: 'Helps veterans with service-connected disabilities prepare for, find, and maintain employment through job training, education, and career counseling.',
    cfda_list: ['64.116'],
  },
  {
    id: 'curated-va-caregiver',
    title: 'VA Program of Comprehensive Assistance for Family Caregivers',
    agency: 'U.S. Department of Veterans Affairs',
    agency_code: 'VA',
    link: 'https://www.va.gov/family-member-benefits/comprehensive-assistance-for-family-caregivers/',
    description: 'Monthly stipend, health insurance, and mental health support for family caregivers of eligible post-9/11 veterans.',
    cfda_list: ['64.014'],
  },
  {
    id: 'curated-va-sah',
    title: 'VA Specially Adapted Housing (SAH) Grant',
    agency: 'U.S. Department of Veterans Affairs',
    agency_code: 'VA',
    link: 'https://www.va.gov/housing-assistance/disability-housing-grants/',
    description: 'Grants up to $109,986 to help veterans with certain service-connected disabilities buy, build, or modify a home to meet their needs.',
    cfda_list: ['64.106'],
  },
  // Students
  {
    id: 'curated-teach-grant',
    title: 'Federal TEACH Grant',
    agency: 'U.S. Department of Education',
    agency_code: 'ED',
    link: 'https://studentaid.gov/understand-aid/types/grants/teach',
    description: 'Up to $4,000 per year for education students who agree to teach full-time in a high-need field at a low-income school for at least four years after graduation.',
    cfda_list: ['84.379'],
  },
  {
    id: 'curated-americorps-award',
    title: 'AmeriCorps Segal Education Award',
    agency: 'AmeriCorps',
    agency_code: 'CNCS',
    link: 'https://americorps.gov/members-volunteers/segal-americorps-education-award',
    description: 'Earn up to $7,395 for college tuition or student loan repayment by completing a term of service through an AmeriCorps program.',
    cfda_list: ['94.006'],
  },
  // Housing
  {
    id: 'curated-usda-504-repair',
    title: 'USDA Section 504 Home Repair Grants',
    agency: 'U.S. Department of Agriculture',
    agency_code: 'USDA',
    link: 'https://www.rd.usda.gov/programs-services/single-family-housing-programs/single-family-housing-repair-loans-grants',
    description: 'Grants up to $10,000 for very low-income rural homeowners aged 62+ to repair or improve their home or remove health and safety hazards.',
    cfda_list: ['10.417'],
  },
  // Utility / Energy
  {
    id: 'curated-liheap',
    title: 'Low Income Home Energy Assistance Program (LIHEAP)',
    agency: 'U.S. Department of Health and Human Services',
    agency_code: 'HHS',
    link: 'https://www.acf.hhs.gov/ocs/programs/liheap',
    description: 'Helps low-income households pay for home heating and cooling bills and provides emergency energy assistance. Apply through your state or local agency.',
    cfda_list: ['93.568'],
  },
  {
    id: 'curated-wap',
    title: 'Weatherization Assistance Program (WAP)',
    agency: 'U.S. Department of Energy',
    agency_code: 'DOE',
    link: 'https://www.energy.gov/scep/wap/weatherization-assistance-program',
    description: 'Free home weatherization improvements (insulation, air sealing, HVAC upgrades) for income-qualified households to permanently reduce energy bills.',
    cfda_list: ['81.042'],
  },
  // Small Business
  {
    id: 'curated-sbir',
    title: 'Small Business Innovation Research (SBIR) Program',
    agency: 'U.S. Small Business Administration',
    agency_code: 'SBA',
    link: 'https://www.sbir.gov/',
    description: 'Competitive grants for small businesses engaged in R&D with commercial potential. Phase I awards typically $150,000–$275,000 across participating federal agencies.',
    cfda_list: ['43.103'],
  },
  {
    id: 'curated-usda-rbdg',
    title: 'USDA Rural Business Development Grant (RBDG)',
    agency: 'U.S. Department of Agriculture',
    agency_code: 'USDA',
    link: 'https://www.rd.usda.gov/programs-services/business-programs/rural-business-development-grant-program',
    description: 'Grants for rural small businesses with fewer than 50 employees and under $1M annual revenue for training, technical assistance, and business development.',
    cfda_list: ['10.351'],
  },
  // Workforce / Training
  {
    id: 'curated-job-corps',
    title: 'Job Corps',
    agency: 'U.S. Department of Labor',
    agency_code: 'DOL',
    link: 'https://www.jobcorps.gov/',
    description: 'Free education and vocational training for low-income individuals ages 16–24. Provides housing, meals, a living allowance, and job placement support at no cost.',
    cfda_list: ['17.271'],
  },
  {
    id: 'curated-apprenticeship',
    title: 'ApprenticeshipUSA — Registered Apprenticeship',
    agency: 'U.S. Department of Labor',
    agency_code: 'DOL',
    link: 'https://www.apprenticeship.gov/',
    description: 'Earn wages while learning a skilled trade through a registered apprenticeship. Industries include construction, healthcare, IT, and advanced manufacturing.',
    cfda_list: ['17.201'],
  },
  {
    id: 'curated-wioa',
    title: 'Workforce Innovation and Opportunity Act (WIOA) Adult Program',
    agency: 'U.S. Department of Labor',
    agency_code: 'DOL',
    link: 'https://www.dol.gov/agencies/eta/wioa',
    description: 'Career counseling, job training, and employment services for adults and dislocated workers through local American Job Centers. Low-income adults receive priority.',
    cfda_list: ['17.258'],
  },
  // Students (additional)
  {
    id: 'curated-pell-grant',
    title: 'Federal Pell Grant',
    agency: 'U.S. Department of Education',
    agency_code: 'ED',
    link: 'https://studentaid.gov/understand-aid/types/grants/pell',
    description: 'Up to $7,395 per year for undergraduate students with financial need who have not yet earned a bachelor\'s or professional degree. The primary federal grant for college students.',
    cfda_list: ['84.063'],
  },
  {
    id: 'curated-work-study',
    title: 'Federal Work-Study Program',
    agency: 'U.S. Department of Education',
    agency_code: 'ED',
    link: 'https://studentaid.gov/understand-aid/types/work-study',
    description: 'Part-time jobs for undergraduate and graduate students with financial need, allowing them to earn money to help pay education expenses while enrolled.',
    cfda_list: ['84.033'],
  },
  {
    id: 'curated-trio-sss',
    title: 'TRIO Student Support Services',
    agency: 'U.S. Department of Education',
    agency_code: 'ED',
    link: 'https://www2.ed.gov/programs/triostudsupp/index.html',
    description: 'Free academic tutoring, advising, financial aid help, and transfer assistance for first-generation college students and low-income students at participating colleges.',
    cfda_list: ['84.042'],
  },
  // Homeowners (additional)
  {
    id: 'curated-hud-home',
    title: 'HUD HOME Investment Partnerships Program',
    agency: 'U.S. Department of Housing and Urban Development',
    agency_code: 'HUD',
    link: 'https://www.hud.gov/program_offices/comm_planning/home',
    description: 'Federal grants distributed to states and localities for affordable housing rehabilitation. Low-income homeowners can apply for home repair assistance through their local housing agency or city.',
    cfda_list: ['14.239'],
  },
  {
    id: 'curated-cdbg',
    title: 'Community Development Block Grant (CDBG) – Home Repair',
    agency: 'U.S. Department of Housing and Urban Development',
    agency_code: 'HUD',
    link: 'https://www.hud.gov/program_offices/comm_planning/cdbg',
    description: 'Many cities and counties use CDBG funds to offer home repair grants and low-interest loans for low-income homeowners. Contact your local housing or community development department.',
    cfda_list: ['14.218'],
  },
  // Low-Income (additional)
  {
    id: 'curated-snap',
    title: 'Supplemental Nutrition Assistance Program (SNAP)',
    agency: 'U.S. Department of Agriculture',
    agency_code: 'USDA',
    link: 'https://www.fns.usda.gov/snap/supplemental-nutrition-assistance-program',
    description: 'Monthly food assistance benefits for low-income individuals and families. Eligibility is based on income and household size. Apply through your state SNAP agency or local social services office.',
    cfda_list: ['10.551'],
  },
  {
    id: 'curated-wic',
    title: 'WIC – Women, Infants, and Children Program',
    agency: 'U.S. Department of Agriculture',
    agency_code: 'USDA',
    link: 'https://www.fns.usda.gov/wic',
    description: 'Provides healthy foods, nutrition education, breastfeeding support, and healthcare referrals for low-income pregnant women, new mothers, infants, and children up to age 5.',
    cfda_list: ['10.557'],
  },
  {
    id: 'curated-section-8',
    title: 'Housing Choice Voucher Program (Section 8)',
    agency: 'U.S. Department of Housing and Urban Development',
    agency_code: 'HUD',
    link: 'https://www.hud.gov/topics/housing_choice_voucher_program_section_8',
    description: 'Rental assistance vouchers for very low-income families, elderly, and people with disabilities to rent housing in the private market. Apply through your local Public Housing Authority.',
    cfda_list: ['14.871'],
  },
  {
    id: 'curated-head-start',
    title: 'Head Start Program',
    agency: 'U.S. Department of Health and Human Services',
    agency_code: 'HHS',
    link: 'https://www.acf.hhs.gov/ohs',
    description: 'Free early childhood education, health, nutrition, and family support services for low-income children under age 5. Find a local Head Start center through the program locator.',
    cfda_list: ['93.600'],
  },
]

// ─── Data helpers ─────────────────────────────────────────────────────────────

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
function mergeTiers(limit, ...tiers) {
  const seen = new Set()
  const out  = []
  for (const tier of tiers) {
    for (const g of tier) {
      if (!seen.has(g.id)) { seen.add(g.id); out.push(g) }
    }
  }
  return out.slice(0, limit)
}

// Parses MM/DD/YYYY or ISO date strings from grant data. Returns ms timestamp or null.
function parseGrantDate(dateStr) {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`)
    return isNaN(d.getTime()) ? null : d.getTime()
  }
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d.getTime()
}

// 4-tier matching function. Returns { eligible, score, reasons } or { eligible: false }.
// Tier 1 — eligibility gate (hard exclusion)
// Tier 2 — profile attribute match (0–15 pts)
// Tier 3 — relevance/interest alignment (0–10 pts)
// Tier 4 — opportunity quality (0–5 pts)
function matchGrant(grant, profile, resolvedState) {
  const text    = ((grant.title || '') + ' ' + (grant.agency || '') + ' ' + (grant.description || '')).toLowerCase()
  const cfdaStr = (grant.cfda_list || []).join(',')
  const lowIncome = profile.income_range === 'Under $25,000' || profile.income_range === '$25,000–$50,000'

  // ── Tier 1: Eligibility ────────────────────────────────────────────────────
  // Each check asks: does this grant REQUIRE an attribute the user doesn't have?
  // Default is eligible=true — only exclude on clear, specific signals.

  // Veteran-only: VA agency or CFDA 64.* (all VA benefit programs)
  if (!profile.is_veteran && (/\b64\./.test(cfdaStr) || grant.agency_code === 'VA')) {
    return { eligible: false }
  }

  // Student/scholarship-only: grants specifically for enrolled students
  if (!profile.is_student && (
    /\bscholarship\b|\bfellowship\b|\bstudent (loan|aid|grant)\b/.test(text) ||
    /^(84\.007|84\.033|84\.063|84\.268|84\.379|84\.406|94\.006|94\.026)/.test(cfdaStr)
  )) {
    return { eligible: false }
  }

  // Homeowner-only: grants requiring property ownership to apply
  if (!profile.is_homeowner && (
    /\bhomeowner\b|\bhome (repair|rehabilitation|modification)\b|\bmortgage assistance\b/.test(text) ||
    /\b10\.41[0-9]/.test(cfdaStr)  // USDA single-family housing programs
  )) {
    return { eligible: false }
  }

  // Low-income-only: need-tested programs for users who reported higher income
  // Only exclude when income is explicitly above the threshold (not if unset or "Prefer not to say")
  if (['$75,000–$100,000', 'Over $100,000'].includes(profile.income_range) && (
    /\bliheap\b|\bsnap\b|\bwic\b|\btanf\b|\bfood stamps\b/.test(text) ||
    /93\.568|81\.042|10\.551|10\.561/.test(cfdaStr)
  )) {
    return { eligible: false }
  }

  // Small-business-only: SBA and SBIR/STTR programs require a business entity
  if (profile.entity_type === 'individual' && (
    /\b59\./.test(cfdaStr) ||
    (grant.agency_code === 'SBA' && /\bsbir\b|\bsttr\b/.test(text))
  )) {
    return { eligible: false }
  }

  // Nonprofit-only: grants explicitly restricted to 501(c) organizations
  if (profile.entity_type === 'individual' &&
    /nonprofit(s)? only|for nonprofits|501\(c\)(3)? organization/.test(text) &&
    !/and individuals/.test(text)
  ) {
    return { eligible: false }
  }

  // State-specific scraped grants are for that state's residents only
  if (resolvedState && grant.source && !['grants.gov', 'curated', 'careeronestop'].includes(grant.source)) {
    if (grant.source !== STATE_SOURCES[resolvedState]) return { eligible: false }
  }

  // ── Tier 2: Profile Match (0–15) ──────────────────────────────────────────
  let t2 = 0
  const reasons = []

  if (resolvedState && STATE_SOURCES[resolvedState] && grant.source === STATE_SOURCES[resolvedState]) {
    t2 += 3; reasons.push('State program')
  }
  if (profile.is_veteran) {
    const hit  = /veteran|military|armed forces|service member|gi bill|\bvets\b|caregiver|vocational rehabilitation/.test(text)
    const cfda = /\b64\./.test(cfdaStr)
    if (hit || cfda) { t2 += 3; reasons.push('Veteran match') }
  }
  if (profile.is_student) {
    const hit  = /student|scholarship|fellowship|financial aid|tuition|education|college|university|academic|teach grant|americorps/.test(text)
    const cfda = /\b84\.|94\.006|94\.026/.test(cfdaStr)
    if (hit || cfda) { t2 += 3; reasons.push('Education match') }
  }
  if (lowIncome) {
    const hit  = /housing assistance|rental assistance|utility|energy assistance|liheap|weatherization|low.?income|emergency assistance|snap|food assistance|nutrition assistance|childcare|child care|medicaid|tanf|\bwic\b|poverty|cash assistance|head start|section 8|housing voucher/.test(text)
    const cfda = /93\.568|81\.042|93\.775|93\.778|10\.551|10\.557|10\.561|93\.575|93\.596|14\.871|14\.218|14\.239|93\.600/.test(cfdaStr)
    if (hit || cfda) { t2 += 3; reasons.push('Income-based assistance') }
  }
  if (profile.is_homeowner) {
    const hit  = /homeowner|home repair|weatherization|rehabilitation|residential|housing|mortgage|property/.test(text)
    const cfda = /\b14\.|\b10\.41[0-9]/.test(cfdaStr)
    if (hit || cfda) { t2 += 2; reasons.push('Homeowner match') }
  }
  if (profile.entity_type === 'nonprofit' && /nonprofit|non-profit|community organization|charity|501|capacity building/.test(text)) {
    t2 += 1; reasons.push('Nonprofit match')
  }
  if (profile.entity_type === 'small_business' && /small business|entrepreneur|startup|business development|\bsba\b|sbir|sttr/.test(text)) {
    t2 += 1; reasons.push('Small business match')
  }
  if (profile.entity_type === 'individual' && /individual|personal|citizen|family|household/.test(text)) {
    t2 += 1
  }

  // ── Tier 3: Relevance (0–10) ──────────────────────────────────────────────
  let t3 = 0

  // Primary interest: user's strongest need aligns with this grant category
  let primaryMatch = false
  if (profile.is_veteran && (/veteran|military|gi bill|service member|caregiver/.test(text) || /\b64\./.test(cfdaStr))) {
    t3 += 4; primaryMatch = true
  } else if (profile.is_student && (/scholarship|fellowship|tuition|financial aid|college|teach grant|americorps/.test(text) || /\b84\.|94\./.test(cfdaStr))) {
    t3 += 4; primaryMatch = true
  } else if (lowIncome && (/liheap|weatherization|energy assistance|snap|food assistance|rental assistance|housing assistance|medicaid|\bwic\b|head start|section 8|housing voucher/.test(text) || /93\.568|81\.042|10\.551|10\.557|14\.871|93\.600/.test(cfdaStr))) {
    t3 += 4; primaryMatch = true
  } else if (profile.is_homeowner && (/home repair|weatherization|section 504|housing rehab/.test(text) || /10\.417|14\.39[0-9]/.test(cfdaStr))) {
    t3 += 4; primaryMatch = true
  } else if (profile.entity_type === 'small_business' && /sbir|sttr|small business innovation|business development/.test(text)) {
    t3 += 4; primaryMatch = true
  }

  // Occupation: grant serves people in the user's field
  if (profile.occupation) {
    const occ = profile.occupation.toLowerCase()
    for (const boost of OCCUPATION_BOOSTS) {
      if (boost.keywords.test(occ) && (boost.grant.test(text) || boost.cfda.test(cfdaStr))) {
        t3 += 3; reasons.push(boost.label); break
      }
    }
  }

  // Age range: grant targets user's life stage
  if (profile.age_range === '65+' && /senior|elderly|aging|older adult|retirement|medicare|social security|section 504/.test(text)) {
    t3 += 2; reasons.push('Senior program')
  } else if ((profile.age_range === '18–24' || profile.age_range === 'Under 18') && /youth|young adult|job corps|first generation|early career/.test(text)) {
    t3 += 2; reasons.push('Youth program')
  }

  // General category fit
  if (/workforce|job training|apprenticeship|vocational|career development|job corps|wioa/.test(text) || /\b17\./.test(cfdaStr)) {
    t3 += 1
    if (!primaryMatch) reasons.push('Workforce/training program')
  }

  // ── Tier 4: Opportunity Quality (0–5) ─────────────────────────────────────
  let t4 = 0

  if (grant.status === 'posted' || grant.status === 'active') t4 += 1

  if (grant.close_date) {
    const closeMs = parseGrantDate(grant.close_date)
    if (closeMs) {
      const daysLeft = Math.round((closeMs - Date.now()) / 86_400_000)
      if (daysLeft >= 14 && daysLeft <= 90)  t4 += 2
      else if (daysLeft > 90 && daysLeft <= 180) t4 += 1
    }
  }

  if (grant.source === 'curated')                           t4 += 1
  if (grant.description && grant.description.length > 20)  t4 += 1

  return { eligible: true, score: t2 + t3 + t4, reasons }
}

// Returns grants.gov keyword search terms derived from the profile.
// All terms are searched in parallel — a veteran+student fires two simultaneous searches.
function buildProfileSearchTerms(profile) {
  if (!profile) return []
  const terms = []
  const lowIncome = profile.income_range === 'Under $25,000' || profile.income_range === '$25,000–$50,000'
  if (profile.is_student)   { terms.push('scholarship fellowship student'); terms.push('education training youth') }
  if (profile.is_veteran)                                        terms.push('veteran military service')
  if (profile.is_homeowner)                                      terms.push('home repair rehabilitation housing assistance')
  if (lowIncome)            { terms.push('housing assistance rental utility LIHEAP'); terms.push('food assistance childcare workforce') }
  if (profile.entity_type === 'small_business')                  terms.push('small business entrepreneur workforce')
  if (profile.entity_type === 'nonprofit')                       terms.push('nonprofit community development capacity')
  if (profile.age_range === '65+')                               terms.push('senior elderly aging older adult')
  if (profile.age_range === '18–24' || profile.age_range === 'Under 18') terms.push('youth young adult job corps early career')
  if (profile.occupation) {
    const occ = profile.occupation.toLowerCase()
    for (const { keywords, term } of OCCUPATION_SEARCH_TERMS) {
      if (keywords.test(occ)) { terms.push(term); break }
    }
  }
  if (!terms.length)                                             terms.push('workforce training employment')
  return terms
}

// Shared grants.gov live search helper used by both route paths.
async function fetchGov(keyword, rows = 25) {
  const response = await fetch('https://api.grants.gov/v1/api/search2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, rows, oppStatuses: 'posted', sortBy: 'openDate|desc' }),
  })
  const { data } = await response.json()
  return data.oppHits.map(normalizeGrant)
}

// Fetches scholarships and training programs from CareerOneStop (DOL).
// Returns [] silently if API credentials are not configured.
// Results are displayed but not persisted — ToS requires attribution on every page showing COS data.
async function fetchCareerOneStop(profile, zip) {
  const userId = process.env.CAREERONESTOP_USER_ID
  const token  = process.env.CAREERONESTOP_TOKEN
  if (!userId || !token) return []
  if (!zip) return []  // location is required in path — skip when no zip provided

  const location = encodeURIComponent(zip)
  const radius   = '50'
  const headers  = { Authorization: `Bearer ${token}` }
  const results  = []

  try {
    if (profile.is_student) {
      const keyword = encodeURIComponent(profile.is_veteran ? 'veteran scholarship' : 'scholarship')
      const url = `https://api.careeronestop.org/v1/scholarshipfinder/${userId}/${keyword}/${location}/${radius}/score/0/0/0/10`
      const r = await fetch(url, { headers })
      if (r.ok) {
        const data = await r.json()
        for (const s of data?.ScholarshipList ?? []) {
          results.push({
            id:          `cos-scholarship-${s.ScholarshipId ?? results.length}`,
            title:       s.ScholarshipName   || 'Scholarship Program',
            agency:      s.SponsorName       || 'CareerOneStop',
            agency_code: 'COS',
            status:      'posted',
            open_date:   null,
            close_date:  s.Deadline          || null,
            doc_type:    null,
            cfda_list:   [],
            link:        s.Website           || 'https://www.careeronestop.org/toolkit/training/find-scholarships.aspx',
            description: s.Description       || null,
            source:      'careeronestop',
          })
        }
      }
    }

    // Training programs — useful for workforce, small business, and veteran profiles
    if (profile.is_veteran || profile.entity_type === 'small_business' || !profile.is_student) {
      const lowIncomeCOS = profile.income_range === 'Under $25,000' || profile.income_range === '$25,000–$50,000'
      const kw = profile.entity_type === 'small_business' ? 'business development training'
               : profile.is_homeowner ? 'home repair weatherization energy efficiency'
               : lowIncomeCOS ? 'job training employment assistance workforce'
               : 'workforce job training'
      const keyword = encodeURIComponent(kw)
      const url = `https://api.careeronestop.org/v1/trainingprogramfinder/${userId}/${keyword}/${location}/${radius}/score/0/0/0/10`
      const r = await fetch(url, { headers })
      if (r.ok) {
        const data = await r.json()
        for (const p of data?.Programs ?? []) {
          results.push({
            id:          `cos-training-${p.ProgramID ?? results.length}`,
            title:       p.ProgramName   || p.ProgramTitle || 'Training Program',
            agency:      p.SchoolName    || p.ProviderName || 'CareerOneStop',
            agency_code: 'COS',
            status:      'posted',
            open_date:   null,
            close_date:  null,
            doc_type:    null,
            cfda_list:   [],
            link:        p.Website || p.URL || 'https://www.careeronestop.org/toolkit/training/find-training.aspx',
            description: p.Description  || null,
            source:      'careeronestop',
          })
        }
      }
    }
  } catch (err) {
    console.warn('[CareerOneStop] Fetch failed:', err.message)
  }

  console.log(`[CareerOneStop] Returning ${results.length} results for zip=${zip}`)
  return results
}

// ─── Database setup ────────────────────────────────────────────────────────────

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      source TEXT, number TEXT, title TEXT, agency TEXT, agency_code TEXT,
      status TEXT, open_date TEXT, close_date TEXT, doc_type TEXT,
      cfda_list TEXT[], link TEXT, synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS description TEXT`)
}

async function ensureUsers() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT,
      state        TEXT,
      zip          TEXT,
      age_range    TEXT,
      income_range TEXT,
      occupation   TEXT,
      entity_type  TEXT,
      is_student   BOOLEAN DEFAULT FALSE,
      is_veteran   BOOLEAN DEFAULT FALSE,
      is_homeowner BOOLEAN DEFAULT FALSE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS income_range TEXT`)
}

// Seeds curated individual-facing programs. Safe to run on every boot.
async function ensureCurated() {
  for (const p of CURATED_PROGRAMS) {
    await pool.query(`
      INSERT INTO opportunities (id, source, title, agency, agency_code, status, link, description, cfda_list, open_date, close_date)
      VALUES ($1, 'curated', $2, $3, $4, 'posted', $5, $6, $7, NULL, NULL)
      ON CONFLICT (id) DO NOTHING
    `, [p.id, p.title, p.agency, p.agency_code, p.link, p.description, p.cfda_list])
  }
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
app.use(express.json())
app.use('/api/grants',  rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }))
app.use('/api/profile', rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }))

// ─── GET /api/grants ──────────────────────────────────────────────────────────
//
// Query params:
//   zip        — 5-digit US zip code (optional)
//   entityType — 'any' | 'individual' | 'small_business' | 'nonprofit'  (default: 'any')
//   profileId  — UUID of a saved user profile (optional)
//   limit      — max results, 1–100 (default: 25)
//
// When profileId is provided each grant gets relevance_score + match_reasons[].
//
app.get('/api/grants', async (req, res) => {
  const { zip, entityType = 'any', profileId } = req.query
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)

  if (!ELIGIBILITY[entityType]) {
    return res.status(400).json({ error: 'Invalid entityType' })
  }

  let profile = null
  if (profileId && /^[0-9a-f-]{36}$/.test(profileId)) {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [profileId])
      if (r.rows.length > 0) profile = r.rows[0]
    } catch { /* continue without scoring */ }
  }

  let state = null
  let city  = null

  function withScoring(grants, syncedAt) {
    if (!profile) return { state, grants: grants.slice(0, limit), syncedAt, relevantCount: null }
    const scored = grants
      .map(g => {
        const result = matchGrant(g, profile, state)
        if (!result.eligible) return null
        return { ...g, relevance_score: result.score, match_reasons: result.reasons }
      })
      .filter(Boolean)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit)
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

  // ── Live path: eligibility filter (only when browsing without a profile) ──
  // When a profile is active, always use the DB-first path so curated programs,
  // CareerOneStop, and profile keyword searches are included. The entity type
  // preference is already captured in the profile and handled by scoreGrant().
  if (entityType !== 'any' && !profile) {
    try {
      const stateName = state ? STATE_NAMES[state] : null
      const baseBody  = { rows: limit, eligibilities: ELIGIBILITY[entityType], oppStatuses: 'posted', sortBy: 'openDate|desc' }
      const fetchElig = (keyword) =>
        fetch('https://api.grants.gov/v1/api/search2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...baseBody, keyword }),
        }).then(r => r.json()).then(({ data }) => data.oppHits.map(normalizeGrant))

      let grants
      if (stateName) {
        const [cityGrants, stateGrants, generalGrants] = await Promise.all([
          city ? fetchElig(city) : Promise.resolve([]),
          fetchElig(stateName),
          fetchElig(''),
        ])
        grants = mergeTiers(limit, cityGrants, stateGrants, generalGrants)
      } else {
        grants = await fetchElig('')
      }

      return res.json(withScoring(grants, null))
    } catch {
      return res.status(500).json({ error: 'Failed to fetch grants' })
    }
  }

  // ── DB-first path: entityType = any ───────────────────────────────────────
  try {
    const syncResult   = await pool.query(`SELECT MAX(synced_at) AS last_sync FROM opportunities WHERE source != 'curated'`)
    const profileTerms = buildProfileSearchTerms(profile)

    if (state) {
      const stateName   = STATE_NAMES[state]
      const stateSource = STATE_SOURCES[state]

      // All tasks run in parallel.
      // Tier order: stateDB → curated → CareerOneStop → profileKeywords → city → state
      const tasks = [
        stateSource
          ? pool.query(
              `SELECT * FROM opportunities WHERE status IN ('posted','active') AND source = $1 ORDER BY synced_at DESC LIMIT $2`,
              [stateSource, Math.min(limit * POOL_FACTOR, MAX_POOL)]
            )
          : Promise.resolve({ rows: [] }),
        profile
          ? pool.query(`SELECT * FROM opportunities WHERE source = 'curated' AND status = 'posted'`)
          : Promise.resolve({ rows: [] }),
        profile ? fetchCareerOneStop(profile, zip) : Promise.resolve([]),
        ...profileTerms.map(term => fetchGov(term, 15).catch(() => [])),
        city ? fetchGov(city, 25).catch(() => []) : Promise.resolve([]),
        fetchGov(stateName, 50).catch(() => []),
      ]

      const [dbResult, curatedResult, cosGrants, ...liveResults] = await Promise.all(tasks)
      const profileGrants = liveResults.slice(0, profileTerms.length).flat()
      const cityGrants    = liveResults[profileTerms.length]     ?? []
      const stateGrants   = liveResults[profileTerms.length + 1] ?? []

      return res.json(withScoring(
        mergeTiers(Math.min(limit * POOL_FACTOR, MAX_POOL), dbResult.rows, curatedResult.rows, cosGrants, profileGrants, cityGrants, stateGrants),
        syncResult.rows[0].last_sync
      ))
    }

    // No zip — curated + CareerOneStop + profile keywords + DB cache
    const tasks = [
      pool.query(
        `SELECT * FROM opportunities WHERE status IN ('posted','active') AND source != 'curated' ORDER BY synced_at DESC LIMIT $1`,
        [Math.min(limit * POOL_FACTOR, MAX_POOL)]
      ),
      profile
        ? pool.query(`SELECT * FROM opportunities WHERE source = 'curated' AND status = 'posted'`)
        : Promise.resolve({ rows: [] }),
      profile ? fetchCareerOneStop(profile, zip) : Promise.resolve([]),
      ...profileTerms.map(term => fetchGov(term, 15).catch(() => [])),
    ]

    const [grantsResult, curatedResult, cosGrants, ...profileGrantArrays] = await Promise.all(tasks)
    const profileGrants = profileGrantArrays.flat()

    res.json(withScoring(
      mergeTiers(Math.min(limit * POOL_FACTOR, MAX_POOL), curatedResult.rows, cosGrants, profileGrants, grantsResult.rows),
      syncResult.rows[0].last_sync
    ))
  } catch (err) {
    console.error('[grants]', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})

// ─── POST /api/profile ────────────────────────────────────────────────────────

app.post('/api/profile', async (req, res) => {
  const {
    name, state, zip, age_range, income_range, occupation, entity_type,
    is_student = false, is_veteran = false, is_homeowner = false,
  } = req.body

  if (entity_type && !ELIGIBILITY[entity_type]) {
    return res.status(400).json({ error: 'Invalid entity_type' })
  }

  try {
    const result = await pool.query(`
      INSERT INTO users (name, state, zip, age_range, income_range, occupation, entity_type, is_student, is_veteran, is_homeowner)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      name         || null,
      state        || null,
      zip          || null,
      age_range    || null,
      income_range || null,
      occupation   || null,
      entity_type  || null,
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

app.get('/api/profile/:id', async (req, res) => {
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

Promise.all([ensureSchema(), ensureUsers()]).then(async () => {
  await ensureCurated()

  syncGrants()
  cron.schedule('0 * * * *', syncGrants)

  if (!process.env.PLAYWRIGHT_SKIP) {
    cron.schedule('0 2 * * 0', () => scrapeCalifornia(pool))
  }
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
