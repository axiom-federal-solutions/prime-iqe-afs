---
name: no-human-build
description: "Deploy the complete PRIME Government Contracting acquisition system from zero — Supabase DB, 10 agents, 19 GitHub Actions workflows, and the IQE dashboard — with no human input except providing API keys."
---

# NO_HUMAN_BUILD — PRIME IQE Full Deploy Skill

**System**: PRIME IQE — Intelligent Acquisition Engine  
**Owner**: Axiom Federal Solutions / Walker Contractors LLC · CAGE 7JKKO  
**Email**: PrimeOpps1@gmail.com  
**Cost**: ~$9.50/month  
**Verticals**: Construction · Supply Chain · Real Estate & Rental  
**NAICS Codes**: 32 (21 construction, 7 supply, 4 real estate)

---

## WHAT THIS SKILL DOES

Deploys the complete PRIME system end-to-end with no human intervention. Given a GitHub repo, a Supabase project, and API keys as secrets, this skill:

1. Runs the full database schema (30 tables)
2. Verifies all agent files are present and syntactically valid
3. Confirms GitHub Actions workflows are wired to correct secrets
4. Triggers SCOUT to run and validate it produces opportunities
5. Triggers JUDGE to score and confirms scores appear in DB
6. Triggers T.E.S.T. and confirms 18/20 tests pass (DB_HEALTH and AUTH must be 100%)
7. Triggers BRANDI and confirms email is delivered
8. Opens the IQE dashboard and confirms live data loads

---

## REQUIRED SECRETS (set in GitHub → Settings → Secrets → Actions)

| Secret | Source | Notes |
|--------|--------|-------|
| `SUPABASE_URL` | Supabase project settings | https://czoyvxyfewqaoewzxlin.supabase.co |
| `SUPABASE_ANON_KEY` | Supabase project settings → API | anon public key |
| `SAM_API_KEY` | api.sam.gov → Account → API Keys | Free, 450 calls/day |
| `SENDGRID_API_KEY` | sendgrid.com → Settings → API Keys | Free tier → 100 emails/day |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Haiku ~$0.05/day |
| `USASPENDING_API_KEY` | api.usaspending.gov (public, no key needed) | Optional |

---

## STEP 1 — VERIFY REPO STRUCTURE

Run this check. All files must exist:

```
agents/
  brandi.js       ← BRANDI: Daily brief, weekly digest, critical alerts
  scout.js        ← SCOUT: SAM.gov + DLA DIBBS scanner, 32 NAICS
  judge.js        ← JUDGE: PRIME Score, ACQ Score, LEASE Score
  vault.js        ← VAULT: Compliance engine (bonds, Davis-Bacon, certs)
  recon.js        ← RECON: Market intel, supplier matching, OSDBU
  draft.js        ← DRAFT: Proposal generator (construction + supply)
  bidengine.js    ← BID ENGINE: Labor + materials + bond pricing
  test.js         ← T.E.S.T.: 20 automated validation tests
  ledger-monthly.js
  exec-costs.js
  exec-payroll.js
  exec-prompt-payment.js
  exec-retainage.js
lib/
  supabase.js     ← Shared DB client + logAction + getConfig + setConfig
  claude.js       ← Anthropic client wrapper with cost-guard
  sendgrid.js     ← SendGrid email wrapper
.github/workflows/
  scout-sam.yml
  scout-state-portals.yml
  judge-score.yml
  brandi-daily.yml
  brandi-weekly.yml
  vault-check.yml
  recon-intel.yml
  recon-suppliers.yml
  draft-proposal.yml
  bidengine-price.yml
  exec-costs.yml
  exec-payroll.yml
  exec-retainage.yml
  exec-prompt-payment.yml
  ledger-monthly.yml
  test-validation.yml
  recon-congress.yml
  recon-gao.yml
  recon-osdbu.yml (19 total)
index.html        ← IQE PRIME v19 dashboard
evals/
  test-cases.json ← 20 T.E.S.T. eval cases with remediation
  eval-viewer.html← Interactive eval browser
sql/
  schema-gap-fix.sql
  create-all-tables.sql
package.json
.env.example
```

---

## STEP 2 — DATABASE SETUP

Run in Supabase SQL Editor (project czoyvxyfewqaoewzxlin):

```sql
-- Run schema-gap-fix.sql first
-- Creates: suppliers, supplier_matches, test_results, api_schemas
-- Adds: vertical column to opportunities, pre_prime_score column

-- Then verify:
SELECT table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS col_count
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
-- Should return 30 tables
```

Critical columns to verify on `opportunities`:
- `vertical` (text, default 'construction')
- `pre_prime_score` (integer) — SCOUT writes rough estimate
- `prime_score` (integer) — JUDGE owns exclusively
- `acq_score` (integer) — JUDGE owns exclusively
- `lease_score` (integer) — JUDGE owns exclusively
- `raw_data` (jsonb) — nulled out by JUDGE after scoring

---

## STEP 3 — VALIDATE AGENT CODE

Key patterns each agent MUST use:

### SCOUT (scout.js)
```javascript
// NAICS dedup Map — prevents double-scoring
const rawBySOL = new Map(); // solicitation_number → { opp, naics }

// Quota soft cap — skip low-priority NAICS when over 600 calls
const SAM_QUOTA_SOFT_CAP = 600;
const LOW_PRIORITY_NAICS = new Set(['238350','237110','238160','238110','562910','424310','424120']);

// Writes to pre_prime_score, NOT prime_score
await supabase.from('opportunities').upsert({
  pre_prime_score: roughScore, // ← SCOUT writes here
  // prime_score: NOT SET — JUDGE owns this
});
```

### BRANDI (brandi.js)
```javascript
// MUST use .eq('vertical', vertical) NOT .eq('type', vertical)
const { data } = await supabase.from('opportunities')
  .select('*')
  .eq('vertical', 'construction')  // ← correct column name
  .gte('prime_score', 75)
  .order('prime_score', { ascending: false })
  .limit(5);

// MUST use Promise.all for parallel fetch
const [topOpps, urgent, pending, vaultIssues, costData] = await Promise.all([
  getTopOpportunities('construction', 5),
  getUrgentOpportunities(48),
  getPendingApprovals(),
  getVaultIssues(),
  getMonthlySpend(),
]);
```

### JUDGE (judge.js)
```javascript
// Null out raw_data after scoring — prevents DB bloat
const updatePayload = {
  prime_score: score,
  raw_data: null,          // ← always null after scoring
  score_factors: factors,
  scored_at: new Date().toISOString(),
};
```

---

## STEP 4 — TRIGGER SEQUENCE

Run in this exact order (GitHub Actions → Run workflow):

```
1. test-validation.yml     → Verify DB health before anything else
                            → Must: DB_HEALTH = 100%, AUTH = 100%
2. scout-sam.yml           → Scan SAM.gov for all 32 NAICS codes
                            → Expect: 50-150 new opportunities
3. judge-score.yml         → Score all unscored opportunities
                            → Expect: prime_score populated, raw_data = null
4. recon-suppliers.yml     → Build supplier match database
                            → Expect: supplier_matches populated
5. brandi-daily.yml        → Send morning brief
                            → Expect: email at PrimeOpps1@gmail.com within 5 min
6. test-validation.yml     → Final health check after all agents ran
                            → Expect: 18+/20 tests pass
```

---

## STEP 5 — DASHBOARD VALIDATION

Open `index.html` in Chrome. Verify:

- [ ] Supabase connection: "Updated HH:MM" appears in sidebar (not "⚠ Load error")
- [ ] KPI cards: Total Opps > 0
- [ ] Opportunities tab: rows appear with color-coded left borders
- [ ] pre_prime_score: unscored opps show `~{score}` in amber (EST label)
- [ ] prime_score: JUDGE-scored opps show score in colored circle
- [ ] System tab: SAM Quota bar shows 0-450, T.E.S.T. pass rate appears
- [ ] Agent cards: SCOUT, JUDGE, BRANDI show last run timestamp

---

## STEP 6 — VERIFY T.E.S.T. RESULTS

After full trigger sequence, open Supabase → Table Editor → test_results.

**MUST BE GREEN (no failures tolerated):**
- `db_all_tables_accessible` — all 30 tables OK
- `db_audit_log_active` — agents have run
- `scout_sam_key_present` — SAM_API_KEY present
- `api_sam_gov_auth` — SAM.gov returns 200

**EXPECTED GREEN (first run may miss):**
- `brandi_email_sent` — needs one full BRANDI run
- `supplier_db_populated` — needs one RECON run
- `judge_score_calibration` — needs 10+ scored opportunities

**ACCEPTABLE YELLOW on first deploy:**
- `judge_no_null_after_scoring` — populates after JUDGE runs
- `api_sam_gov_schema` — populates after first SCOUT run

---

## COST BREAKDOWN (~$9.50/month)

| Service | Cost | Usage |
|---------|------|-------|
| Supabase | $0 | Free tier (30 tables, 500MB) |
| GitHub Actions | $0 | Free public repo (2,000 min/mo) |
| Claude Haiku | ~$1.50 | Bulk scoring (JUDGE) — ~30K tokens/day |
| Claude Sonnet | ~$3.00 | Proposals (DRAFT) — ~10K tokens/run |
| SendGrid | $0 | Free tier (100 emails/day) |
| SAM.gov API | $0 | Free (450 calls/day) |
| USASpending | $0 | Free (public API) |
| **Total** | **~$4.50–9.50** | Varies by proposal volume |

---

## TROUBLESHOOTING QUICK REFERENCE

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| All vertical counts = 0 in BRANDI brief | brandi.js using `.eq('type',v)` instead of `.eq('vertical',v)` | Change to `.eq('vertical', vertical)` |
| pre_prime_score column missing | Schema not updated | Run `ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pre_prime_score integer` |
| DLA DIBBS returns 0 inserts | HTML scrape broken | Use RSS feed: `https://www.dibbs.bsm.dla.mil/solicitations/rss/` |
| Duplicate opportunities in DB | NAICS dedup Map missing | Add `const rawBySOL = new Map()` before NAICS loop in scout.js |
| SAM API quota exceeded | No soft cap | Add `SAM_QUOTA_SOFT_CAP = 600` and skip `LOW_PRIORITY_NAICS` above it |
| DB bloat from raw_data | JUDGE not nulling raw_data | Add `raw_data: null` to JUDGE updatePayload |
| Dashboard loads slow | Sequential Supabase queries | Wrap all queries in `Promise.all([...])` |
| T.E.S.T. HALT fires on first run | Auth or DB_HEALTH failed | Check secrets in GitHub, verify all 30 tables exist |

---

## SECURITY RULES (never violate)

- Never hardcode API keys — environment variables only
- Never expose SUPABASE_SERVICE_ROLE_KEY in frontend code
- Never log tokens, passwords, or personal info
- Rate limit all API calls with retry logic
- Kill switch: set `SYSTEM_HALT=true` in system_config to stop all agents
- Cost guard: check cumulative Claude spend before each LLM call
- All SAM.gov data treated as public — no PII concerns

---

## AGENT STATUS LEGEND

In the IQE dashboard → System tab:
- 🟢 Green dot = agent ran in last 24h
- ⚫ Dark dot = agent never run (normal on first deploy)
- HALT badge = T.E.S.T. disabled this agent — fix root cause, set `AGENT_X_ENABLED=true` in system_config

---

*Generated: 2026-04-28 · PRIME IQE v19 · Axiom Federal Solutions*
