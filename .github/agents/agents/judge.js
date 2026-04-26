// judge.js — scores every new opportunity 0-100
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

const WEIGHTS = { alignment: 0.25, winProb: 0.20, financial: 0.25, strategic: 0.15, feasibility: 0.15 };

async function runJudge() {
  console.log('JUDGE: Starting scoring run at ' + new Date().toISOString());
  const { data: opps, error } = await supabase.from('opportunities').select('*').eq('status', 'new');
  if (error) { console.error('JUDGE:', error.message); process.exit(1); }
  console.log('JUDGE: Scoring ' + opps.length + ' opportunities...');
  for (const opp of opps) {
    try { await scoreOpportunity(opp); }
    catch (err) { console.warn('JUDGE: Failed ' + opp.solicitation_number + ' — ' + err.message); }
  }
  await logAction('JUDGE', 'Scoring run complete', { scored: opps.length });
  console.log('JUDGE: Done.');
}

async function scoreOpportunity(opp) {
  const factors = {
    alignment:   calcAlignment(opp),
    winProb:     calcWinProbability(opp),
    financial:   calcFinancial(opp),
    strategic:   calcStrategic(opp),
    feasibility: calcFeasibility(opp)
  };
  const score = Object.entries(factors).reduce((sum, [k, v]) => sum + v * WEIGHTS[k], 0);
  const rationale = await claudeHaiku(
    'In 2 sentences, explain bid/no-bid for: ' + opp.title + ', Score: ' + Math.round(score) + '/100, Value: $' + opp.value
  );
  await supabase.from('opportunities').update({
    prime_score: Math.round(score),
    status: 'scored',
    scored_at: new Date().toISOString()
  }).eq('id', opp.id);
  await logAction('JUDGE', 'Scored ' + opp.solicitation_number, { score: Math.round(score), rationale });
  console.log('JUDGE: ' + opp.solicitation_number + ' = ' + Math.round(score) + '/100');
}

function calcAlignment(opp) {
  let s = 50;
  const ourNAICS = ['236220','238210','237990','236116','561730','424710','424130','424490','424120'];
  if (ourNAICS.includes(opp.naics)) s += 20;
  const ourStates = ['TX','OK','LA','AR','NM','CO','KS','MO'];
  if (ourStates.includes(opp.state)) s += 15;
  const goodSetAsides = ['Total Small Business','SBA','HUBZone','SDVOSB','8(a)'];
  if (!opp.set_aside || goodSetAsides.some(a => (opp.set_aside||'').includes(a))) s += 15;
  return Math.min(100, s);
}

function calcWinProbability(opp) {
  let s = 50;
  if (opp.value && opp.value < 500000) s += 20;
  else if (opp.value && opp.value < 1500000) s += 10;
  else if (opp.value && opp.value > 5000000) s -= 10;
  if (opp.set_aside && opp.set_aside !== 'None') s += 15;
  if (opp.site_visit_required) s += 10;
  return Math.min(100, Math.max(0, s));
}

function calcFinancial(opp) {
  let s = 50;
  if (opp.value >= 150000 && opp.value <= 2000000) s += 25;
  else if (opp.value >= 50000 && opp.value < 150000) s += 10;
  else if (opp.value > 10000000) s -= 15;
  return Math.min(100, Math.max(0, s));
}

function calcStrategic(opp) {
  let s = 50;
  const strategic = ['ARMY','NAVY','AIR FORCE','VA','GSA','USACE'];
  if (strategic.some(a => (opp.agency||'').toUpperCase().includes(a))) s += 20;
  if ((opp.set_aside||'').includes('8(a)')) s += 15;
  if ((opp.set_aside||'').includes('HUBZone')) s += 10;
  return Math.min(100, s);
}

function calcFeasibility(opp) {
  let s = 70;
  if (['AK','HI','PR','GU'].includes(opp.state)) s -= 20;
  if (opp.deadline) {
    const days = Math.floor((new Date(opp.deadline) - new Date()) / 86400000);
    if (days < 7) s -= 25;
    else if (days < 14) s -= 10;
  }
  return Math.min(100, Math.max(0, s));
}

runJudge();
