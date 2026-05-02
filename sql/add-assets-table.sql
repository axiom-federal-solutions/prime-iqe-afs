-- ============================================================
-- ADD ASSETS TABLE — Real Estate & Rental ownership records
-- 2026-05-02: required by VAULT to clear the real estate compliance gate.
-- Previously VAULT queried the `compliance` table for asset ownership, but
-- that table is for certs/licenses/insurance — there was no schema for
-- recording owned properties or equipment, so every RE bid failed the gate.
--
-- WHEN TO RUN: Once, in Supabase SQL Editor for project czoyvxyfewqaoewzxlin.
-- SAFE TO RE-RUN: Yes — IF NOT EXISTS guards prevent duplicates.
-- ============================================================

CREATE TABLE IF NOT EXISTS assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What kind of asset this is — drives which RE NAICS codes can claim it
  asset_type      TEXT NOT NULL,
    -- expected values:
    --   'residential_property'    → matches NAICS 531110, 531311
    --   'commercial_property'     → matches NAICS 531120, 531312, 531190
    --   'land'                    → matches NAICS 531190
    --   'construction_equipment'  → matches NAICS 532412
    --   'truck_fleet'             → matches NAICS 532120
    --   'real_estate_advisory'    → matches NAICS 531210, 531390 (services, not physical)

  name            TEXT NOT NULL,           -- "Baton Rouge Office Tower" / "CAT 320 Excavator" / etc.
  address         TEXT,                    -- physical location (for property)
  city            TEXT,
  state           TEXT,                    -- 2-letter code so VAULT can match against opp.state
  zip             TEXT,

  -- Ownership / lease term
  ownership_type  TEXT DEFAULT 'owned',    -- 'owned' | 'leased' | 'managed' | 'agreement_pending'
  acquired_date   DATE,
  current_value   DECIMAL(12,2),

  -- For equipment / vehicles
  make            TEXT,
  model           TEXT,
  year            INTEGER,
  serial_or_vin   TEXT,

  -- For property leases / management agreements with third-party owners
  owner_name      TEXT,                    -- if Walker manages but doesn't own
  lease_term_yrs  INTEGER,
  lease_start     DATE,
  lease_end       DATE,

  -- Insurance / compliance attached to this asset
  insurance_carrier TEXT,
  insurance_expiry  DATE,
  insurance_limit   DECIMAL(12,2),

  -- Status drives whether VAULT will accept this for bid eligibility
  status          TEXT DEFAULT 'active',   -- 'active' | 'pending' | 'inactive' | 'sold'
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_type   ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_state  ON assets(state);

COMMENT ON TABLE assets IS
  'Walker Contractors real estate, equipment, and vehicle assets. VAULT '
  'reads this to clear the real estate compliance gate — no row = no bid. '
  'Mr. Kemp adds rows manually via Supabase Studio or future PRIME UI.';

-- ── RLS — allow anon read so dashboard can show owned-assets badges,
--    but only service role can modify. Matches the rest of the system.
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON assets;
CREATE POLICY "anon_read" ON assets FOR SELECT TO anon USING (true);

-- ── SEED HINT ────────────────────────────────────────────────────────
-- Once the table is created, add Walker's actual assets here. Examples:
--
-- INSERT INTO assets (asset_type, name, city, state, ownership_type, current_value)
-- VALUES
--   ('commercial_property', 'Walker HQ Building',     'New Orleans', 'LA', 'owned',  450000),
--   ('construction_equipment', 'CAT 320 Excavator',   'New Orleans', 'LA', 'owned',  120000),
--   ('truck_fleet',         'Ford F-350 Crew Cab',    'New Orleans', 'LA', 'owned',   65000),
--   ('real_estate_advisory','Trevor Monnie Partnership','Baton Rouge','LA','agreement_pending', NULL);
--
-- Without at least one row matching the bid's asset type, every real estate
-- bid will be marked INELIGIBLE by VAULT.
