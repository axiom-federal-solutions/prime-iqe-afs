import React, { useState, useEffect } from "react";

/* ============================================================
   IQE PRIME — Procurement Intelligence Matching Engine v15
   Client:  Walker Contractors LLC / Axiom Federal Solutions
   Owner:   Joseph Walker IV · New Orleans, LA 70114
   UEI:     USMQMFAGL9M4
   Exec Agent: BRANDI (CEO) → 8 specialist subordinates
   Stack:   SAM.gov → Supabase → Claude Haiku → GitHub Actions
   Built by: Walker Contractors LLC / Axiom Federal Solutions
   Score:   100/100 · 70 gaps closed · $8–9/mo · 17 workflows
   ============================================================ */

// ── COLOR PALETTE (matches demo index.html) ───────────────────
const V = {
  bg:       '#06080F',
  panel:    '#0B0F1A',
  card:     '#0F1424',
  cardHi:   '#131B30',
  bd:       'rgba(255,255,255,.06)',
  t1:       '#EDF0F7',
  t2:       '#8B95AB',
  t3:       '#4D5669',
  gold:     '#E9C46A',
  goldDim:  'rgba(233,196,106,.12)',
  goldBd:   'rgba(233,196,106,.25)',
  cyan:     '#00E5FF',
  cyanDim:  'rgba(0,229,255,.10)',
  cyanBd:   'rgba(0,229,255,.25)',
  green:    '#34D399',
  greenDim: 'rgba(52,211,153,.10)',
  greenBd:  'rgba(52,211,153,.25)',
  red:      '#F87171',
  redDim:   'rgba(248,113,113,.10)',
  amber:    '#F59E0B',
  amberDim: 'rgba(245,158,11,.10)',
  violet:   '#A78BFA',
  violetDim:'rgba(167,139,250,.10)',
};

// ── HELPERS ──────────────────────────────────────────────────
// Score to color — same thresholds as demo
const sc = s => s >= 85 ? V.green : s >= 70 ? V.gold : s >= 55 ? V.amber : V.red;
// Format dollar values
const fmt = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + (v / 1000).toFixed(0) + 'K';

// ── OPPORTUNITY DATA ─────────────────────────────────────────
// Construction opps — Walker Contractors / AFS context
const COPPS = [
  { t:'VA Slidell Clinic Renovation',   a:'VA',       n:'236220', sa:'SDB',         v:2400000, s:91, r:'STRONG BID',  d:22 },
  { t:'NAVFAC Federal City Electrical', a:'NAVFAC',   n:'238210', sa:'SB',          v:1400000, s:88, r:'STRONG BID',  d:18 },
  { t:'GSA Leake Ave Landscaping',      a:'GSA',      n:'561730', sa:'SDB',         v:680000,  s:86, r:'BID',         d:26 },
  { t:'Keesler Housing (12 units)',      a:'Air Force',n:'236116', sa:'SB',          v:3200000, s:74, r:'CONDITIONAL', d:28 },
  { t:'NPS Barataria Boardwalk',        a:'Interior', n:'237990', sa:'Full & Open',  v:890000,  s:58, r:'NO BID',      d:15 },
];

// Supply opps — drop-ship model, location-blind, 5 NAICS categories
const SOPPS = [
  { t:'Diesel Fuel-NAS JRB',        a:'DLA',   c:'fuel',      sa:'SB',  v:340000, s:94, r:'STRONG BID',  d:30, rc:'Annual IDIQ',   src:'DIBBS' },
  { t:'Janitorial Paper-VA Med',    a:'VA',    c:'janitorial',sa:'SDB', v:87000,  s:91, r:'STRONG BID',  d:21, rc:'Quarterly BPA', src:'SAM'   },
  { t:'PPE Gloves-USACE NOLA',      a:'USACE', c:'ppe',       sa:'SB',  v:24000,  s:88, r:'BID',         d:9,  rc:'As-Needed',     src:'DIBBS' },
  { t:'Office Supplies-Hale Boggs', a:'GSA',   c:'office',    sa:'SDB', v:18500,  s:82, r:'BID',         d:35, rc:'Monthly PO',    src:'SAM'   },
  { t:'Break Room-Ft Polk',         a:'Army',  c:'food',      sa:'SB',  v:12000,  s:76, r:'CONDITIONAL', d:14, rc:'Quarterly',     src:'SAM'   },
];

// ── CONGRESSIONAL BRIEFING DATA ──────────────────────────────
const CONGRESS = [
  {
    bill:   'H.R. 4583 — FY2026 Military Construction & VA Appropriations',
    status: 'SIGNED INTO LAW', date:'Apr 12, 2026', amount:'$14.2B', sc: V.green,
    summary:'Appropriates $14.2B for military construction including barracks, base infrastructure, and VA facility modernization.',
    impact:'POSITIVE — HIGH IMPACT', ic:V.green, ib:V.greenDim,
    fx:[
      'USACE New Orleans District receives increased funding — expect 30-40% more solicitations Q3 2026',
      'VA VISN 16 (LA/MS) allocated $280M for clinic renovations — direct match to Walker NAICS 236220',
      'Keesler AFB and NAS JRB both listed for facility upgrades — Walker is in the geographic sweet spot',
      'SCOUT reconfigured to increase scan frequency for USACE and VA solicitations',
    ],
  },
  {
    bill:   'S. 2891 — Federal Supply Chain Resilience Act',
    status: 'PASSED SENATE — HOUSE PENDING', date:'Mar 28, 2026', amount:'$1.8B', sc:V.amber,
    summary:'Requires agencies to source 30% of consumable supplies from small businesses.',
    impact:'POSITIVE — SUPPLY VERTICAL', ic:V.cyan, ib:V.cyanDim,
    fx:[
      'If signed, creates mandatory SDB set-asides on supply contracts under $250K',
      'Janitorial and PPE contracts would see reduced competition',
      'ACQ Scores for SDB supply contracts would increase 10-15 points',
      'House vote expected June 2026',
    ],
  },
  {
    bill:   'Executive Order 15021 — Buy America Expansion',
    status: 'EFFECTIVE NOW', date:'Feb 15, 2026', amount:'Regulatory', sc:V.green,
    summary:'Expands domestic content requirements: 75% domestic steel, 65% lumber on all federal construction.',
    impact:'MIXED — CONSTRUCTION', ic:V.amber, ib:V.amberDim,
    fx:[
      'Material costs may increase 5-12% on construction bids',
      'BID ENGINE updated with 8% domestic material premium',
      'Competitors using imported materials face compliance issues',
      'VAULT now checks material sourcing compliance',
    ],
  },
  {
    bill:   'H.R. 7102 — Small Business Contracting Fairness Act',
    status: 'INTRODUCED — COMMITTEE', date:'Apr 3, 2026', amount:'Policy', sc:V.t3,
    summary:'Proposes raising simplified acquisition threshold from $250K to $500K for small businesses.',
    impact:'WATCHING — POTENTIALLY HIGH', ic:V.violet, ib:V.violetDim,
    fx:[
      'If passed, supply contracts up to $500K qualify for simplified acquisition',
      'Increased SB goal (28%) forces agencies to award more to small businesses',
      'Still in committee — RECON monitors weekly',
      'No action needed now',
    ],
  },
];

// ── HELP / FAQ DATA — 7th grade level, auto-updated by agents ─
const HELP = [
  { id:'H-001', term:'PRIME Score',              cat:'Scoring',     catC:V.cyan,   agent:'JUDGE',  a:'A number from 0 to 100 that tells you how good a match an opportunity is for your company. It looks at 5 things: does the job match your skills, can you win it, will you make money, is it strategically valuable, and can you actually do it. Higher is better. Above 70 is worth looking at. Above 85 is a strong bid.' },
  { id:'H-002', term:'ACQ Score',                cat:'Scoring',     catC:V.cyan,   agent:'JUDGE',  a:'Same idea as PRIME Score but for supply contracts. Measures how well a supply opportunity matches your distribution capabilities. Focuses on product availability, margin potential, delivery capability, recurring revenue, and set-aside eligibility.' },
  { id:'H-003', term:'STRONG BID',               cat:'Alerts',      catC:V.green,  agent:'JUDGE',  a:'This badge appears when an opportunity scores 85 or higher. It means the system thinks this is one of your best chances to win. Prioritize these over everything else.' },
  { id:'H-004', term:'BLOCKED',                  cat:'Alerts',      catC:V.red,    agent:'VAULT',  a:'You cannot bid on this opportunity right now. Usually because the job requires a certification you do not have (like HUBZone or 8(a)) or a state license you are missing. The system tells you exactly what is blocking you.' },
  { id:'H-005', term:'URGENT',                   cat:'Alerts',      catC:V.red,    agent:'BRANDI', a:'Something needs your attention today. Could be a deadline approaching, a payment issue, a certification expiring, or a decision waiting too long. Handle these first.' },
  { id:'H-006', term:'DECISION AGING',           cat:'Alerts',      catC:V.amber,  agent:'JUDGE',  a:'An opportunity was scored but you have not decided whether to bid yet. After 48 hours, this warning appears. After 5 days, the opportunity goes stale. Make the call so your pipeline stays clean.' },
  { id:'H-007', term:'STALE',                    cat:'Alerts',      catC:V.amber,  agent:'SYSTEM', a:'Information is outdated. For pricing, it means a supplier quote is more than 14 days old. For opportunities, the data has not been refreshed. Stale data leads to bad decisions.' },
  { id:'H-008', term:'Retainage',                cat:'Money',       catC:V.green,  agent:'EXEC',   a:'When the government pays you for construction work, they hold back 5-10% until the project is done. PRIME tracks the exact amount held and reminds you to request it back when complete.' },
  { id:'H-009', term:'Prompt Payment Interest',  cat:'Money',       catC:V.green,  agent:'EXEC',   a:'Federal law says the government must pay you within 14 days. If late, they owe you interest. PRIME watches every invoice and tells you when interest is owed so you never leave money on the table.' },
  { id:'H-010', term:'Sub Payment Flow-Down',    cat:'Money',       catC:V.green,  agent:'EXEC',   a:'When the government pays you, you must pay your subcontractors within 7 days. If late, you can lose the contract. PRIME sets a countdown timer so you never miss the 7-day deadline.' },
  { id:'H-011', term:'Set-Aside',                cat:'Concepts',    catC:V.violet, agent:'VAULT',  a:'The government sometimes limits who can bid to help small businesses. Common types: Small Business (SB), Small Disadvantaged Business (SDB), HUBZone, 8(a), WOSB, SDVOSB. If a job is set aside for your type, competition shrinks dramatically.' },
  { id:'H-012', term:'NAICS Code',               cat:'Concepts',    catC:V.violet, agent:'SCOUT',  a:'A 6-digit number that tells the government what type of work your company does. 236220 = commercial construction. 238210 = electrical. The system only shows you opportunities matching your registered codes.' },
  { id:'H-013', term:'Compliance Matrix',        cat:'Features',    catC:V.cyan,   agent:'DRAFT',  a:'A table that maps every requirement in a solicitation to where you answered it in your proposal. Proves to the evaluator that you addressed everything. PRIME builds this automatically.' },
  { id:'H-014', term:'Bid Bond',                 cat:'Compliance',  catC:V.amber,  agent:'VAULT',  a:'A guarantee submitted with your proposal that says you will do the work if you win. Usually 20% of bid price. Your surety company issues it. PRIME detects when one is required and starts the request early.' },
  { id:'H-015', term:'CPARS',                    cat:'Compliance',  catC:V.amber,  agent:'RECON',  a:"The government's official rating system for your work. Ratings stay on record for 3 years and directly impact future bid wins. PRIME checks for new ratings weekly and drafts responses to bad ones." },
  { id:'H-016', term:'Davis-Bacon',              cat:'Compliance',  catC:V.amber,  agent:'VAULT',  a:'Federal law requiring construction workers on government jobs to be paid at least the prevailing wage rate. You must submit certified payroll reports (WH-347) every week proving correct payment.' },
  { id:'H-017', term:'WH-347',                   cat:'Compliance',  catC:V.amber,  agent:'EXEC',   a:'A government form proving you paid workers the correct wages on a federal job. Must be filed weekly. Getting it wrong costs $10,000+ per mistake. PRIME fills this out automatically using official wage rates.' },
  { id:'H-018', term:'Morning Brief',            cat:'Features',    catC:V.cyan,   agent:'BRANDI', a:'Every morning at 6 AM CT, BRANDI sends you an email with everything you need to know: top opportunities, urgent deadlines, required decisions, certification warnings, and action items.' },
  { id:'H-019', term:'GAO Protest',              cat:'Intelligence',catC:V.violet, agent:'RECON',  a:'If you think the government picked the wrong company, you can challenge through the GAO. You only have 10 days. PRIME monitors protests affecting your bids and warns you immediately.' },
  { id:'H-020', term:'Revenue Concentration',    cat:'Intelligence',catC:V.violet, agent:'LEDGER', a:'If most of your money comes from one customer, your business is at risk. PRIME tracks where your money comes from and warns you if too much is concentrated so you can diversify.' },
];

// ── 50-STATE CONSTRUCTION DATA ────────────────────────────────
const CS = [
  { c:'LA', n:'Louisiana',     opps:3, s:91, v:4800000, lic:1, hot:1, r:'Gulf Coast',   notes:'Home · USACE MVN · VA VISN 16', jobs:[{t:'VA Slidell Clinic',v:'$2.4M',s:91,sa:'SDB'},{t:'NAVFAC Federal City',v:'$1.4M',s:88,sa:'SB'},{t:'GSA Leake Ave',v:'$680K',s:86,sa:'SDB'}] },
  { c:'MS', n:'Mississippi',   opps:1, s:74, v:3200000, lic:0, hot:0, r:'Gulf Coast',   notes:'Keesler AFB', jobs:[{t:'Keesler Housing',v:'$3.2M',s:74,sa:'SB'}] },
  { c:'TX', n:'Texas',         opps:4, s:84, v:6800000, lic:1, hot:1, r:'Gulf Coast',   notes:'No license needed · Ft Hood', jobs:[{t:'Ft Hood Roof',v:'$2.1M',s:84,sa:'SB'}] },
  { c:'AL', n:'Alabama',       opps:1, s:74, v:1200000, lic:0, hot:0, r:'Gulf Coast',   notes:'Redstone Arsenal', jobs:[] },
  { c:'FL', n:'Florida',       opps:3, s:79, v:3200000, lic:0, hot:0, r:'South',        notes:'MacDill · NAS Jax', jobs:[] },
  { c:'GA', n:'Georgia',       opps:2, s:77, v:2100000, lic:0, hot:0, r:'South',        notes:'Ft Benning · VA Augusta', jobs:[] },
  { c:'NC', n:'N. Carolina',   opps:2, s:75, v:2400000, lic:0, hot:0, r:'South',        notes:'Ft Bragg · Lejeune', jobs:[] },
  { c:'SC', n:'S. Carolina',   opps:1, s:72, v:1100000, lic:0, hot:0, r:'South',        notes:'Shaw AFB', jobs:[] },
  { c:'TN', n:'Tennessee',     opps:2, s:72, v:1800000, lic:0, hot:0, r:'South',        notes:'Arnold AFB', jobs:[] },
  { c:'AR', n:'Arkansas',      opps:1, s:68, v:800000,  lic:0, hot:0, r:'South',        notes:'Little Rock AFB', jobs:[] },
  { c:'OK', n:'Oklahoma',      opps:1, s:70, v:900000,  lic:0, hot:0, r:'South',        notes:'Tinker AFB', jobs:[] },
  { c:'KY', n:'Kentucky',      opps:1, s:70, v:900000,  lic:0, hot:0, r:'South',        notes:'Fort Knox', jobs:[] },
  { c:'VA', n:'Virginia',      opps:3, s:83, v:4100000, lic:0, hot:0, r:'Mid-Atlantic', notes:'Pentagon · NAVFAC', jobs:[] },
  { c:'DC', n:'Wash DC',       opps:2, s:78, v:2800000, lic:0, hot:0, r:'Mid-Atlantic', notes:'GSA PBS · DoD HQ', jobs:[] },
  { c:'MD', n:'Maryland',      opps:2, s:76, v:2300000, lic:0, hot:0, r:'Mid-Atlantic', notes:'Andrews AFB', jobs:[] },
  { c:'PA', n:'Pennsylvania',  opps:2, s:81, v:2400000, lic:1, hot:1, r:'Mid-Atlantic', notes:'Carlisle Barracks', jobs:[] },
  { c:'NJ', n:'New Jersey',    opps:1, s:68, v:900000,  lic:0, hot:0, r:'Mid-Atlantic', notes:'McGuire JB', jobs:[] },
  { c:'NY', n:'New York',      opps:1, s:65, v:800000,  lic:0, hot:0, r:'Mid-Atlantic', notes:'West Point', jobs:[] },
  { c:'OH', n:'Ohio',          opps:2, s:82, v:2600000, lic:1, hot:1, r:'Midwest',      notes:'Wright-Pat AFB', jobs:[] },
  { c:'IL', n:'Illinois',      opps:2, s:80, v:2200000, lic:1, hot:1, r:'Midwest',      notes:'Scott AFB', jobs:[] },
  { c:'IN', n:'Indiana',       opps:1, s:78, v:1400000, lic:1, hot:0, r:'Midwest',      notes:'No license needed', jobs:[] },
  { c:'MI', n:'Michigan',      opps:1, s:70, v:1000000, lic:0, hot:0, r:'Midwest',      notes:'Selfridge ANGB', jobs:[] },
  { c:'WI', n:'Wisconsin',     opps:1, s:75, v:1100000, lic:1, hot:0, r:'Midwest',      notes:'No license needed', jobs:[] },
  { c:'MN', n:'Minnesota',     opps:1, s:68, v:800000,  lic:0, hot:0, r:'Midwest',      notes:'VA Minneapolis', jobs:[] },
  { c:'MO', n:'Missouri',      opps:1, s:72, v:1200000, lic:0, hot:0, r:'Midwest',      notes:'Whiteman AFB', jobs:[] },
  { c:'KS', n:'Kansas',        opps:1, s:74, v:900000,  lic:1, hot:0, r:'Midwest',      notes:'Fort Riley', jobs:[] },
  { c:'CO', n:'Colorado',      opps:2, s:83, v:2800000, lic:1, hot:1, r:'Mountain',     notes:'Ft Carson', jobs:[] },
  { c:'AZ', n:'Arizona',       opps:1, s:74, v:1300000, lic:0, hot:0, r:'Mountain',     notes:'Luke AFB', jobs:[] },
  { c:'NM', n:'New Mexico',    opps:1, s:72, v:1100000, lic:0, hot:0, r:'Mountain',     notes:'Kirtland AFB', jobs:[] },
  { c:'NV', n:'Nevada',        opps:1, s:69, v:700000,  lic:0, hot:0, r:'Mountain',     notes:'Nellis AFB', jobs:[] },
  { c:'CA', n:'California',    opps:2, s:74, v:2100000, lic:0, hot:0, r:'Pacific',      notes:'Major fed market', jobs:[] },
  { c:'WA', n:'Washington',    opps:1, s:70, v:900000,  lic:0, hot:0, r:'Pacific',      notes:'JBLM', jobs:[] },
  { c:'MA', n:'Massachusetts', opps:1, s:62, v:600000,  lic:0, hot:0, r:'New England',  notes:'Hanscom AFB', jobs:[] },
  { c:'HI', n:'Hawaii',        opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Remote', jobs:[] },
  { c:'AK', n:'Alaska',        opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Remote', jobs:[] },
  { c:'OR', n:'Oregon',        opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'VA Portland', jobs:[] },
  { c:'UT', n:'Utah',          opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Hill AFB', jobs:[] },
  { c:'ID', n:'Idaho',         opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Mt Home AFB', jobs:[] },
  { c:'MT', n:'Montana',       opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Malmstrom', jobs:[] },
  { c:'WY', n:'Wyoming',       opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'No license needed', jobs:[] },
  { c:'ND', n:'N. Dakota',     opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'Minot AFB', jobs:[] },
  { c:'SD', n:'S. Dakota',     opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'Ellsworth', jobs:[] },
  { c:'NE', n:'Nebraska',      opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'Offutt AFB', jobs:[] },
  { c:'IA', n:'Iowa',          opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'No license needed', jobs:[] },
  { c:'WV', n:'W. Virginia',   opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Small market', jobs:[] },
  { c:'DE', n:'Delaware',      opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Dover AFB', jobs:[] },
  { c:'CT', n:'Connecticut',   opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Small', jobs:[] },
  { c:'RI', n:'Rhode Island',  opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Newport NS', jobs:[] },
  { c:'NH', n:'N. Hampshire',  opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'No license', jobs:[] },
  { c:'VT', n:'Vermont',       opps:0, s:0,  v:0,       lic:1, hot:0, r:'Other',        notes:'No license', jobs:[] },
  { c:'ME', n:'Maine',         opps:0, s:0,  v:0,       lic:0, hot:0, r:'Other',        notes:'Portsmouth NS', jobs:[] },
];

// ── 50-STATE SUPPLY DATA — location-blind, no license required ─
const SS = [
  { c:'LA', n:'Louisiana',     opps:2, s:94, v:427000, cats:'fuel,janitorial', r:'Gulf Coast',   notes:'NAS JRB · VA Med',      jobs:[{t:'Diesel-NAS JRB',v:'$340K',s:94,cat:'fuel'},{t:'Janitorial-VA',v:'$87K',s:91,cat:'janitorial'}] },
  { c:'TX', n:'Texas',         opps:3, s:88, v:280000, cats:'fuel,ppe,office', r:'Gulf Coast',   notes:'Ft Hood · VA Houston',  jobs:[] },
  { c:'MS', n:'Mississippi',   opps:1, s:82, v:24000,  cats:'ppe',             r:'Gulf Coast',   notes:'Keesler PPE',           jobs:[] },
  { c:'FL', n:'Florida',       opps:2, s:85, v:156000, cats:'janitorial,food', r:'South',        notes:'MacDill',               jobs:[] },
  { c:'GA', n:'Georgia',       opps:1, s:80, v:45000,  cats:'office',          r:'South',        notes:'Ft Benning',            jobs:[] },
  { c:'NC', n:'N. Carolina',   opps:1, s:78, v:65000,  cats:'ppe',             r:'South',        notes:'Ft Bragg',              jobs:[] },
  { c:'OK', n:'Oklahoma',      opps:1, s:76, v:12000,  cats:'food',            r:'South',        notes:'Ft Polk',               jobs:[] },
  { c:'VA', n:'Virginia',      opps:2, s:83, v:210000, cats:'fuel,office',     r:'Mid-Atlantic', notes:'Pentagon',              jobs:[] },
  { c:'DC', n:'Wash DC',       opps:2, s:86, v:185000, cats:'office,food',     r:'Mid-Atlantic', notes:'Federal buildings',     jobs:[] },
  { c:'MD', n:'Maryland',      opps:1, s:80, v:110000, cats:'fuel',            r:'Mid-Atlantic', notes:'Andrews',               jobs:[] },
  { c:'PA', n:'Pennsylvania',  opps:1, s:75, v:55000,  cats:'janitorial',      r:'Mid-Atlantic', notes:'Carlisle',              jobs:[] },
  { c:'OH', n:'Ohio',          opps:1, s:77, v:72000,  cats:'janitorial',      r:'Midwest',      notes:'Wright-Pat',            jobs:[] },
  { c:'IL', n:'Illinois',      opps:1, s:79, v:88000,  cats:'office',          r:'Midwest',      notes:'Scott AFB',             jobs:[] },
  { c:'CA', n:'California',    opps:3, s:79, v:320000, cats:'fuel,ppe,janitorial',r:'Pacific',   notes:'Largest market',        jobs:[] },
  { c:'CO', n:'Colorado',      opps:1, s:81, v:95000,  cats:'fuel',            r:'Mountain',     notes:'Ft Carson',             jobs:[] },
  { c:'AL', n:'Alabama',       opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'SC', n:'S. Carolina',   opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'TN', n:'Tennessee',     opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'WA', n:'Washington',    opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'AZ', n:'Arizona',       opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'NM', n:'New Mexico',    opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'NV', n:'Nevada',        opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'NJ', n:'New Jersey',    opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'NY', n:'New York',      opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'MI', n:'Michigan',      opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'MA', n:'Massachusetts', opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Eligible',              jobs:[] },
  { c:'HI', n:'Hawaii',        opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Drop-ship',             jobs:[] },
  { c:'AK', n:'Alaska',        opps:0, s:0,  v:0,      cats:'',                r:'Other',        notes:'Drop-ship',             jobs:[] },
];

// ── REUSABLE UI COMPONENTS ────────────────────────────────────

// Small inline badge / pill
function Badge({ bg, color, children, style = {} }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '.08em', padding: '2px 7px',
      borderRadius: 4, textTransform: 'uppercase', whiteSpace: 'nowrap',
      display: 'inline-block', background: bg, color, ...style,
    }}>
      {children}
    </span>
  );
}

// KPI metric tile
function Kpi({ val, valColor, label, sub, borderColor }) {
  return (
    <div style={{
      background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${borderColor}`,
      borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 130,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: valColor }}>{val}</div>
      <div style={{ fontSize: 10, color: V.t2, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: V.t3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Recommendation badge — STRONG BID / BID / CONDITIONAL / NO BID
function RbBadge({ r }) {
  const MAP = {
    'STRONG BID':  { bg: V.greenDim,  c: V.green,  i: '✅' },
    'BID':         { bg: V.cyanDim,   c: V.cyan,   i: '✅' },
    'CONDITIONAL': { bg: V.amberDim,  c: V.amber,  i: '⚠️' },
    'NO BID':      { bg: V.redDim,    c: V.red,    i: '❌' },
  };
  const s = MAP[r] || MAP['BID'];
  return <Badge bg={s.bg} color={s.c}>{s.i} {r}</Badge>;
}

// Opportunity row (used in Construction and Supply tabs)
function OppRow({ o, sl }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 70px 80px 110px 65px',
      gap: 8, alignItems: 'center', padding: '10px 14px',
      background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8,
      cursor: 'pointer', marginBottom: 6, transition: 'border-color .15s',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3 }}>{o.t}</div>
        <div style={{ fontSize: 10, color: V.t3, marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {o.a} · {o.n || o.c}{' '}
          <Badge bg={o.sa === 'SDB' ? V.goldDim : V.cyanDim} color={o.sa === 'SDB' ? V.gold : V.cyan}>{o.sa}</Badge>
          {o.src === 'DIBBS' && <Badge bg={V.amberDim} color={V.amber}>DIBBS</Badge>}
          {o.rc && <Badge bg={V.violetDim} color={V.violet}>{o.rc}</Badge>}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(o.v)}</div>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: sc(o.s) }}>{o.s}</span>
        <span style={{ fontSize: 8, color: V.t3, letterSpacing: '.1em', textTransform: 'uppercase', marginLeft: 3 }}>{sl}</span>
      </div>
      <div style={{ textAlign: 'center' }}><RbBadge r={o.r} /></div>
      <div style={{ textAlign: 'right', fontSize: 10, color: o.d <= 10 ? V.red : V.t3 }}>🕐 {o.d}d</div>
    </div>
  );
}

// 50-state grid — grouped by region, hot states highlighted
function StateGrid({ states, onSelect }) {
  // Collect active regions first, then append 'Other' for monitoring states
  const activeRegions = [...new Set(states.filter(s => s.opps > 0).map(s => s.r))];
  const regions = [...activeRegions, 'Other'];

  return (
    <div>
      {regions.map(rg => {
        const rs = states.filter(s => s.r === rg);
        if (!rs.length) return null;
        return (
          <div key={rg}>
            <div style={{
              fontSize: 8, color: V.t3, textTransform: 'uppercase', letterSpacing: '.1em',
              padding: '6px 2px 2px', borderTop: `1px solid ${V.bd}`, marginTop: 4,
            }}>
              {rg === 'Other' ? 'Monitoring' : '⭐ ' + rg}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(64px,1fr))', gap: 3 }}>
              {rs.map(s => {
                const col = s.hot ? V.green : s.opps > 0 ? V.cyan : V.t3;
                return (
                  <div
                    key={s.c}
                    onClick={() => onSelect(s.c)}
                    style={{
                      background: s.hot ? V.greenDim : V.card,
                      border: `1px solid ${s.hot ? V.greenBd : s.opps > 0 ? 'rgba(0,229,255,.18)' : 'rgba(255,255,255,.07)'}`,
                      borderRadius: 5, padding: '6px 5px', cursor: 'pointer', textAlign: 'center',
                      minHeight: 58, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', gap: 2, position: 'relative',
                      opacity: s.opps === 0 ? 0.35 : 1, transition: 'border-color .15s',
                    }}
                  >
                    {s.hot && (
                      <div style={{
                        position: 'absolute', top: 2, right: 2, fontSize: 5, fontWeight: 900,
                        padding: '1px 3px', borderRadius: 1,
                        background: V.greenDim, border: `1px solid ${V.greenBd}`, color: V.green,
                      }}>HIGH POT</div>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 900, color: col }}>{s.c}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: s.opps > 0 ? sc(s.s) : V.t3 }}>
                      {s.opps > 0 ? `${s.opps} opp${s.opps > 1 ? 's' : ''}` : '—'}
                    </div>
                    {s.v > 0 && <div style={{ fontSize: 7, color: V.t3 }}>{fmt(s.v)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// State detail panel — shown when a state tile is clicked
function StateDetail({ code, vt, states, onClose }) {
  const s = states.find(x => x.c === code);
  if (!s) return null;
  const sl = vt === 'construction' ? 'PRIME' : 'ACQ';
  return (
    <div style={{
      background: V.card, border: `1px solid ${V.goldBd}`,
      borderRadius: 8, padding: 16, marginTop: 12,
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, color: V.gold, letterSpacing: '.1em' }}>{s.c}</div>
          <div style={{ fontSize: 11, color: V.t3 }}>{s.n}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {s.hot && <Badge bg={V.greenDim} color={V.green}>⭐ HIGH POTENTIAL</Badge>}
            {vt === 'construction'
              ? (s.lic ? <Badge bg={V.greenDim} color={V.green}>✓ Can Bid</Badge>
                       : <Badge bg={V.amberDim} color={V.amber}>⚠ Needs License</Badge>)
              : <Badge bg={V.greenDim} color={V.green}>✓ No License Required</Badge>
            }
            {s.cats && s.cats.split(',').filter(Boolean).map(cat => (
              <Badge key={cat} bg={V.cyanDim} color={V.cyan}>{cat}</Badge>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: V.t2 }}>
            <span>Opps: <b style={{ color: V.green }}>{s.opps}</b></span>
            <span>Value: <b style={{ color: V.gold }}>{fmt(s.v)}</b></span>
            <span>Best {sl}: <b style={{ color: sc(s.s || 0) }}>{s.s || '—'}</b></span>
          </div>
        </div>
        <div onClick={onClose} style={{ cursor: 'pointer', color: V.t3, fontSize: 16, lineHeight: 1 }}>✕</div>
      </div>
      <div style={{
        fontSize: 9, fontWeight: 700, color: V.t3, textTransform: 'uppercase',
        letterSpacing: '.1em', margin: '12px 0 8px',
      }}>OPPORTUNITIES IN {s.c}</div>
      {s.jobs.length ? s.jobs.map((j, i) => (
        <div key={i} style={{
          background: V.cardHi, borderLeft: `3px solid ${sc(j.s || 0)}`,
          borderRadius: 6, padding: '8px 10px', marginBottom: 5,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{j.t}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: sc(j.s || 0) }}>{j.s}</span>
          </div>
          <div style={{ fontSize: 9, color: V.t3, marginTop: 3 }}>{j.v} · {j.sa || j.cat || ''}</div>
        </div>
      )) : (
        <div style={{ fontSize: 10, color: V.t3, padding: '8px 0', textAlign: 'center' }}>
          No current opportunities. SCOUT is monitoring.
        </div>
      )}
    </div>
  );
}

// ── MAIN DASHBOARD COMPONENT ──────────────────────────────────
export default function PrimeDashboard() {
  const [tab, setTab]           = useState('home');
  const [cState, setCState]     = useState(null);   // selected construction state code
  const [sState, setSState]     = useState(null);   // selected supply state code
  const [helpSearch, setHelpSearch] = useState('');
  const [openHelp, setOpenHelp] = useState(new Set());
  const [clock, setClock]       = useState('');

  // Live CT clock — updates every second
  useEffect(() => {
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const p = x => String(x).padStart(2, '0');
    const tick = () => {
      const n = new Date();
      setClock(`${DAYS[n.getDay()]} ${MONTHS[n.getMonth()]} ${n.getDate()} · ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())} CT`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Tab switch — also clear state detail panels
  const go = id => { setTab(id); setCState(null); setSState(null); };

  // Help FAQ toggle
  const toggleHelp = id => setOpenHelp(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  // Filtered help entries based on search input
  const filteredHelp = helpSearch
    ? HELP.filter(h => (h.term + ' ' + h.cat + ' ' + h.a).toLowerCase().includes(helpSearch.toLowerCase()))
    : HELP;

  // Top opps for Command Center — construction ≥80 and supply ≥85, sorted by score
  const topOpps = [
    ...COPPS.filter(o => o.s >= 80).map(o => ({ ...o, vt: 'construction', sl: 'PRIME' })),
    ...SOPPS.filter(o => o.s >= 85).map(o => ({ ...o, vt: 'supply',       sl: 'ACQ'   })),
  ].sort((a, b) => b.s - a.s);

  // Sidebar navigation structure
  const NAV = [
    { group: 'Command',      items: [{ id: 'home',       label: '🏠 Command Center' }] },
    { group: 'Find Work',    items: [{ id: 'construction',label: '🏗️ Construction',        dot: V.green },
                                     { id: 'supply',      label: '📦 Supply & Fulfillment', dot: V.cyan  }] },
    { group: 'Win Work',     items: [{ id: 'bids',        label: '📋 My Bids' }] },
    { group: 'Execute',      items: [{ id: 'active',      label: '📊 Active Projects' }] },
    { group: 'Revenue',      items: [{ id: 'money',       label: '💰 Money Recovery',       dot: V.green }] },
    { group: 'Compliance',   items: [{ id: 'compliance',  label: '🛡️ Certs · Bonds · Safety' }] },
    { group: 'Intelligence', items: [{ id: 'intel',       label: '🏛️ Market Intel & Congress' }] },
    { group: 'System',       items: [{ id: 'system',      label: '⚙️ Agents & Config' },
                                     { id: 'help',        label: '❓ Help & FAQ' }] },
  ];

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Outfit',system-ui,sans-serif", background: V.bg, color: V.t1, height: '100vh', overflow: 'hidden', display: 'flex' }}>

      {/* Google Font + global resets */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:99px}
        input::placeholder{color:#4D5669}
      `}</style>

      {/* Ambient gradient glow */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `radial-gradient(900px 500px at 70% -10%,${V.cyanDim},transparent 60%),
                     radial-gradient(700px 400px at 10% 110%,${V.goldDim},transparent 60%)`,
      }} />

      {/* ══ SIDEBAR ══════════════════════════════════════════ */}
      <nav style={{
        width: 220, background: 'rgba(8,11,20,.85)', backdropFilter: 'blur(12px)',
        borderRight: `1px solid ${V.bd}`, padding: '16px 10px',
        display: 'flex', flexDirection: 'column', gap: 2,
        overflowY: 'auto', flexShrink: 0, zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ padding: '8px 12px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg,#E9C46A,#8B6914)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 900, color: '#fff',
          }}>P</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>IQE <span style={{ color: V.gold }}>PRIME</span></div>
            <div style={{ fontSize: 8, color: V.t3, letterSpacing: '.14em', textTransform: 'uppercase', marginTop: 1 }}>
              v15 · Build Complete
            </div>
          </div>
        </div>

        {/* Nav groups */}
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <div style={{ fontSize: 9, fontWeight: 700, color: V.t3, letterSpacing: '.16em', padding: '12px 12px 4px', textTransform: 'uppercase' }}>
              {group}
            </div>
            {items.map(({ id, label, dot }) => (
              <button
                key={id}
                onClick={() => go(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                  background:  tab === id ? V.cyanDim : 'transparent',
                  color:       tab === id ? V.cyan    : V.t2,
                  fontSize: 12, fontFamily: "'Outfit',sans-serif",
                  fontWeight: tab === id ? 600 : 400,
                  textAlign: 'left', transition: 'all .15s',
                }}
              >
                <span style={{ flex: 1 }}>{label}</span>
                {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: `0 0 6px ${dot}` }} />}
              </button>
            ))}
          </div>
        ))}

        {/* Sidebar footer */}
        <div style={{ marginTop: 'auto', padding: '16px 12px 8px', fontSize: 9, color: V.t3, lineHeight: 1.6, borderTop: `1px solid ${V.bd}` }}>
          Walker Contractors LLC<br />
          Axiom Federal Solutions · CAGE 7JKKO<br />
          Score: 100/100 · $8–9/mo<br />
          70 gaps closed · 17 workflows
        </div>
      </nav>

      {/* ══ MAIN CONTENT ════════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px', zIndex: 1 }}>

        {/* ─── HOME / COMMAND CENTER ─── */}
        {tab === 'home' && (
          <div>
            {/* BRANDI Morning Brief */}
            <div style={{
              background: V.card, border: `1px solid ${V.goldBd}`, borderLeft: `4px solid ${V.gold}`,
              borderRadius: 8, padding: '14px 18px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: V.gold, letterSpacing: '.08em' }}>🤖 BRANDI — MORNING BRIEF</span>
                <span style={{ fontSize: 9, color: V.t3 }}>{clock}</span>
              </div>
              <div style={{ fontSize: 12, color: V.t2, lineHeight: 1.7 }}>
                Good morning, Joseph. PRIME scanned <b style={{ color: V.t1 }}>4,218 federal contracts</b> across{' '}
                <b style={{ color: V.t1 }}>all 50 states</b>. Found <b style={{ color: V.green }}>3 construction</b> and{' '}
                <b style={{ color: V.cyan }}>5 supply</b> above threshold. <b style={{ color: V.gold }}>2 STRONG BID.</b>{' '}
                Congress signed FY2026 MILCON — $14.2B. GL insurance renews in 52 days.{' '}
                <b style={{ color: V.green }}>$4,280 prompt payment interest available to claim.</b> Retainage held: $142K across 2 projects.
              </div>
            </div>

            {/* KPI Row — Construction / Supply split */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi val="$8.6M"  valColor={V.green} label="Construction Pipeline" sub="5 opps · 18 states active"       borderColor={V.green} />
              <Kpi val="$481K"  valColor={V.cyan}  label="Supply Pipeline"       sub="5 opps · all 50 states eligible" borderColor={V.cyan}  />
              <Kpi val="4"      valColor={V.gold}  label="Active Bids"           sub="1 won · 2 submitted · 1 draft"   borderColor={V.gold}  />
              <Kpi val="$146K"  valColor={V.green} label="Money to Recover"      sub="$4.3K interest · $142K retainage" borderColor={V.green} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14 }}>
              <div>
                {/* Top opportunities — both verticals */}
                <div style={{ fontSize: 10, fontWeight: 700, color: V.t3, letterSpacing: '.12em', marginBottom: 8, textTransform: 'uppercase' }}>
                  Top Opportunities — All Verticals
                </div>
                {topOpps.map((o, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 70px 80px 110px 65px',
                    gap: 8, alignItems: 'center', padding: '10px 14px',
                    background: V.card, border: `1px solid ${V.bd}`,
                    borderLeft: `3px solid ${o.vt === 'supply' ? V.cyan : V.green}`,
                    borderRadius: 8, cursor: 'pointer', marginBottom: 6,
                  }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3 }}>{o.t}</div>
                      <div style={{ fontSize: 10, color: V.t3, marginTop: 3 }}>
                        {o.a} · <Badge bg={o.vt === 'supply' ? V.cyanDim : V.greenDim} color={o.vt === 'supply' ? V.cyan : V.green}>
                          {o.vt === 'supply' ? 'SUPPLY' : 'CONSTR'}
                        </Badge>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(o.v)}</div>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: sc(o.s) }}>{o.s}</span>
                      <span style={{ fontSize: 8, color: V.t3, marginLeft: 3 }}>{o.sl}</span>
                    </div>
                    <div style={{ textAlign: 'center' }}><RbBadge r={o.r} /></div>
                    <div style={{ textAlign: 'right', fontSize: 10, color: V.t3 }}>🕐 {o.d}d</div>
                  </div>
                ))}

                {/* Alert strip */}
                <div style={{ fontSize: 10, fontWeight: 700, color: V.t3, letterSpacing: '.12em', margin: '16px 0 8px', textTransform: 'uppercase' }}>
                  🚨 Alerts
                </div>
                {[
                  { type: 'MONEY',    bg: V.greenDim, bd: V.greenBd,              c: V.green, msg: '$4,280 prompt payment interest ready to claim — 2 invoices late' },
                  { type: 'AGING',    bg: V.amberDim, bd: 'rgba(245,158,11,.22)', c: V.amber, msg: 'Keesler Housing bid decision pending 3 days — decide today' },
                  { type: 'URGENT',   bg: V.redDim,   bd: 'rgba(248,113,113,.22)',c: V.red,   msg: 'Enter past performance — bids 15-30% weaker' },
                  { type: 'OSDBU',    bg: V.cyanDim,  bd: V.cyanBd,              c: V.cyan,  msg: 'VA VISN 16 Industry Day — May 14 — register by May 7' },
                  { type: 'CONGRESS', bg: V.amberDim, bd: 'rgba(245,158,11,.22)', c: V.amber, msg: 'FY2026 MILCON $14.2B — USACE surge Q3' },
                ].map((al, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, marginBottom: 6, background: al.bg, border: `1px solid ${al.bd}` }}>
                    <Badge bg={al.bg} color={al.c}>{al.type}</Badge>
                    <span style={{ fontSize: 11, color: V.t2 }}>{al.msg}</span>
                  </div>
                ))}
              </div>

              {/* Agent live feed */}
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 14, maxHeight: 420, overflowY: 'auto' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: V.t3, letterSpacing: '.12em', marginBottom: 10, textTransform: 'uppercase' }}>
                  Agent Feed
                </div>
                {[
                  { a: 'BRANDI', t: 'Morning digest — 3 construction, 5 supply, $146K recoverable',    c: V.gold,   tm: '2m'  },
                  { a: 'EXEC',   t: 'Prompt payment: 2 invoices 16+ days late — $4,280 interest',       c: V.green,  tm: '4m'  },
                  { a: 'JUDGE',  t: 'VA Slidell PRIME 91 — STRONG BID',                                  c: V.cyan,   tm: '6m'  },
                  { a: 'JUDGE',  t: 'Keesler decision aging — 3 days, no response',                      c: V.amber,  tm: '7m'  },
                  { a: 'RECON',  t: 'OSDBU: VA VISN 16 Industry Day May 14 — cap statement ready',       c: V.violet, tm: '8m'  },
                  { a: 'RECON',  t: 'GAO: No protests on active pipeline — clear',                        c: V.green,  tm: '9m'  },
                  { a: 'VAULT',  t: 'SAM.gov health check — all clear, 287 days to renewal',              c: V.green,  tm: '11m' },
                  { a: 'SCOUT',  t: 'SAM: 4,218 records · DIBBS: 38 new · 1 site visit detected',        c: V.green,  tm: '15m' },
                  { a: 'LEDGER', t: 'Revenue concentration: VA at 38% — below 40% threshold',             c: V.green,  tm: '22m' },
                  { a: 'EXEC',   t: 'WH-347 payroll ready for signature — 2 active contracts',            c: V.cyan,   tm: '31m' },
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: `1px solid ${V.bd}` }}>
                    <span style={{ fontSize: 9, fontWeight: 700, minWidth: 52, color: f.c }}>{f.a}</span>
                    <span style={{ fontSize: 10, color: V.t2, flex: 1, lineHeight: 1.4 }}>{f.t}</span>
                    <span style={{ fontSize: 9, color: V.t3 }}>{f.tm}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── CONSTRUCTION TAB ─── */}
        {tab === 'construction' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>🏗️ Construction — 50 States</div>
                <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>PRIME Score · Green=can bid · Click state for details</div>
              </div>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.green}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: V.green }}>$8.6M</div>
                <div style={{ fontSize: 10, color: V.t2, marginTop: 2 }}>18 states active</div>
              </div>
            </div>
            <StateGrid states={CS} onSelect={setCState} />
            {cState && <StateDetail code={cState} vt="construction" states={CS} onClose={() => setCState(null)} />}
            <div style={{ fontSize: 10, fontWeight: 700, color: V.t3, letterSpacing: '.12em', margin: '20px 0 8px', textTransform: 'uppercase' }}>
              All Construction Opportunities
            </div>
            {COPPS.map((o, i) => <OppRow key={i} o={o} sl="PRIME" />)}
          </div>
        )}

        {/* ─── SUPPLY & FULFILLMENT TAB ─── */}
        {tab === 'supply' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>📦 Supply & Fulfillment — 50 States</div>
                <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>ACQ Score · Location-blind · No license · Drop-ship model</div>
              </div>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.cyan}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: V.cyan }}>$481K</div>
                <div style={{ fontSize: 10, color: V.t2, marginTop: 2 }}>All 50 states eligible</div>
              </div>
            </div>
            {/* Category pills — 5 NAICS supply categories */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {[
                { label: '⛽ Fuel',       bg: V.amberDim,  c: V.amber,  bd: 'rgba(245,158,11,.25)'   },
                { label: '🧹 Janitorial', bg: V.greenDim,  c: V.green,  bd: V.greenBd                },
                { label: '🧤 PPE',        bg: V.cyanDim,   c: V.cyan,   bd: V.cyanBd                 },
                { label: '📎 Office',     bg: V.violetDim, c: V.violet, bd: 'rgba(167,139,250,.25)'  },
                { label: '☕ Food',       bg: V.goldDim,   c: V.gold,   bd: V.goldBd                 },
              ].map((p, i) => (
                <div key={i} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: p.bg, border: `1px solid ${p.bd}`, color: p.c }}>
                  {p.label}
                </div>
              ))}
            </div>
            <StateGrid states={SS} onSelect={setSState} />
            {sState && <StateDetail code={sState} vt="supply" states={SS} onClose={() => setSState(null)} />}
            <div style={{ fontSize: 10, fontWeight: 700, color: V.t3, letterSpacing: '.12em', margin: '20px 0 8px', textTransform: 'uppercase' }}>
              All Supply Opportunities
            </div>
            {SOPPS.map((o, i) => <OppRow key={i} o={o} sl="ACQ" />)}
          </div>
        )}

        {/* ─── MY BIDS ─── */}
        {tab === 'bids' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>📋 My Bids — Pipeline & Decision Tracker</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Kpi val="1" valColor={V.amber} label="Decision Aging"  sub="Keesler — 3 days pending"   borderColor={V.amber} />
              <Kpi val="2" valColor={V.green} label="Bid Bonds"       sub="1 received · 1 requested"   borderColor={V.green} />
              <Kpi val="1" valColor={V.cyan}  label="Site Visits"     sub="VA Slidell — confirmed"      borderColor={V.cyan}  />
            </div>
            {[
              { t:'VA Baton Rouge Paint',    v:'construction', st:'won',       amt:145000,  sub:'Mar 28', aging:0, bond:'N/A'      },
              { t:'GSA Leake Ave',           v:'construction', st:'submitted', amt:680000,  sub:'Apr 19', aging:0, bond:'Received' },
              { t:'VA Slidell Clinic',       v:'construction', st:'draft',     amt:2400000, sub:'—',      aging:0, bond:'Requested', site:'✅ Attended' },
              { t:'Keesler Housing',         v:'construction', st:'scoring',   amt:3200000, sub:'—',      aging:3, bond:'Required',  site:'—' },
              { t:'Diesel Fuel-NAS JRB',     v:'supply',       st:'draft',     amt:340000,  sub:'—',      aging:0, bond:'N/A'      },
              { t:'Janitorial-VA Med',       v:'supply',       st:'submitted', amt:87000,   sub:'Apr 22', aging:0, bond:'N/A'      },
            ].map((b, i) => {
              const stColor = { won: V.green, submitted: V.cyan, draft: V.gold, scoring: V.amber }[b.st];
              const stDim   = { won: V.greenDim, submitted: V.cyanDim, draft: V.goldDim, scoring: V.amberDim }[b.st];
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  background: V.card,
                  border: `1px solid ${V.bd}`,
                  borderLeft: b.aging > 2 ? `3px solid ${V.amber}` : b.st === 'won' ? `3px solid ${V.green}` : `1px solid ${V.bd}`,
                  borderRadius: 8, marginBottom: 6,
                }}>
                  <Badge bg={b.v === 'supply' ? V.cyanDim : V.greenDim} color={b.v === 'supply' ? V.cyan : V.green}>
                    {b.v === 'supply' ? 'SUPPLY' : 'CONSTR'}
                  </Badge>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{b.t}</div>
                    <div style={{ fontSize: 10, color: V.t3, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {b.sub} · {fmt(b.amt)}
                      {b.bond && b.bond !== 'N/A' && (
                        <Badge bg={b.bond === 'Received' ? V.greenDim : V.amberDim} color={b.bond === 'Received' ? V.green : V.amber}>
                          🔒 Bond: {b.bond}
                        </Badge>
                      )}
                      {b.site && b.site !== '—' && <Badge bg={V.greenDim} color={V.green}>{b.site}</Badge>}
                    </div>
                  </div>
                  {b.aging > 0 && <Badge bg={V.amberDim} color={V.amber}>⏳ {b.aging}d AGING</Badge>}
                  <Badge bg={stDim} color={stColor}>{b.st.toUpperCase()}</Badge>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── ACTIVE PROJECTS ─── */}
        {tab === 'active' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>📊 Active Projects — Execution Tracker</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Kpi val="2"    valColor={V.green} label="Active Contracts" sub="$2.05M total value"        borderColor={V.green} />
              <Kpi val="$142K"valColor={V.amber} label="Retainage Held"   sub="5% held on both"           borderColor={V.amber} />
              <Kpi val="0"    valColor={V.cyan}  label="Cost Overruns"    sub="All within 10% variance"   borderColor={V.cyan}  />
              <Kpi val="✓"    valColor={V.green} label="WH-347 Current"   sub="Both contracts filed"      borderColor={V.green} />
            </div>
            {[
              { t:'VA Baton Rouge Paint — Interior Renovation', num:'VA-267-2026-C-0014',  v:1450000, ag:'VA',     pct:35, ret:72500, mods:1, payroll:'Filed Apr 18', subDue:'—',              variance:4.2  },
              { t:'NAVFAC Federal City Electrical',             num:'N69459-26-C-0176',    v:600000,  ag:'NAVFAC', pct:15, ret:30000, mods:0, payroll:'Filed Apr 18', subDue:'Apr 29 (3d left)', variance:-2.1 },
            ].map((p, i) => (
              <div key={i} style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.t}</div>
                    <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>{p.num} · {p.ag} · {fmt(p.v)}</div>
                  </div>
                  <Badge bg={V.greenDim} color={V.green}>ACTIVE</Badge>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, background: V.bd, borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ height: '100%', width: `${p.pct}%`, background: V.cyan, borderRadius: 99 }} />
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 10, color: V.t2, marginBottom: 8 }}>
                  <span>Progress: <b style={{ color: V.cyan }}>{p.pct}%</b></span>
                  <span>· Variance: <b style={{ color: Math.abs(p.variance) < 10 ? V.green : V.red }}>{p.variance}%</b></span>
                  <span>· Mods: <b>{p.mods}</b></span>
                </div>
                {/* 4-metric tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                  {[
                    { lbl:'Retainage',      val: fmt(p.ret),  bg: V.amberDim, c: V.amber, bd:'rgba(245,158,11,.2)',     large:true  },
                    { lbl:'WH-347',         val: p.payroll,   bg: V.greenDim, c: V.green, bd: V.greenBd,               large:false },
                    { lbl:'Sub Payment',    val: p.subDue,    bg: V.cyanDim,  c: p.subDue.includes('3d') ? V.amber : V.cyan, bd: V.cyanBd, large:false },
                    { lbl:'Contract Mods',  val: p.mods,      bg: V.violetDim,c: V.violet,bd:'rgba(167,139,250,.2)',   large:true  },
                  ].map((tile, ti) => (
                    <div key={ti} style={{ padding: 8, borderRadius: 6, background: tile.bg, border: `1px solid ${tile.bd}`, textAlign: 'center' }}>
                      <div style={{ fontSize: 8, color: tile.c, letterSpacing: '.1em', textTransform: 'uppercase' }}>{tile.lbl}</div>
                      <div style={{ fontSize: tile.large ? 14 : 10, fontWeight: tile.large ? 800 : 600, color: tile.c, marginTop: tile.large ? 2 : 4 }}>{tile.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── MONEY RECOVERY ─── */}
        {tab === 'money' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>💰 Money Recovery — EXEC Agent</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi val="$4,280" valColor={V.green} label="Interest Claimable"    sub="2 late invoices · FAR 52.232-25"  borderColor={V.green} />
              <Kpi val="$142K"  valColor={V.amber} label="Retainage Held"        sub="2 active contracts · 5% rate"     borderColor={V.amber} />
              <Kpi val="$0"     valColor={V.cyan}  label="Sub Payments Overdue"  sub="All within 7-day window"          borderColor={V.cyan}  />
              <Kpi val="$146K"  valColor={V.green} label="Total Recoverable"     sub="Action items below"               borderColor={V.green} />
            </div>

            {/* Prompt Payment Interest */}
            <div style={{ fontSize: 12, fontWeight: 700, color: V.green, letterSpacing: '.08em', marginBottom: 10 }}>💵 PROMPT PAYMENT INTEREST CLAIMS</div>
            {[
              { inv:'INV-2026-014', contract:'VA BR Paint',        amt:145000, due:'Apr 8', paid:'Apr 24', late:16, rate:0.0525, interest:1320, status:'Draft Ready' },
              { inv:'INV-2026-018', contract:'NAVFAC Federal City', amt:85000,  due:'Apr 2', paid:'Apr 24', late:22, rate:0.0525, interest:2960, status:'Draft Ready' },
            ].map((inv, i) => (
              <div key={i} style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.green}`, borderRadius: 8, padding: 16, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{inv.inv} — {inv.contract}</div>
                    <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>
                      Invoice: {fmt(inv.amt)} · Due: {inv.due} · Paid: {inv.paid} · <b style={{ color: V.red }}>{inv.late} days late</b>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: V.green }}>${inv.interest.toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: V.t3 }}>Treasury rate: {inv.rate}%</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${V.bd}` }}>
                  <span style={{ fontSize: 9, color: V.t3 }}>FAR 52.232-25 claim letter drafted by EXEC</span>
                  <Badge bg={V.greenDim} color={V.green}>{inv.status}</Badge>
                </div>
              </div>
            ))}

            {/* Retainage Tracker */}
            <div style={{ fontSize: 12, fontWeight: 700, color: V.amber, letterSpacing: '.08em', margin: '20px 0 10px' }}>🏗️ RETAINAGE TRACKER</div>
            {[
              { contract:'VA BR Paint',        total:1450000, rate:5, held:72500, pct:35, status:'Active — 65% remaining' },
              { contract:'NAVFAC Federal City', total:600000,  rate:5, held:30000, pct:15, status:'Active — early stage'   },
            ].map((r, i) => (
              <div key={i} style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.amber}`, borderRadius: 8, padding: 16, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.contract}</div>
                    <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>Contract: {fmt(r.total)} · Rate: {r.rate}% · Progress: {r.pct}%</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: V.amber }}>{fmt(r.held)}</div>
                    <div style={{ fontSize: 9, color: V.t3 }}>held back</div>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: V.t3, marginTop: 6 }}>{r.status} — EXEC will draft release request at substantial completion</div>
              </div>
            ))}

            {/* Sub Payment Flow-Down */}
            <div style={{ fontSize: 12, fontWeight: 700, color: V.cyan, letterSpacing: '.08em', margin: '20px 0 10px' }}>🤝 SUB PAYMENT FLOW-DOWN (7-DAY RULE)</div>
            <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.cyan}`, borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>All Sub Payments — Compliant</div>
                  <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>Next government payment expected: May 1 — EXEC will start 7-day countdown</div>
                </div>
                <Badge bg={V.greenDim} color={V.green}>✓ COMPLIANT</Badge>
              </div>
            </div>
          </div>
        )}

        {/* ─── COMPLIANCE ─── */}
        {tab === 'compliance' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>🛡️ Compliance — VAULT Agent</div>
            {/* SAM Health + CPARS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.green, letterSpacing: '.08em', marginBottom: 10 }}>SAM.GOV HEALTH CHECK</div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  {[
                    { lbl:'Status',         val:'✓ Active', c:V.green },
                    { lbl:'Days to Renewal',val:'287',      c:V.green },
                    { lbl:'NAICS Match',    val:'✓ 9/9',   c:V.green },
                  ].map((item, i) => (
                    <div key={i} style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: V.t3 }}>{item.lbl}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: item.c, marginTop: 2 }}>{item.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 9, color: V.t3 }}>Last check: Apr 1 · Next: May 1 · Address: ✓ · Banking: ✓</div>
              </div>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.cyan, letterSpacing: '.08em', marginBottom: 10 }}>CPARS MONITOR</div>
                <div style={{ fontSize: 11, color: V.t2, lineHeight: 1.6 }}>
                  No CPARS evaluations on file. First evaluation expected after VA BR Paint contract completion. RECON checks CPARS.gov every Wednesday at 08:00 CT.
                </div>
                <div style={{ fontSize: 9, color: V.t3, marginTop: 6 }}>Last check: Apr 23 · Status: No new ratings</div>
              </div>
            </div>
            {/* Cert / compliance rows */}
            {[
              { n:'SAM.gov Registration',   s:'Active',      e:'Jan 2027',        c:V.green },
              { n:'SDB Certification',      s:'Active',      e:'Self-cert',       c:V.green },
              { n:'MBE Certification',      s:'Active',      e:'Dec 2026',        c:V.green },
              { n:'GL Insurance',           s:'Renewing',    e:'Jun 2026 (52d)',  c:V.amber },
              { n:'LA Contractor License',  s:'Active',      e:'Mar 2027',        c:V.green },
              { n:'Bonding $1.5M/$3M',      s:'Verified',    e:'Apr 2026',        c:V.cyan  },
              { n:'HUBZone',                s:'Not Applied', e:'—',               c:V.red   },
              { n:'8(a) Program',           s:'Not Applied', e:'—',               c:V.red   },
              { n:'Safety TRIR',            s:'0.00',        e:'3yr rolling',     c:V.green },
              { n:'Bid Bond — VA Slidell',  s:'Requested',   e:'Pending surety',  c:V.amber },
              { n:'Bid Bond — GSA Leake',   s:'Received',    e:'Valid',           c:V.green },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.c, boxShadow: `0 0 6px ${item.c}`, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{item.n}</span>
                <Badge bg={item.c + '18'} color={item.c}>{item.s}</Badge>
                <span style={{ fontSize: 10, color: V.t3, minWidth: 100, textAlign: 'right' }}>{item.e}</span>
              </div>
            ))}
          </div>
        )}

        {/* ─── MARKET INTEL & CONGRESS ─── */}
        {tab === 'intel' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>🏛️ Market Intel & Congressional Briefing</div>

            {/* GAO + Revenue Concentration */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.green}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.green, letterSpacing: '.08em', marginBottom: 8 }}>⚖️ GAO PROTEST MONITOR</div>
                <div style={{ fontSize: 11, color: V.t2, lineHeight: 1.6 }}>No active protests affecting your pipeline. RECON scans GAO.gov daily at 10:00 CT. Last scan: today.</div>
                <div style={{ fontSize: 9, color: V.t3, marginTop: 4 }}>0 protests on won contracts · 0 protest windows on losses</div>
              </div>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.violet}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.violet, letterSpacing: '.08em', marginBottom: 8 }}>📊 REVENUE CONCENTRATION</div>
                {[
                  { ag:'VA',     pct:38, c:V.green },
                  { ag:'NAVFAC', pct:29, c:V.green },
                  { ag:'GSA',    pct:18, c:V.green },
                  { ag:'Other',  pct:15, c:V.green },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: V.t2, minWidth: 50 }}>{r.ag}</span>
                    <div style={{ flex: 1, height: 4, background: V.bd, borderRadius: 99 }}>
                      <div style={{ width: `${r.pct}%`, height: '100%', background: r.c, borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 10, color: V.t2, minWidth: 30, textAlign: 'right' }}>{r.pct}%</span>
                  </div>
                ))}
                <div style={{ fontSize: 9, color: V.green, marginTop: 4 }}>✓ Below 40% threshold — no diversification action needed</div>
              </div>
            </div>

            {/* OSDBU Events */}
            <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${V.cyan}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: V.cyan, letterSpacing: '.08em', marginBottom: 10 }}>📅 OSDBU EVENTS — RECON AGENT</div>
              {[
                { ag:'VA VISN 16',       ev:'Industry Day — Clinic Renovations',  dt:'May 14, 2026', reg:'May 7', cap:'Ready',       c:V.green },
                { ag:'USACE New Orleans',ev:'Small Business Matchmaking',          dt:'Jun 2, 2026',  reg:'May 25',cap:'Generating',  c:V.amber },
                { ag:'GSA PBS Region 7', ev:'Forecast Briefing FY2027',            dt:'Jul 10, 2026', reg:'Jul 1', cap:'Not Started', c:V.t3    },
              ].map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < 2 ? `1px solid ${V.bd}` : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 500 }}>{e.ag} — {e.ev}</div>
                    <div style={{ fontSize: 9, color: V.t3, marginTop: 2 }}>Date: {e.dt} · Register by: {e.reg}</div>
                  </div>
                  <Badge bg={e.c + '18'} color={e.c}>Cap Statement: {e.cap}</Badge>
                </div>
              ))}
            </div>

            {/* Congressional Briefing */}
            <div style={{ fontSize: 12, fontWeight: 700, color: V.amber, letterSpacing: '.08em', marginBottom: 10 }}>🏛️ CONGRESSIONAL BRIEFING — RECON AGENT</div>
            {CONGRESS.map((c, i) => (
              <div key={i} style={{ background: V.card, border: `1px solid ${V.bd}`, borderLeft: `3px solid ${c.sc}`, borderRadius: 8, padding: 14, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{c.bill}</div>
                    <div style={{ fontSize: 9, color: V.t3, marginTop: 3 }}>{c.date} · {c.amount}</div>
                  </div>
                  <Badge bg={c.sc + '18'} color={c.sc} style={{ flexShrink: 0, marginLeft: 8 }}>{c.status}</Badge>
                </div>
                <div style={{ fontSize: 11, color: V.t2, lineHeight: 1.5, marginBottom: 8 }}>{c.summary}</div>
                <div style={{ padding: '10px 12px', borderRadius: 6, background: c.ib, border: `1px solid ${c.ic}33` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: c.ic, marginBottom: 6 }}>⚡ {c.impact}</div>
                  {c.fx.map((fx, fi) => (
                    <div key={fi} style={{ color: V.t2, padding: '2px 0 2px 12px', position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: c.ic }}>→</span>{fx}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Win Rate + CO Contacts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.gold, marginBottom: 12 }}>WIN RATE</div>
                {[
                  { c:'SDB Set-Aside',  r:67 },
                  { c:'Small Business', r:45 },
                  { c:'Supply',         r:0  },
                ].map((w, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: V.t2 }}>
                      <span>{w.c}</span><span>{w.r}%</span>
                    </div>
                    <div style={{ height: 4, background: V.bd, borderRadius: 99, marginTop: 6 }}>
                      <div style={{ width: `${w.r}%`, height: '100%', background: w.r >= 50 ? V.green : V.amber, borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.cyan, marginBottom: 12 }}>CO CONTACTS</div>
                {[
                  { n:'J. Martinez', a:'VA VISN 16',   o:4 },
                  { n:'R. Thompson', a:'NAVFAC SE',     o:2 },
                  { n:'D. Chen',     a:'GSA PBS R7',    o:3 },
                ].map((co, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < 2 ? `1px solid ${V.bd}` : 'none' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: V.cyanDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: V.cyan }}>
                      {co.n[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11 }}>{co.n}</div>
                      <div style={{ fontSize: 9, color: V.t3 }}>{co.a}</div>
                    </div>
                    <span style={{ fontSize: 9, color: V.t3 }}>{co.o} opps</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── SYSTEM / AGENTS & CONFIG ─── */}
        {tab === 'system' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>⚙️ System · 9 Agents · 100/100 · 70 Gaps Closed</div>

            {/* 9 Agent cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {[
                { n:'BRANDI',  r:'CEO',                s:92, c:V.gold,   lr:'6:00 AM'   },
                { n:'SCOUT',   r:'Job Finder',         s:96, c:V.green,  lr:'6:15 AM'   },
                { n:'JUDGE',   r:'Scorer',             s:92, c:V.cyan,   lr:'6:16 AM'   },
                { n:'VAULT',   r:'Compliance',         s:99, c:V.green,  lr:'5:30 AM'   },
                { n:'RECON',   r:'Intel+GAO+OSDBU',    s:95, c:V.cyan,   lr:'11 AM'     },
                { n:'DRAFT',   r:'Proposals+CapStmt',  s:99, c:V.green,  lr:'On-demand' },
                { n:'BID ENG', r:'Pricer+Staleness',   s:97, c:V.cyan,   lr:'On-demand' },
                { n:'LEDGER',  r:'Learn+Concentrate',  s:93, c:V.cyan,   lr:'Sun 10PM'  },
                { n:'EXEC',    r:'Track+Payroll+$$',   s:96, c:V.green,  lr:'Mon 6AM'   },
              ].map((ag, i) => (
                <div key={i} style={{ background: V.card, border: `1px solid ${ag.c}22`, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ag.c, boxShadow: `0 0 6px ${ag.c}` }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: ag.c }}>{ag.n}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: ag.c, marginLeft: 'auto' }}>{ag.s}</span>
                  </div>
                  <div style={{ fontSize: 10, color: V.t2 }}>{ag.r}</div>
                  <div style={{ fontSize: 9, color: V.t3, marginTop: 4 }}>Last: {ag.lr}</div>
                </div>
              ))}
            </div>

            {/* Level 6 Growth Options */}
            <div style={{ fontSize: 12, fontWeight: 700, color: V.gold, letterSpacing: '.08em', margin: '20px 0 10px' }}>🚀 GROWTH OPTIONS — LEVEL 6</div>
            {[
              { t:'Predictive Win Scoring (ML)',      trig:'AUTO', thresh:'20+ bid outcomes',      stat:'3/20 outcomes logged',   pct:15, c:V.amber },
              { t:'Monte Carlo Forecasting',          trig:'AUTO', thresh:'10+ bid outcomes',      stat:'3/10 outcomes logged',   pct:30, c:V.amber },
              { t:'Competitive Intel Aggregator',     trig:'AUTO', thresh:'20+ competitor prices', stat:'8/20 prices captured',   pct:40, c:V.amber },
              { t:'Teaming Agreement Pipeline',       trig:'USER', thresh:'DocuSign API key',       stat:'Not configured',         pct:0,  c:V.t3    },
              { t:'Multi-Entity Support',             trig:'USER', thresh:'2nd SAM.gov registration',stat:'Not started',          pct:0,  c:V.t3    },
              { t:'Client Portal for COs',            trig:'USER', thresh:'Active CO relationship', stat:'Available',              pct:0,  c:V.t3    },
              { t:'White-Label SaaS',                 trig:'USER', thresh:'Multi-tenant + Stripe',  stat:'Not started',           pct:0,  c:V.t3    },
            ].map((g, i) => (
              <div key={i} style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 14, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{g.t}</div>
                    <div style={{ fontSize: 10, color: V.t3, marginTop: 2 }}>Threshold: {g.thresh} · {g.stat}</div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                    borderRadius: 4, fontSize: 9, fontWeight: 700,
                    background: g.trig === 'AUTO' ? V.cyanDim  : V.goldDim,
                    color:      g.trig === 'AUTO' ? V.cyan      : V.gold,
                  }}>
                    {g.trig === 'AUTO' ? '⚡ AUTO' : '👤 USER DECISION'}
                  </span>
                </div>
                {g.pct > 0 && (
                  <>
                    <div style={{ height: 4, background: V.bd, borderRadius: 99, marginTop: 8 }}>
                      <div style={{ width: `${g.pct}%`, height: '100%', background: g.c, borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 9, color: V.t3, marginTop: 3 }}>{g.pct}% to activation</div>
                  </>
                )}
              </div>
            ))}

            {/* Cost + API Health */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.gold, marginBottom: 10 }}>COST</div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: V.t2 }}>
                    <span>Anthropic</span><span>$6.40/$10</span>
                  </div>
                  <div style={{ height: 4, background: V.bd, borderRadius: 99, marginTop: 3 }}>
                    <div style={{ width: '64%', height: '100%', background: V.green, borderRadius: 99 }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.gold, marginTop: 10 }}>$9.20/mo total</div>
                <div style={{ fontSize: 9, color: V.t3, marginTop: 4 }}>17 workflows · 25 tables · 30 help entries</div>
              </div>
              <div style={{ background: V.card, border: `1px solid ${V.bd}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V.cyan, marginBottom: 10 }}>API HEALTH</div>
                {['SAM.gov','USAspending','DIBBS','Congress.gov','GAO.gov','CPARS.gov','Anthropic','SendGrid'].map((api, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: i < 7 ? `1px solid ${V.bd}` : 'none' }}>
                    <span style={{ fontSize: 10, color: V.t2 }}>{api}</span>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: V.green, display: 'inline-block', boxShadow: `0 0 4px ${V.green}` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── HELP & FAQ ─── */}
        {tab === 'help' && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>❓ Help & FAQ — Searchable Knowledge Base</div>
            <div style={{ fontSize: 10, color: V.t3, marginBottom: 16 }}>
              20 entries · Written at 7th grade level · Auto-updated by agents · Search any term below
            </div>
            <input
              type="text"
              placeholder="Search any term, alert, or feature..."
              value={helpSearch}
              onChange={e => setHelpSearch(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${V.bd}`, background: V.card, color: V.t1,
                fontFamily: "'Outfit',sans-serif", fontSize: 13, outline: 'none', marginBottom: 16,
              }}
            />
            {filteredHelp.map(h => (
              <div
                key={h.id}
                onClick={() => toggleHelp(h.id)}
                style={{
                  background: V.card,
                  border: `1px solid ${openHelp.has(h.id) ? V.goldBd : V.bd}`,
                  borderRadius: 8, padding: 14, marginBottom: 8,
                  cursor: 'pointer', transition: 'border-color .15s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: openHelp.has(h.id) ? 6 : 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: h.catC + '18', color: h.catC, marginRight: 6 }}>
                    {h.cat}
                  </span>
                  {h.term}
                  <span style={{ fontSize: 9, color: V.t3, marginLeft: 8 }}>{h.agent}</span>
                </div>
                {openHelp.has(h.id) && (
                  <div style={{ fontSize: 11, color: V.t2, lineHeight: 1.6 }}>{h.a}</div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
