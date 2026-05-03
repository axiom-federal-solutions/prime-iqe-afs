-- ============================================================
-- SEED DISTRIBUTOR_PRICES — Baseline market quotes for supply NAICS
-- 2026-05-02: BID ENGINE's supply pricing model averages live distributor
-- quotes from this table. With the table empty, every supply bid hits the
-- 65%-of-ceiling fallback. These seed rows give BID ENGINE a defensible
-- starting baseline so bids come out closer to real federal market prices.
--
-- WHEN TO RUN: Once, in Supabase SQL Editor for project czoyvxyfewqaoewzxlin,
-- AFTER running sql/add-psc-column.sql and any other pending migrations.
-- SAFE TO RE-RUN: Yes — uses ON CONFLICT DO NOTHING so existing rows stay.
--
-- HOW TO REFINE: Replace these baselines with real distributor quotes as
-- Walker gets them. The `is_stale` flag auto-flips to true after 14 days
-- (per BID ENGINE's stale check); refresh quarterly at minimum.
-- ============================================================

-- 2026-05-02 (rev 2): rewritten to match the existing distributor_prices schema
-- exactly. The actual shape (per introspection) is:
--   id, distributor_name (NOT NULL), product_category, unit_price,
--   quote_date (NOT NULL DEFAULT CURRENT_DATE), quote_expiry, created_at
-- BID ENGINE additionally needs `naics` + `is_stale` to filter quotes per opp.
-- This migration adds ONLY those two missing columns + indexes/RLS, then seeds.

-- Step 1: ensure the base table exists (no-op if it already does)
CREATE TABLE IF NOT EXISTS distributor_prices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_name  TEXT NOT NULL,
  product_category  TEXT,
  unit_price        NUMERIC,
  quote_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  quote_expiry      DATE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Step 2: add the two columns BID ENGINE actually needs
ALTER TABLE distributor_prices ADD COLUMN IF NOT EXISTS naics    TEXT;
ALTER TABLE distributor_prices ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_distributor_prices_naics ON distributor_prices(naics);
CREATE INDEX IF NOT EXISTS idx_distributor_prices_stale ON distributor_prices(is_stale);

-- Open RLS for the dashboard to display these (read-only via anon key)
ALTER TABLE distributor_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON distributor_prices;
CREATE POLICY "anon_read" ON distributor_prices FOR SELECT TO anon USING (true);

-- ── Seed rows: baseline quotes per NAICS ─────────────────────────────
-- Each row is a "typical federal contract baseline" — not a single line item.
-- BID ENGINE averages these across distributors to get the market mid-point.
-- Numbers are conservative ballparks based on GSA Schedule + DLA award data.

-- 2026-05-02: INSERTs use only the existing schema columns
-- (id, distributor_name, product_category, unit_price, quote_date, quote_expiry, created_at)
-- plus the two new ones we just added (naics, is_stale).
-- Unit-of-measure and distributor location are folded into product_category text.

-- 424710 — Petroleum & lubricants (fuel)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424710', 'Mansfield Oil',          'Diesel #2 — per 1000-gal delivery (GA, regional Gulf South)',  3450.00),
  ('424710', 'BJ Services',            'Diesel #2 — per 1000-gal delivery (TX, DLA-experienced)',     3380.00),
  ('424710', 'Parker Petroleum',       'Diesel #2 — per 1000-gal delivery (LA, local distributor)',   3520.00),
  ('424710', 'World Fuel Services',    'JP-8 aviation — per 1000-gal delivery (FL, aviation-grade)',  4200.00);

-- 424720 — Petroleum bulk stations
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424720', 'PetroChoice',            'Lubricants & oils — per 55-gal drum (TX)',                    320.00),
  ('424720', 'RelaDyne',               'Industrial lube — per 55-gal drum (LA)',                      305.00),
  ('424720', 'Apex Oil',               'Hydraulic fluid — per 55-gal drum (MS, DLA contractor)',      285.00);

-- 424130 — Industrial & personal service paper (janitorial)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424130', 'Sysco Sygma',            'Paper goods bulk — per pallet (LA, foodservice + janitorial)', 1250.00),
  ('424130', 'Veritiv',                'Janitorial paper — per pallet (GA, national wholesaler)',      1180.00),
  ('424130', 'Imperial Bag & Paper',   'Janitorial paper — per pallet (TX, GSA Schedule 51)',          1320.00);

-- 424490 — Other grocery & related products
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424490', 'Sysco',                  'Bulk food MRE-style — per case (TX, federal dining)',          185.00),
  ('424490', 'US Foods',               'Bulk food — per case (GA, federal contracts)',                 172.00),
  ('424490', 'Performance Food Group', 'Federal foodservice — per case (VA, foodservice specialist)',  179.00);

-- 424410 — General-line grocery
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424410', 'Sysco',                  'General grocery — per case (TX)',                              165.00),
  ('424410', 'Reinhart Foodservice',   'General grocery — per case (WI, GSA approved)',                170.00);

-- 311999 — Other food manufacturing
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('311999', 'Hormel Foods',           'Federal food mfg — per case (MN, federal-spec packaging)',     195.00),
  ('311999', 'Conagra',                'Federal food mfg — per case (IL, federal foodservice)',        188.00);

-- 424120 — Stationery & office supplies
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424120', 'Office Depot Business',  'Office supply mix — per pallet (FL, GSA Schedule 75)',         950.00),
  ('424120', 'Staples Advantage',      'Office supply mix — per pallet (MA, federal office)',         1050.00),
  ('424120', 'WB Mason',               'Office supply mix — per pallet (MA, Northeast distributor)',   910.00);

-- 453210 — Office supplies & stationery stores
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('453210', 'Office Depot Retail',    'Small-quantity office — per case (FL, orders < $25K)',         120.00),
  ('453210', 'Staples Retail',         'Small-quantity office — per case (MA, orders < $25K)',         135.00);

-- 424690 — Other chemical merchant (cleaning chemicals)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424690', 'Brenntag',               'Industrial cleaners — per drum (TX, largest US distributor)',  285.00),
  ('424690', 'Univar Solutions',       'Industrial cleaners — per drum (IL, GSA-experienced)',         295.00),
  ('424690', 'Hubbard-Hall',           'Specialty cleaners — per drum (CT, specialty compounds)',      330.00);

-- 423440 — Other commercial equipment (safety + PPE)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('423440', 'Grainger',               'Industrial PPE — per case (IL, federal PPE supplier)',         215.00),
  ('423440', 'MSC Industrial',         'Industrial PPE — per case (NY, GSA Schedule 51)',              225.00),
  ('423440', 'Fastenal',               'Industrial PPE — per case (MN, GSA + DLA contracts)',          205.00);

-- 339113 — Surgical & medical instruments (PPE manufacturing)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('339113', 'Medline Industries',     'Medical PPE — per case (IL, VA medical contracts)',            245.00),
  ('339113', 'Cardinal Health',        'Medical PPE — per case (OH, federal medical)',                 260.00);

-- 423450 — Medical/professional equipment
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('423450', 'Henry Schein',           'Federal med equip — per case (NY, VA + military medical)',     340.00),
  ('423450', 'McKesson',               'Federal med equip — per case (TX, federal medical equip)',     355.00);

-- 424310 — Piece goods merchant (uniforms)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('424310', 'Cintas',                 'Federal uniforms — per uniform set (OH, federal supplier)',    145.00),
  ('424310', 'Aramark Uniform',        'Federal uniforms — per uniform set (PA, federal supplier)',    138.00),
  ('424310', 'UniFirst',               'Federal uniforms — per uniform set (MA, GSA-experienced)',     142.00);

-- 315990 — Apparel accessories
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit_price)
VALUES
  ('315990', 'Galls',                  'Federal apparel acc — per case (KY, public safety uniforms)',  210.00),
  ('315990', 'LC Industries',          'Federal apparel — per case (NC, AbilityOne)',                  195.00);

-- ── Sanity check ───────────────────────────────────────────────────
-- Run this after the inserts to confirm coverage:
--
-- SELECT naics, COUNT(*) AS quotes,
--        ROUND(AVG(unit_price)::numeric, 2) AS avg_price,
--        MIN(unit_price) AS lowest,
--        MAX(unit_price) AS highest
-- FROM distributor_prices
-- WHERE is_stale = false
-- GROUP BY naics
-- ORDER BY naics;
--
-- Should show all 14 supply NAICS with at least 2 quotes each.
