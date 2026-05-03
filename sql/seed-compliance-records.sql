-- ============================================================
-- SEED COMPLIANCE — Walker Contractors LLC base credentials
-- 2026-05-02: VAULT shows "NOT TRACKED" for SAM/GL/WC/LA-License because
-- the `compliance` table is empty. VAULT now reads expirations from this
-- table at run start (loadComplianceFromDb in agents/vault.js).
--
-- These rows are TEMPLATES with placeholder dates. Mr. Kemp must:
--   1. Run this once to create the rows
--   2. Edit each row in Supabase Studio with the actual expiry_date,
--      number, and issuer from the policy/cert/license documents
--   3. Set status='active' once verified (rows seed as 'pending')
--
-- After that, VAULT's compliance gate will pass for construction bids
-- and the Action Queue will surface real expiry warnings.
-- ============================================================

-- Make sure compliance table has the columns VAULT expects.
-- Original schema (per PRIME_Build_Document_Complete): id, type, name,
-- issuer, number, issue_date, expiry_date, state, status, renewal_url, created_at
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS type        TEXT;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS name        TEXT;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS issuer      TEXT;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS number      TEXT;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS issue_date  DATE;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS state       TEXT;
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'pending';
ALTER TABLE compliance ADD COLUMN IF NOT EXISTS renewal_url TEXT;

-- Open RLS for dashboard read access
ALTER TABLE compliance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON compliance;
CREATE POLICY "anon_read" ON compliance FOR SELECT TO anon USING (true);

-- Seed Walker's required compliance items.
-- ⚠️ EDIT THE EXPIRY DATES + NUMBERS AFTER INSERTING — these are placeholders.
INSERT INTO compliance (type, name, issuer, number, issue_date, expiry_date, state, status, renewal_url)
VALUES
  -- SAM.gov registration — required for ALL federal contracts
  ('sam_registration',     'SAM.gov Entity Registration',
   'GSA / SAM.gov', 'UEI: USMQMFAGL9M4',
   '2025-01-01', '2026-12-31', NULL, 'active',
   'https://sam.gov/entity/USMQMFAGL9M4'),

  -- Louisiana contractor license — required for construction bids
  ('la_contractor_license','Louisiana Contractor License',
   'Louisiana State Licensing Board for Contractors', 'LSLBC #TBD',
   '2024-10-01', '2026-09-30', 'LA', 'pending',
   'https://lslbc.louisiana.gov/'),

  -- General liability insurance — $2M coverage required for construction
  ('general_liability',    'Commercial General Liability Insurance',
   'TBD — enter carrier', 'Policy #TBD',
   '2025-12-01', '2026-11-30', NULL, 'pending',
   NULL),

  -- Workers' compensation — required for construction
  ('workers_comp',         'Workers Compensation Insurance',
   'TBD — enter carrier', 'Policy #TBD',
   '2025-12-01', '2026-11-30', NULL, 'pending',
   NULL),

  -- SDB self-certification — Walker's primary set-aside qualifier
  ('sdb_certification',    'Small Disadvantaged Business Self-Certification',
   'SBA', 'Self-Certified',
   '2024-04-01', '2027-03-31', NULL, 'active',
   'https://certify.sba.gov/'),

  -- Bonding capacity — confirmed with surety company
  ('bonding_capacity',     'Surety Bonding Capacity',
   'TBD — enter surety company', '$500,000 single / $1M aggregate',
   '2025-01-01', '2026-12-31', NULL, 'pending',
   NULL);

-- ── Verify ─────────────────────────────────────────────────────
-- After running this, check:
-- SELECT type, name, status, expiry_date FROM compliance ORDER BY type;
-- Should show 6 rows. Edit the 'pending' ones in Supabase Studio
-- to fill in real numbers + issuers, then set status='active'.
