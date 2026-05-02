# Filter System — Integration Guide

How to wire `filter-system.js` and `filter-system.css` into your existing
single-file dashboard at `index.html`. Targeted, surgical edits — five touch
points total. Estimated time: **15 minutes**.

You'll know it worked when:
- Supply / Construction / Real Estate tabs all have a filter panel on the left
- Clicking a domain header expands its categories
- Clicking a category checkbox filters the opp list AND the state map
- The Command Center has a search bar that finds opps regardless of score
- Opening the dashboard, no console errors

---

## 1) Add the CSS

Open `index.html`. Find the closing `</style>` tag near the top of the file
(around line 290 in the current build). Just before it, paste **the entire
contents** of `dashboard/filter-system.css`.

If you'd rather load it as an external file, you can instead add this in
`<head>`:

```html
<link rel="stylesheet" href="dashboard/filter-system.css">
```

…but inline keeps it consistent with the rest of your single-file deploy.

---

## 2) Add the JS

Find the existing `<script>` block (starts around line 337 with
`// ─── SUPABASE ───`). Scroll to the very end of that block, just before the
closing `</script>` tag. Paste the **entire contents** of
`dashboard/filter-system.js` there.

The script attaches its public functions to `window`, so order doesn't matter
as long as it's before any code that calls `renderFilterPanel`.

---

## 3) Replace the old Supply category logic

Around line **478** you'll find the old `SUPPLY_CATS` block. The old system
runs in parallel to the new one — keep both alive and you'll have two filter
states to debug. Delete it.

**Delete lines 477–524** (everything from the comment
`// ─── SUPPLY CATEGORY FILTER` through the closing brace of
`selectSupplyCat()`):

```js
// ─── SUPPLY CATEGORY FILTER — maps each tab button to specific NAICS prefixes ──
// Used by selectSupplyCat() and filterBySupplyCat() to drill into product categories
const SUPPLY_CATS={
  // ...
};
let activeSupplyCat='all';
function filterBySupplyCat(opps){ /* ... */ }
function selectSupplyCat(key){ /* ... */ }
```

You'll also need to clean up two callers:

### 3a) `renderVertical()` — around line 1903

Replace this block:

```js
function renderVertical(vt){
  // Reset supply category filter each time the vertical re-renders (data refresh)
  if(vt==='supply') activeSupplyCat='all';
  const oppsForVt=OPPS.filter(o=>getVertical(o)===vt);
  // Active pipeline: new + reviewing + pursuing. Passed/expired go to archive.
  const activeOpps=oppsForVt.filter(o=>!o.status||o.status==='new'||o.status==='scored'||o.status==='reviewing'||o.status==='pursuing');
```

…with this (just remove the `activeSupplyCat='all'` line):

```js
function renderVertical(vt){
  const oppsForVt=OPPS.filter(o=>getVertical(o)===vt);
  // Active pipeline: new + reviewing + pursuing. Passed/expired go to archive.
  const activeOpps=oppsForVt.filter(o=>!o.status||o.status==='new'||o.status==='scored'||o.status==='reviewing'||o.status==='pursuing');
```

Then find the supply-specific category bar (starts ~line 1930):

```js
${vt==='supply'?`
<!-- SUPPLY CATEGORY TABS — click to drill into fuel, PPE, office, etc. -->
<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
  ${Object.entries(SUPPLY_CATS).map(([k,v])=>{
    // ...
  }).join('')}
</div>`:''}
```

…and **delete that whole conditional block.** The new filter panel covers all
three verticals — no need for a Supply-only widget.

Then find the opp-list and state-map render section (around line 1953):

```js
<div id="${vt}-opp-list">
${(()=>{
  const listOpps=vt==='supply'?filterBySupplyCat(activeOpps):activeOpps;
  return listOpps.length?listOpps.map(o=>oppRow(o,OPPS.indexOf(o))).join(''):emptyState(`No active ${vt} opportunities`,'Opportunities you pass on move to the Passed Archive. Run SCOUT to pull fresh contracts.');
})()}
</div>
```

Replace the inner expression with the unified filter:

```js
<div id="${vt}-opp-list">
${(()=>{
  const listOpps=filterContracts(activeOpps, vt);
  return listOpps.length?listOpps.map(o=>oppRow(o,OPPS.indexOf(o))).join(''):emptyState(`No active ${vt} opportunities`,'Opportunities you pass on move to the Passed Archive. Run SCOUT to pull fresh contracts.');
})()}
</div>
```

And update the state-map filter at the bottom of `renderVertical`:

```js
// Old:
const mapOpps=vt==='supply'?filterBySupplyCat(activeOpps):activeOpps;

// New:
const mapOpps=filterContracts(activeOpps, vt);
```

### 3b) `vtFilter()` — around line 1965

Replace:

```js
function vtFilter(vt, tier){
  let activeOpps=OPPS.filter(o=>getVertical(o)===vt&&(!o.status||o.status==='new'||o.status==='scored'||o.status==='reviewing'||o.status==='pursuing'));
  // For supply, also apply the active category filter
  if(vt==='supply') activeOpps=filterBySupplyCat(activeOpps);
```

…with:

```js
function vtFilter(vt, tier){
  let activeOpps=OPPS.filter(o=>getVertical(o)===vt&&(!o.status||o.status==='new'||o.status==='scored'||o.status==='reviewing'||o.status==='pursuing'));
  // Apply taxonomy filters first, then score-tier filter
  activeOpps=filterContracts(activeOpps, vt);
```

---

## 4) Add the filter panel into each vertical tab

Inside `renderVertical()`, after the header KPI row and before the state map,
inject a container for the filter panel. The cleanest place is right after
the `<div style="display:flex;justify-content:space-between..."` block.

Find this section in the template literal:

```js
${vt==='supply'?` ... old supply pills here ... `:''}
<div id="${vt[0]}-map"></div><div id="${vt[0]}-detail"></div>
```

(Step 3 already had you delete the old supply pills.) Replace the line with
the state-map div with a two-column wrapper:

```js
<div class="fx-vertical-layout">
  <div id="fx-${vt}"></div>
  <div>
    <div id="${vt[0]}-map"></div>
    <div id="${vt[0]}-detail"></div>
  </div>
</div>
```

Then at the **end** of `renderVertical()`, after the `renderGrid(...)` call,
add a single line to populate the filter panel:

```js
renderFilterPanel(vt, document.getElementById('fx-'+vt), activeOpps);
```

So the bottom of `renderVertical()` looks like:

```js
  // For supply: also filter state map by active category
  const mapOpps=filterContracts(activeOpps, vt);
  renderGrid(document.getElementById(vt[0]+'-map'),buildStateMap(mapOpps,vt),vt);
  // Mount the unified filter panel (Domain → Category → Sub)
  renderFilterPanel(vt, document.getElementById('fx-'+vt), activeOpps);
}
```

---

## 5) Add the search box to the Command Center

Find where the Command Center / `home` tab renders. In your code that's the
`renderHome()` function (or wherever `t-home` gets its innerHTML).

At the **top** of the home content, drop a container:

```html
<div id="fx-command-search"></div>
```

…and right after `el.innerHTML = '...'` add:

```js
renderCommandSearch(document.getElementById('fx-command-search'));
```

If your dashboard has its own opp-detail opener, it'll be picked up
automatically — `_openOppFromSearch` looks for a function named `openDetail`
or `openOpp` on `window`. If yours has a different name, edit
`_openOppFromSearch` at the bottom of `filter-system.js` to call it.

---

## 6) (Optional but recommended) Add a `psc` column to opportunities

The mapping engine prefers PSC (Product Service Code) over NAICS when
classifying — PSC is more specific and yields fewer false positives. SAM.gov
returns it as `classificationCode` on every opportunity, but SCOUT doesn't
currently store it.

### SQL — run once in Supabase SQL Editor:

```sql
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS psc TEXT;
CREATE INDEX IF NOT EXISTS idx_opportunities_psc ON opportunities(psc);
```

### `agents/scout.js` — add to the `upsertOpportunity` payload:

In the existing `supabase.from('opportunities').upsert({...})` call (around
line 440), add one line:

```js
psc:                 opp.classificationCode || opp.psc || null,
```

Once SCOUT runs once after the column is added, every new opp gets a PSC and
the mapping engine starts using it automatically. Old opps fall back to NAICS
+ keywords — also automatic.

---

## 7) Verify

After pasting and reloading:

- [ ] Open the Supply tab — filter panel renders on the left
- [ ] Click "Consumables" header — categories expand
- [ ] Click "Cleaning & Sanitation" — opp list narrows, count badge updates
- [ ] Switch to Construction — filter panel re-renders with construction taxonomy
- [ ] Switch to Real Estate — same, with the RE taxonomy
- [ ] Open Command Center — type "paper" — supply opps with paper products appear
- [ ] Console clean (no `selectSupplyCat is not defined` errors after the deletes)

If you see `selectSupplyCat is not defined`, you missed a caller. Search
`index.html` for `selectSupplyCat(`, `filterBySupplyCat(`, `SUPPLY_CATS`, and
`activeSupplyCat` and remove each remaining reference.

---

## 8) Adding new taxonomy items later

To add a new category (e.g., "Solar / Renewable Energy"), edit
`filter-system.js` only — find the `TAXONOMY` constant near the top, and add:

```js
construction: {
  domains: {
    // ... existing ...
    energy: {                              // ← new domain
      label: '☀️ Renewable Energy',
      icon: '☀️',
      color: 'var(--gold)',
      categories: {
        solar: {
          label: 'Solar PV',
          naics: ['238210','237130'],
          psc: ['Z2BC'],
          keywords: ['solar','photovoltaic','pv array','battery storage'],
          subs: {},
        },
      },
    },
  },
},
```

No UI changes needed. The panel renders dynamically from config. That's the
whole point.

---

## Notes

- **No new dependencies.** Pure vanilla JS. Works with your current Cloudflare
  Pages / GitHub Pages deploy as-is.
- **Memoized classification.** The mapping engine caches per opp so a tab
  with 1,000 opportunities only classifies each one once per session.
- **Future-proof.** When you eventually move to React / a build system, the
  TAXONOMY config and the pure functions (`mapContractToCategories`,
  `filterContracts`, `commandCenterSearch`) port directly — only the UI
  rendering would need rewriting.
- **The Supply tab's NAICS-prefix list in `getVertical()` (line ~526) still
  needs to match the taxonomy.** They serve different purposes:
  `getVertical` decides which tab an opp belongs to; the taxonomy decides
  which Domain/Category within that tab. If you add a new NAICS to the
  taxonomy that isn't in `SUPPLY_NAICS_PREFIXES` or `RE_NAICS_PREFIXES`,
  the opp will land in Construction by default.
