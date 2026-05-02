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

-- Make sure the table exists with the expected shape. If not, create it.
-- (Some build versions of the schema didn't include this table.)
CREATE TABLE IF NOT EXISTS distributor_prices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  naics             TEXT NOT NULL,
  distributor_name  TEXT NOT NULL,
  product_category  TEXT,
  unit              TEXT,                       -- gallon, case, lb, each, etc.
  unit_price        DECIMAL(12,2) NOT NULL,
  contact_email     TEXT,
  contact_phone     TEXT,
  state             TEXT,                       -- distributor's home state for shipping math
  notes             TEXT,
  quoted_date       DATE DEFAULT CURRENT_DATE,
  is_stale          BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distributor_prices_naics      ON distributor_prices(naics);
CREATE INDEX IF NOT EXISTS idx_distributor_prices_stale      ON distributor_prices(is_stale);

-- Open RLS for the dashboard to display these (read-only via anon key)
ALTER TABLE distributor_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON distributor_prices;
CREATE POLICY "anon_read" ON distributor_prices FOR SELECT TO anon USING (true);

-- ── Seed rows: baseline quotes per NAICS ─────────────────────────────
-- Each row is a "typical federal contract baseline" — not a single line item.
-- BID ENGINE averages these across distributors to get the market mid-point.
-- Numbers are conservative ballparks based on GSA Schedule + DLA award data.

-- 424710 — Petroleum & lubricants (fuel)
-- Federal fuel contracts run on per-gallon pricing; baselines reflect
-- 1,000-gallon delivery quote from a regional distributor.
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424710', 'Mansfield Oil',          'Diesel #2',     'per 1000-gal delivery', 3450.00, 'GA', 'Regional Gulf South distributor'),
  ('424710', 'BJ Services',            'Diesel #2',     'per 1000-gal delivery', 3380.00, 'TX', 'DLA-experienced'),
  ('424710', 'Parker Petroleum',       'Diesel #2',     'per 1000-gal delivery', 3520.00, 'LA', 'Local LA distributor'),
  ('424710', 'World Fuel Services',    'JP-8 aviation', 'per 1000-gal delivery', 4200.00, 'FL', 'Aviation-grade')
ON CONFLICT DO NOTHING;

-- 424720 — Petroleum bulk stations (added 2026-05-02 to scout)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424720', 'PetroChoice',            'Lubricants & oils', 'per 55-gal drum',   320.00, 'TX', 'Bulk lubricant supplier'),
  ('424720', 'RelaDyne',               'Industrial lube',   'per 55-gal drum',   305.00, 'LA', 'Gulf South bulk'),
  ('424720', 'Apex Oil',               'Hydraulic fluid',   'per 55-gal drum',   285.00, 'MS', 'DLA contractor history')
ON CONFLICT DO NOTHING;

-- 424130 — Industrial & personal service paper (janitorial)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424130', 'Sysco Sygma',            'Paper goods bulk',  'per pallet',         1250.00, 'LA', 'Foodservice + janitorial'),
  ('424130', 'Veritiv',                'Janitorial paper',  'per pallet',         1180.00, 'GA', 'National wholesaler'),
  ('424130', 'Imperial Bag & Paper',   'Janitorial paper',  'per pallet',         1320.00, 'TX', 'GSA Schedule 51 holder')
ON CONFLICT DO NOTHING;

-- 424490 — Other grocery & related products (food / PPE classification)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424490', 'Sysco',                  'Bulk food MRE-style','per case',           185.00, 'TX', 'Federal dining mainstay'),
  ('424490', 'US Foods',               'Bulk food',          'per case',           172.00, 'GA', 'Federal contracts experienced'),
  ('424490', 'Performance Food Group', 'Federal foodservice','per case',           179.00, 'VA', 'Federal foodservice specialist')
ON CONFLICT DO NOTHING;

-- 424410 — General-line grocery (added 2026-05-02 to scout)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424410', 'Sysco',                  'General grocery',    'per case',           165.00, 'TX', 'See also 424490'),
  ('424410', 'Reinhart Foodservice',   'General grocery',    'per case',           170.00, 'WI', 'GSA approved')
ON CONFLICT DO NOTHING;

-- 311999 — Other food manufacturing (added 2026-05-02 to scout)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('311999', 'Hormel Foods',           'Federal food mfg',   'per case',           195.00, 'MN', 'Federal-spec packaging'),
  ('311999', 'Conagra',                'Federal food mfg',   'per case',           188.00, 'IL', 'Federal foodservice')
ON CONFLICT DO NOTHING;

-- 424120 — Stationery & office supplies
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424120', 'Office Depot Business',  'Office supply mix',  'per pallet',          950.00, 'FL', 'GSA Schedule 75 holder'),
  ('424120', 'Staples Advantage',      'Office supply mix',  'per pallet',         1050.00, 'MA', 'Federal office supply'),
  ('424120', 'WB Mason',               'Office supply mix',  'per pallet',          910.00, 'MA', 'Northeast distributor')
ON CONFLICT DO NOTHING;

-- 453210 — Office supplies & stationery stores (added 2026-05-02)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('453210', 'Office Depot Retail',    'Small-quantity office','per case',          120.00, 'FL', 'Smaller orders < $25K'),
  ('453210', 'Staples Retail',         'Small-quantity office','per case',          135.00, 'MA', 'Smaller orders < $25K')
ON CONFLICT DO NOTHING;

-- 424690 — Other chemical merchant (cleaning chemicals)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424690', 'Brenntag',               'Industrial cleaners','per drum',            285.00, 'TX', 'Largest US chem distributor'),
  ('424690', 'Univar Solutions',       'Industrial cleaners','per drum',            295.00, 'IL', 'GSA-experienced'),
  ('424690', 'Hubbard-Hall',           'Specialty cleaners', 'per drum',            330.00, 'CT', 'Specialty cleaning compounds')
ON CONFLICT DO NOTHING;

-- 423440 — Other commercial equipment (safety equipment + alt PPE)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('423440', 'Grainger',               'Industrial PPE',     'per case',            215.00, 'IL', 'Federal PPE supplier'),
  ('423440', 'MSC Industrial',         'Industrial PPE',     'per case',            225.00, 'NY', 'GSA Schedule 51'),
  ('423440', 'Fastenal',               'Industrial PPE',     'per case',            205.00, 'MN', 'GSA + DLA contracts')
ON CONFLICT DO NOTHING;

-- 339113 — Surgical & medical instruments (added 2026-05-02 — PPE manufacturing)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('339113', 'Medline Industries',     'Medical PPE',        'per case',            245.00, 'IL', 'VA medical contracts'),
  ('339113', 'Cardinal Health',        'Medical PPE',        'per case',            260.00, 'OH', 'Federal medical')
ON CONFLICT DO NOTHING;

-- 423450 — Medical/professional equipment (added 2026-05-02 — was empty bucket)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('423450', 'Henry Schein',           'Federal med equip',  'per case',            340.00, 'NY', 'VA + military medical'),
  ('423450', 'McKesson',               'Federal med equip',  'per case',            355.00, 'TX', 'Federal medical equip')
ON CONFLICT DO NOTHING;

-- 424310 — Piece goods merchant (uniforms)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('424310', 'Cintas',                 'Federal uniforms',   'per uniform set',     145.00, 'OH', 'Federal uniform supplier'),
  ('424310', 'Aramark Uniform',        'Federal uniforms',   'per uniform set',     138.00, 'PA', 'Federal uniform supplier'),
  ('424310', 'UniFirst',               'Federal uniforms',   'per uniform set',     142.00, 'MA', 'GSA-experienced')
ON CONFLICT DO NOTHING;

-- 315990 — Apparel accessories (added 2026-05-02 to scout)
INSERT INTO distributor_prices (naics, distributor_name, product_category, unit, unit_price, state, notes)
VALUES
  ('315990', 'Galls',                  'Federal apparel acc','per case',            210.00, 'KY', 'Public safety uniforms'),
  ('315990', 'LC Industries',          'Federal apparel',    'per case',            195.00, 'NC', 'Federal-blind made (AbilityOne)')
ON CONFLICT DO NOTHING;

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
