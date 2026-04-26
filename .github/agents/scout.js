// scout.js — finds federal contracts on SAM.gov
const { supabase, logAction } = require('../lib/supabase');

const SAM_API = 'https://api.sam.gov/opportunities/v2/search';
const NAICS_CODES = ['236220','238210','237990','236116','561730','424710','424130','424490','424120'];
let inserted = 0;

async function runScout() {
  console.log('SCOUT: Starting scan at ' + new Date().toISOString());
  try {
    await scanSAM();
    await logAction('SCOUT', 'SAM scan complete', { count: inserted });
    console.log('SCOUT: Done. Found ' + inserted + ' new opportunities.');
  } catch (err) {
    console.error('SCOUT ERROR:', err.message);
    await logAction('SCOUT', 'SAM scan failed', { error: err.message });
    process.exit(1);
  }
}

async function scanSAM() {
  for (const naics of NAICS_CODES) {
    const params = new URLSearchParams({
      api_key: process.env.SAM_API_KEY,
      naicsCode: naics,
      postedFrom: getYesterdayISO(),
      limit: 100,
      offset: 0
    });
    try {
      const res = await fetch(SAM_API + '?' + params);
      if (!res.ok) continue;
      const data = await res.json();
      for (const opp of (data.opportunitiesData || [])) {
        await upsertOpportunity(opp);
      }
    } catch (err) {
      console.warn('SCOUT: Failed NAICS ' + naics + ' — ' + err.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function upsertOpportunity(opp) {
  const record = {
    solicitation_number: opp.solicitationNumber || opp.noticeId,
    title:       opp.title || 'Untitled',
    agency:      opp.department || null,
    naics:       opp.naicsCode || null,
    set_aside:   opp.typeOfSetAsideDescription || null,
    location:    opp.placeOfPerformance?.city?.name || null,
    state:       opp.placeOfPerformance?.state?.code || null,
    value:       parseFloat(opp.baseAndAllOptionsValue) || null,
    posted_date: opp.postedDate ? opp.postedDate.split('T')[0] : null,
    deadline:    opp.responseDeadLine ? opp.responseDeadLine.split('T')[0] : null,
    description_url: opp.uiLink || null,
    source: 'SAM',
    status: 'new'
  };
  if (!record.solicitation_number) return;
  const { error } = await supabase
    .from('opportunities')
    .upsert(record, { onConflict: 'solicitation_number' });
  if (!error) inserted++;
}

function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

runScout();
