// =============================================================
// FILTER-SYSTEM.JS — Unified taxonomy filtering for PRIME Dashboard
// JOB:  One filter pipeline for Construction, Supply, Real Estate.
//       Three-tier hierarchy (Domain → Category → Sub-category).
//       Config-driven — taxonomy edits never touch UI code.
//       Replaces the old SUPPLY_CATS / selectSupplyCat / filterBySupplyCat
//       pair so we never run two filter systems in parallel.
// USED BY: index.html — paste this block once, then call:
//       renderFilterPanel('supply', containerEl)
//       filterContracts(opps, 'supply')
//       commandCenterSearch(query)
// =============================================================

// ─────────────────────────────────────────────────────────────
// 1) TAXONOMY CONFIG — single source of truth for all 3 verticals
//    Each domain rolls up a meaningful customer-facing bucket.
//    Each category maps to NAICS prefix(es) + optional PSC prefix(es)
//    + optional keyword fallback for opps with weak/missing classification.
//    Sub-categories are optional; leave empty array if not needed.
// ─────────────────────────────────────────────────────────────
const TAXONOMY = {

  supply: {
    label: '📦 Supply',
    color: 'var(--cyan)',
    domains: {
      consumables: {
        label: '🧴 Consumables',
        icon: '🧴',
        color: 'var(--cyan)',
        categories: {
          cleaning: {
            label: 'Cleaning & Sanitation',
            naics: ['561720','424130'],
            psc:   ['7930','7910'],     // PSC Group 79 = Cleaning Equipment & Supplies
            keywords: ['janitorial','cleaning','disinfectant','sanitiz','restroom','floor care','soap','detergent'],
            subs: {
              janitorial:    { label:'Janitorial Supplies',   keywords:['paper towel','toilet','tissue','wipes','mop','broom'] },
              dispensers:    { label:'Dispensers & Equipment', keywords:['dispenser','vacuum','scrubber'] },
            },
          },
          chemicals: {
            label: 'Industrial Chemicals',
            naics: ['424690'],
            psc:   ['6810','6850'],
            keywords: ['chemical','solvent','degreaser','lubricant','cleaning compound'],
            subs: {},
          },
          food: {
            label: 'Food & Beverage',
            naics: ['424490','311999'],
            psc:   ['8970','8915','8920','8925','8945','8950','8955','8960'],
            // 2026-05-02: added MRE/galley/dfac/troops + federal foodservice terminology
            keywords: ['food','beverage','dining','meal','coffee','snack','catering','grocer',
                       'mre','galley','dfac','dining facility','troop subsistence','fresh fruit and vegetable',
                       'subsistence','prime vendor','lunch','breakfast','vending'],
            subs: {
              dining:   { label:'Dining Services',   keywords:['cafeteria','dining hall','meal plan','catering','dfac','galley','mess hall'] },
              bulk:     { label:'Bulk Supplies',     keywords:['bulk','case','pallet','wholesale','prime vendor','subsistence'] },
            },
          },
          office: {
            label: 'Office & Stationery',
            naics: ['424120','453210'],
            psc:   ['7510','7520','7530','7540'],
            // 2026-05-02: added GSA Schedule, BPA, Schedule 75, MAS terminology
            keywords: ['office supplies','paper','toner','ink','pen','notebook','envelope','copy paper','printer paper',
                       'gsa schedule 75','bpa','blanket purchase','federal supply schedule','fss','mas',
                       'multiple award schedule','sin','schedule 75','consumable','abilityone','jwod'],
            subs: {},
          },
        },
      },
      energy: {
        label: '⛽ Energy & Fuel',
        icon: '⛽',
        color: 'var(--amber)',
        categories: {
          petroleum: {
            label: 'Petroleum & Lubricants',
            naics: ['424710','424720'],
            psc:   ['9130','9140','9150','9160'],
            keywords: ['fuel','diesel','gasoline','jet fuel','jp-8','kerosene','oil','lubricant','grease'],
            subs: {
              motor:     { label:'Motor Fuels',  keywords:['diesel','gasoline','unleaded'] },
              aviation:  { label:'Aviation Fuel', keywords:['jet','jp-8','jp-5','aviation'] },
              lubricants:{ label:'Lubricants',   keywords:['lubricant','grease','hydraulic fluid'] },
            },
          },
        },
      },
      protection: {
        label: '🦺 Personal Protection',
        icon: '🦺',
        color: 'var(--green)',
        categories: {
          ppe: {
            label: 'PPE',
            naics: ['339113','423440'],
            psc:   ['8415','8470','4240'],
            keywords: ['ppe','gloves','mask','respirator','hard hat','goggles','face shield'],
            subs: {},
          },
          safety: {
            label: 'Safety Equipment',
            naics: ['423450'],
            psc:   ['4220','4230','4240','4250'],
            keywords: ['safety','first aid','fire extinguisher','harness','fall protection','warning'],
            subs: {},
          },
        },
      },
      apparel: {
        label: '👔 Apparel & Textiles',
        icon: '👔',
        color: 'var(--violet)',
        categories: {
          uniforms: {
            label: 'Uniforms',
            naics: ['424310','315990'],
            psc:   ['8405','8410','8420','8425','8435','8440','8445'],
            keywords: ['uniform','clothing','apparel','boots','footwear','jacket','coverall'],
            subs: {},
          },
        },
      },
    },
  },

  construction: {
    label: '🏗️ Construction',
    color: 'var(--green)',
    domains: {
      buildings: {
        label: '🏢 Whole Buildings',
        icon: '🏢',
        color: 'var(--green)',
        categories: {
          commercial: {
            label: 'Commercial & Institutional',
            naics: ['236220'],
            psc:   ['Y1AA','Y1BB','Y1AZ','Y1BZ','Z1AA','Z1AZ'],
            // 2026-05-02: added federal contracting vocabulary
            keywords: ['construction','renovation','building','facility','office building','headquarters',
                       'milcon','military construction','usace','navfac','matoc','idiq','sabre',
                       'design-bid-build','sustainment','modernization','recapitalization','spawar',
                       'p-xxx project','vamc','medical center construction'],
            subs: {
              new_constr: { label:'New Construction', keywords:['new construction','design-build','construct','greenfield','sabre'] },
              renovation: { label:'Renovation/Reno',   keywords:['renovation','remodel','rehab','retrofit','restoration','recapitalization','modernization'] },
              repair:     { label:'Repair',            keywords:['repair','replace','restore','sustainment','jocd'] },
            },
          },
          multifamily: {
            label: 'Multifamily Housing',
            naics: ['236116'],
            psc:   ['Y1HA','Z1HA'],
            keywords: ['housing','barracks','dormitory','quarters','multifamily','apartment'],
            subs: {},
          },
          industrial: {
            label: 'Industrial Building',
            naics: ['236210'],
            psc:   ['Y1JZ','Y1NA','Z1JZ','Z1NA'],
            keywords: ['warehouse','depot','industrial','manufacturing facility','hangar'],
            subs: {},
          },
        },
      },
      trades: {
        label: '🔧 Building Trades',
        icon: '🔧',
        color: 'var(--cyan)',
        categories: {
          electrical: {
            label: 'Electrical',
            naics: ['238210'],
            psc:   ['Y1KA','Z1KA','J061'],
            keywords: ['electrical','wiring','lighting','power','transformer','switchgear','generator'],
            subs: {
              lighting: { label:'Lighting',           keywords:['lighting','luminaire','led'] },
              power:    { label:'Power Distribution', keywords:['transformer','switchgear','distribution','panel','circuit'] },
            },
          },
          mechanical: {
            label: 'Plumbing / HVAC',
            naics: ['238220'],
            psc:   ['Y1KB','Z1KB','J041','J043'],
            keywords: ['hvac','heating','cooling','plumbing','ventilation','chiller','boiler','air handling','pipe'],
            subs: {
              hvac:    { label:'HVAC',          keywords:['hvac','chiller','boiler','air handler','rtu','condenser'] },
              plumbing:{ label:'Plumbing',      keywords:['plumbing','piping','fixture','drain','water line'] },
            },
          },
          drywall: {
            label: 'Drywall & Insulation',
            naics: ['238310'],
            psc:   ['Y1QA','Z1QA'],
            keywords: ['drywall','insulation','sheetrock','gypsum','partition'],
            subs: {},
          },
          painting: {
            label: 'Painting',
            naics: ['238320'],
            psc:   ['Y1QB','Z1QB'],
            keywords: ['paint','coating','sealant','epoxy floor','protective coating'],
            subs: {},
          },
          flooring: {
            label: 'Flooring',
            naics: ['238330'],
            psc:   ['Y1QC','Z1QC'],
            keywords: ['flooring','tile','carpet','vinyl','epoxy','floor'],
            subs: {},
          },
          finish: {
            label: 'Finish Carpentry / Millwork',
            naics: ['238350'],
            psc:   ['Y1QD','Z1QD'],
            keywords: ['millwork','cabinetry','finish carpentry','trim','molding'],
            subs: {},
          },
        },
      },
      site: {
        label: '🚧 Site Work',
        icon: '🚧',
        color: 'var(--amber)',
        categories: {
          site_prep: {
            label: 'Site Preparation',
            naics: ['238910'],
            psc:   ['Y1MA','Z1MA'],
            keywords: ['excavation','grading','demolition','site prep','clearing','earthwork'],
            subs: {},
          },
          concrete: {
            label: 'Concrete & Foundations',
            naics: ['238110'],
            psc:   ['Y1LA','Z1LA'],
            keywords: ['concrete','foundation','slab','pour','footing','rebar'],
            subs: {},
          },
          roofing: {
            label: 'Roofing',
            naics: ['238160'],
            psc:   ['Y1NA','Z1NA'],
            keywords: ['roof','roofing','membrane','tpo','epdm','flashing','gutter'],
            subs: {},
          },
        },
      },
      civil: {
        label: '🌉 Heavy Civil',
        icon: '🌉',
        color: 'var(--rose)',
        categories: {
          highway: {
            label: 'Highway / Bridge',
            naics: ['237310'],
            psc:   ['Y1DA','Y1DB','Z1DA','Z1DB'],
            keywords: ['highway','road','bridge','pavement','asphalt','culvert'],
            subs: {},
          },
          water: {
            label: 'Water / Sewer Line',
            naics: ['237110'],
            psc:   ['Y1FA','Z1FA'],
            keywords: ['water line','sewer','utility','main','wastewater','potable'],
            subs: {},
          },
          civil_other: {
            label: 'Other Heavy & Civil',
            naics: ['237990'],
            psc:   ['Y1GA','Z1GA'],
            keywords: ['heavy civil','dam','dredging','railroad','airfield','levee'],
            subs: {},
          },
        },
      },
      specialty: {
        label: '⚙️ Specialty & Support',
        icon: '⚙️',
        color: 'var(--violet)',
        categories: {
          remediation: {
            label: 'Remediation',
            naics: ['562910'],
            psc:   ['F108','F999'],
            keywords: ['remediation','asbestos','lead abatement','mold','hazmat','environmental'],
            subs: {},
          },
          engineering: {
            label: 'Engineering Services',
            naics: ['541330'],
            psc:   ['C111','C211','R408','R413'],
            keywords: ['engineering services','design','architectural','structural engineering'],
            subs: {},
          },
          facilities: {
            label: 'Facilities Support',
            naics: ['561210'],
            psc:   ['S201','S204','S299'],
            // 2026-05-02: BOS, BOSS, FACOPS, FRP, sustainment vocabulary
            keywords: ['facilities support','base operations','base ops','om&m','operations and maintenance',
                       'bos','boss','facops','base operating support','om&s','o&m','sustainment','facility maintenance',
                       'logcap','frp','full range of products','facility services','janitorial services'],
            subs: {},
          },
          // 2026-05-02: removed Janitorial Services from construction.
          // 561720 routes to the SUPPLY tab via getVertical() / SUPPLY_NAICS_PREFIXES.
          // Putting it here too caused a permanently empty bucket. If you want
          // janitorial visible in the construction tab, change SUPPLY_NAICS_PREFIXES
          // first — don't dual-list the NAICS.
          landscaping: {
            label: 'Landscaping',
            naics: ['561730'],
            psc:   ['S208'],
            keywords: ['landscaping','grounds','mowing','tree','horticult','landscape maintenance'],
            subs: {},
          },
          other_specialty: {
            label: 'Other Specialty Trade',
            naics: ['238990'],
            psc:   ['Y1QZ','Z1QZ'],
            keywords: ['specialty trade','renovation specialty','specialty contractor'],
            subs: {},
          },
        },
      },
    },
  },

  realestate: {
    label: '🏢 Real Estate & Rental',
    color: 'var(--rose)',
    domains: {
      leasing: {
        label: '📑 Leasing',
        icon: '📑',
        color: 'var(--rose)',
        categories: {
          office: {
            label: 'Office / Nonresidential',
            naics: ['531120'],
            psc:   ['X1AA','X1BA','X1DA'],
            // 2026-05-02: added GSA-specific lease terminology
            keywords: ['lease','office space','warehouse lease','nonresidential lease','gsa lease',
                       'rlp','request for lease proposal','solicitation for offers','sfo',
                       'full service','fully serviced','occupancy','build-to-suit','lease replacement',
                       'gsa form 1364','tenant improvement','ti allowance','noi','rentable square feet','rsf','usf'],
            subs: {
              gsa:    { label:'GSA Office Lease',  keywords:['gsa','general services administration','rlp','sfo','build-to-suit'] },
              military:{label:'Military / Federal', keywords:['army','navy','air force','dod','federal','jbab','navfac']},
            },
          },
          residential: {
            label: 'Residential',
            naics: ['531110'],
            psc:   ['X1HA'],
            // 2026-05-02: added BAH, MHPI, RCI terminology
            keywords: ['residential lease','housing','quarters','barracks','family housing','privatized housing',
                       'bah','basic allowance for housing','mhpi','military housing privatization','rci',
                       'unaccompanied housing','dormitory','furnished housing','tlf','transient lodging'],
            subs: {},
          },
          land: {
            label: 'Land / Other',
            naics: ['531190'],
            psc:   ['X1JA','X1ZZ'],
            keywords: ['land lease','parking','outdoor','easement','ground lease'],
            subs: {},
          },
        },
      },
      property_mgmt: {
        label: '🏘️ Property Management',
        icon: '🏘️',
        color: 'var(--green)',
        categories: {
          residential_pm: {
            label: 'Residential PM',
            naics: ['531311'],
            psc:   ['S299'],
            keywords: ['residential property management','housing management','bah','family housing management'],
            subs: {},
          },
          nonres_pm: {
            label: 'Nonresidential PM',
            naics: ['531312'],
            psc:   ['S299'],
            keywords: ['property management','facility management','facilities management','base operations'],
            subs: {},
          },
        },
      },
      brokerage: {
        label: '💼 Brokerage & Advisory',
        icon: '💼',
        color: 'var(--gold)',
        categories: {
          brokers: {
            label: 'Real Estate Brokers',
            naics: ['531210'],
            psc:   ['R420','R699'],
            keywords: ['real estate broker','real estate agent','tenant representation','site selection'],
            subs: {},
          },
          re_other: {
            label: 'Other RE Activities',
            naics: ['531390'],
            psc:   ['R420','R699'],
            keywords: ['appraisal','title','valuation','real estate advisory','escrow'],
            subs: {},
          },
        },
      },
      rental: {
        label: '🚛 Equipment Rental',
        icon: '🚛',
        color: 'var(--cyan)',
        categories: {
          construction_eq: {
            label: 'Construction Equipment',
            naics: ['532412'],
            psc:   ['W039','W099'],
            keywords: ['equipment rental','heavy equipment','construction equipment','crane rental','generator rental'],
            subs: {},
          },
          vehicles: {
            label: 'Trucks / Vehicles / RVs',
            naics: ['532120'],
            psc:   ['W023','W024'],
            keywords: ['truck rental','vehicle rental','fleet rental','rv rental','trailer rental'],
            subs: {},
          },
        },
      },
    },
  },

};

// ─────────────────────────────────────────────────────────────
// 2) MAPPING ENGINE — classify a single opportunity
//    Priority: PSC > NAICS > NLP keywords. Returns ALL matches
//    (an opp can legitimately match more than one bucket).
// ─────────────────────────────────────────────────────────────
function _hasPrefix(value, prefixes) {
  if (!value || !prefixes || !prefixes.length) return false;
  const v = String(value).trim().toUpperCase();
  return prefixes.some(p => v.startsWith(String(p).toUpperCase()));
}

function _matchesKeywords(text, keywords) {
  if (!text || !keywords || !keywords.length) return false;
  const t = String(text).toLowerCase();
  return keywords.some(k => t.includes(String(k).toLowerCase()));
}

// Returns an array of { domain, category, subCategory, source, confidence }
// source is one of 'psc' | 'naics' | 'nlp'. confidence is 0–100.
function mapContractToCategories(opp, tabKey) {
  const tab = TAXONOMY[tabKey];
  if (!tab) return [];

  const naics = (opp.naics || opp.naics_code || '').trim();
  const psc   = (opp.psc || opp.classification_code || opp.classificationCode || '').trim();
  const text  = [(opp.title || ''), (opp.description || '')].join(' ');

  const hits = [];

  for (const [domainKey, domain] of Object.entries(tab.domains)) {
    for (const [catKey, cat] of Object.entries(domain.categories)) {
      // — PSC first (highest signal) —
      if (_hasPrefix(psc, cat.psc)) {
        hits.push({ domain: domainKey, category: catKey, subCategory: null, source: 'psc', confidence: 95 });
        // Sub-category by keyword on top of the PSC match
        for (const [subKey, sub] of Object.entries(cat.subs || {})) {
          if (_matchesKeywords(text, sub.keywords)) {
            hits.push({ domain: domainKey, category: catKey, subCategory: subKey, source: 'psc', confidence: 90 });
          }
        }
        continue; // already classified via PSC, don't fall through
      }
      // — NAICS second —
      if (_hasPrefix(naics, cat.naics)) {
        hits.push({ domain: domainKey, category: catKey, subCategory: null, source: 'naics', confidence: 85 });
        for (const [subKey, sub] of Object.entries(cat.subs || {})) {
          if (_matchesKeywords(text, sub.keywords)) {
            hits.push({ domain: domainKey, category: catKey, subCategory: subKey, source: 'naics', confidence: 80 });
          }
        }
        continue;
      }
      // — NLP fallback (lowest signal) —
      if (_matchesKeywords(text, cat.keywords)) {
        hits.push({ domain: domainKey, category: catKey, subCategory: null, source: 'nlp', confidence: 55 });
        for (const [subKey, sub] of Object.entries(cat.subs || {})) {
          if (_matchesKeywords(text, sub.keywords)) {
            hits.push({ domain: domainKey, category: catKey, subCategory: subKey, source: 'nlp', confidence: 50 });
          }
        }
      }
    }
  }

  return hits;
}

// Cache the classification per opp+tab. mapContractToCategories is called
// hundreds of times per render; memoizing turns it from O(N×T) to O(1) per opp.
const _MAP_CACHE = new WeakMap();
function _cachedMap(opp, tabKey) {
  let perOpp = _MAP_CACHE.get(opp);
  if (!perOpp) { perOpp = {}; _MAP_CACHE.set(opp, perOpp); }
  if (!perOpp[tabKey]) perOpp[tabKey] = mapContractToCategories(opp, tabKey);
  return perOpp[tabKey];
}

// ─────────────────────────────────────────────────────────────
// 3) FILTER STATE — one bucket per tab. No React, just an object.
// 2026-05-02: added `regions` (Set of region names) and `panelCollapsed`
// (bool) for the new region filter + collapsible panel feature.
// ─────────────────────────────────────────────────────────────
const FILTERS = {
  supply:       { domains: new Set(), categories: new Set(), subs: new Set(), expanded: new Set(), regions: new Set(), panelCollapsed: false },
  construction: { domains: new Set(), categories: new Set(), subs: new Set(), expanded: new Set(), regions: new Set(), panelCollapsed: false },
  realestate:   { domains: new Set(), categories: new Set(), subs: new Set(), expanded: new Set(), regions: new Set(), panelCollapsed: false },
};

// Region → states mapping (matches index.html STATE_META.r values).
// Used for the "All States / By Region / Custom" selector on each vertical.
const REGION_STATES = {
  'Gulf Coast':      ['LA','MS','AL','TX','FL'],
  'Southeast':       ['GA','NC','SC','TN','KY','AR','VA','WV'],
  'Mid-Atlantic':    ['MD','DC','DE','PA','NJ'],
  'Northeast':       ['NY','MA','CT','RI','VT','NH','ME'],
  'Great Lakes':     ['MI','OH','IL','IN','WI'],
  'Midwest':         ['MO','IA','MN','KS','NE','ND','SD'],
  'Plains':          ['OK'],
  'Mountain':        ['CO','UT','WY','MT','ID','NM'],
  'Southwest':       ['AZ','NV'],
  'Pacific':         ['CA','OR','WA','HI','AK'],
};
const ALL_REGIONS = Object.keys(REGION_STATES);

function toggleDomain(tabKey, domainKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  if (f.domains.has(domainKey)) f.domains.delete(domainKey); else f.domains.add(domainKey);
  _onFilterChange(tabKey);
}
function toggleCategory(tabKey, categoryKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  if (f.categories.has(categoryKey)) f.categories.delete(categoryKey); else f.categories.add(categoryKey);
  _onFilterChange(tabKey);
}
function toggleSubCategory(tabKey, subKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  if (f.subs.has(subKey)) f.subs.delete(subKey); else f.subs.add(subKey);
  _onFilterChange(tabKey);
}
function toggleExpanded(tabKey, domainKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  if (f.expanded.has(domainKey)) f.expanded.delete(domainKey); else f.expanded.add(domainKey);
  _renderFilterPanelOnly(tabKey);   // collapse/expand only — no need to re-filter list
}
function clearFilters(tabKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  f.domains.clear(); f.categories.clear(); f.subs.clear(); f.regions.clear();
  _onFilterChange(tabKey);
}

// 2026-05-02: region selector toggles. "All States" = empty regions Set.
// Selecting one or more regions narrows the state map + opp list to those.
function toggleRegion(tabKey, regionName) {
  const f = FILTERS[tabKey]; if (!f) return;
  if (f.regions.has(regionName)) f.regions.delete(regionName); else f.regions.add(regionName);
  _onFilterChange(tabKey);
}
function clearRegions(tabKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  f.regions.clear();
  _onFilterChange(tabKey);
}
function selectAllRegions(tabKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  ALL_REGIONS.forEach(r => f.regions.add(r));
  _onFilterChange(tabKey);
}

// Collapse/expand the entire filter panel. State persists in FILTERS[tabKey].
function togglePanelCollapsed(tabKey) {
  const f = FILTERS[tabKey]; if (!f) return;
  f.panelCollapsed = !f.panelCollapsed;
  _renderFilterPanelOnly(tabKey);
}

// Returns the set of US state codes that pass the active region filter for a tab.
// Empty regions Set = "all states allowed". Used by index.html's renderVertical
// when filtering opps for the state map and opp list.
function regionAllowedStates(tabKey) {
  const f = FILTERS[tabKey];
  if (!f || f.regions.size === 0) return null; // null sentinel = no region filter
  const allowed = new Set();
  for (const region of f.regions) {
    (REGION_STATES[region] || []).forEach(s => allowed.add(s));
  }
  return allowed;
}

// ─────────────────────────────────────────────────────────────
// 4) FILTER ENGINE — pure function. AND across tiers, OR within.
// ─────────────────────────────────────────────────────────────
function filterContracts(opps, tabKey) {
  const f = FILTERS[tabKey];
  if (!f) return opps;
  const noTaxFilters = f.domains.size === 0 && f.categories.size === 0 && f.subs.size === 0;
  const noRegionFilter = f.regions.size === 0;
  if (noTaxFilters && noRegionFilter) return opps;

  const allowedStates = regionAllowedStates(tabKey); // null if no region filter

  return opps.filter(opp => {
    // Region filter — applies first (cheapest)
    if (allowedStates) {
      const st = (opp.state || opp.place_of_performance || '').toUpperCase();
      if (!allowedStates.has(st)) return false;
    }
    if (noTaxFilters) return true;
    const hits = _cachedMap(opp, tabKey);
    const domainOk = f.domains.size === 0    || hits.some(h => f.domains.has(h.domain));
    const catOk    = f.categories.size === 0 || hits.some(h => f.categories.has(h.category));
    const subOk    = f.subs.size === 0       || hits.some(h => h.subCategory && f.subs.has(h.subCategory));
    return domainOk && catOk && subOk;
  });
}

// Per-bucket counts so the UI can show "Cleaning (12 opps)" badges
function countsByBucket(opps, tabKey) {
  const counts = { domains: {}, categories: {}, subs: {} };
  for (const opp of opps) {
    const hits = _cachedMap(opp, tabKey);
    const seenD = new Set(), seenC = new Set(), seenS = new Set();
    for (const h of hits) {
      if (!seenD.has(h.domain))   { counts.domains[h.domain]     = (counts.domains[h.domain]     || 0) + 1; seenD.add(h.domain); }
      if (!seenC.has(h.category)) { counts.categories[h.category]= (counts.categories[h.category]|| 0) + 1; seenC.add(h.category); }
      if (h.subCategory && !seenS.has(h.subCategory)) {
        counts.subs[h.subCategory] = (counts.subs[h.subCategory] || 0) + 1;
        seenS.add(h.subCategory);
      }
    }
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────
// 5) UI — division-style accordion. Renders into any container.
//    Caller passes the container element + active opportunity list.
// ─────────────────────────────────────────────────────────────
function renderFilterPanel(tabKey, container, activeOpps) {
  if (!container) return;
  const tab = TAXONOMY[tabKey];
  if (!tab) { container.innerHTML = ''; return; }

  const f = FILTERS[tabKey];
  const counts = countsByBucket(activeOpps || [], tabKey);
  const totalActive = (activeOpps || []).length;
  const filtered = filterContracts(activeOpps || [], tabKey).length;
  const anyActive = f.domains.size + f.categories.size + f.subs.size > 0;

  const collapsed = !!f.panelCollapsed;
  const regionsActive = f.regions.size;
  const totalAnyActive = anyActive || regionsActive > 0;

  let html = `<div class="fx-panel ${collapsed?'is-collapsed':''}" data-tab="${tabKey}">`;
  html += `<div class="fx-head">
    <div class="fx-title">${tab.label} · Filter</div>
    <div class="fx-summary">${totalAnyActive ? `<span style="color:${tab.color}">${filtered}</span>/${totalActive} match` : `${totalActive} total`}</div>
    ${totalAnyActive ? `<button class="fx-clear" onclick="clearFilters('${tabKey}')">Clear</button>` : ''}
    <button class="fx-collapse-btn" onclick="togglePanelCollapsed('${tabKey}')" title="${collapsed?'Expand filter':'Collapse filter'}">${collapsed?'▼':'▲'}</button>
  </div>`;

  // 2026-05-02: when collapsed, show only a one-line summary of active filters.
  if (collapsed) {
    const activeBits = [];
    if (f.regions.size)    activeBits.push(`${f.regions.size} region${f.regions.size>1?'s':''}`);
    if (f.domains.size)    activeBits.push(`${f.domains.size} domain${f.domains.size>1?'s':''}`);
    if (f.categories.size) activeBits.push(`${f.categories.size} cat${f.categories.size>1?'s':''}`);
    if (f.subs.size)       activeBits.push(`${f.subs.size} sub${f.subs.size>1?'s':''}`);
    html += `<div class="fx-collapsed-summary">${activeBits.length ? activeBits.join(' · ') : 'No filters active'}</div>`;
    html += `</div>`;
    container.innerHTML = html;
    return;
  }

  // Region selector — All / By Region (multi-select) ──────────────
  html += `<div class="fx-regions">
    <div class="fx-regions-head">
      <span class="fx-regions-title">States</span>
      <div class="fx-regions-actions">
        <button class="fx-region-quick" onclick="clearRegions('${tabKey}')">${f.regions.size===0?'<b>All States ●</b>':'All States'}</button>
        <button class="fx-region-quick" onclick="selectAllRegions('${tabKey}')">Select all regions</button>
      </div>
    </div>
    <div class="fx-region-grid">
      ${ALL_REGIONS.map(r => {
        const sel = f.regions.has(r);
        const stCount = (REGION_STATES[r] || []).length;
        return `<button class="fx-region-chip ${sel?'is-active':''}" onclick="toggleRegion('${tabKey}','${r}')">${r}<span class="fx-region-count">${stCount}</span></button>`;
      }).join('')}
    </div>
  </div>`;

  // One row per domain (the "division-style header"). Click header = expand/collapse + toggle.
  // 2026-05-02: empty buckets get .is-empty class — dimmed but kept visible so the user
  // can see the taxonomy structure even when no opps currently fall there.
  for (const [domainKey, domain] of Object.entries(tab.domains)) {
    const expanded = f.expanded.has(domainKey);
    const domainSelected = f.domains.has(domainKey);
    const cnt = counts.domains[domainKey] || 0;
    const dColor = domain.color || tab.color;
    const domainEmpty = cnt === 0;

    html += `<div class="fx-domain ${domainSelected?'is-active':''} ${domainEmpty?'is-empty':''}" style="--dc:${dColor}">`;
    html += `<div class="fx-domain-head">
      <button class="fx-toggle" onclick="toggleExpanded('${tabKey}','${domainKey}')" aria-label="Expand">${expanded?'▼':'▶'}</button>
      <button class="fx-domain-btn" onclick="toggleDomain('${tabKey}','${domainKey}')" ${domainEmpty?'title="No opportunities currently match this domain — kept visible so the taxonomy structure stays consistent."':''}>
        <span class="fx-domain-label">${domain.label}</span>
        <span class="fx-count">${cnt}</span>
      </button>
    </div>`;

    if (expanded) {
      html += `<div class="fx-cats">`;
      for (const [catKey, cat] of Object.entries(domain.categories)) {
        const catSelected = f.categories.has(catKey);
        const catCnt = counts.categories[catKey] || 0;
        const catEmpty = catCnt === 0;
        html += `<div class="fx-cat ${catSelected?'is-active':''} ${catEmpty?'is-empty':''}">
          <button class="fx-cat-btn" onclick="toggleCategory('${tabKey}','${catKey}')" ${catEmpty?'title="No matching opportunities yet."':''}>
            <span class="fx-cat-mark">${catSelected?'☑':'☐'}</span>
            <span class="fx-cat-label">${cat.label}</span>
            <span class="fx-cat-count">${catCnt}</span>
          </button>`;

        // Sub-categories — only render if present
        const subs = cat.subs || {};
        const subKeys = Object.keys(subs);
        if (subKeys.length > 0) {
          html += `<div class="fx-subs">`;
          for (const subKey of subKeys) {
            const sub = subs[subKey];
            const subSelected = f.subs.has(subKey);
            const subCnt = counts.subs[subKey] || 0;
            const subEmpty = subCnt === 0;
            html += `<button class="fx-sub-btn ${subSelected?'is-active':''} ${subEmpty?'is-empty':''}" onclick="toggleSubCategory('${tabKey}','${subKey}')">
              <span class="fx-cat-mark">${subSelected?'☑':'☐'}</span>
              <span class="fx-sub-label">${sub.label}</span>
              <span class="fx-cat-count">${subCnt}</span>
            </button>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

// Re-render only the panel (used by expand/collapse — list is unchanged)
function _renderFilterPanelOnly(tabKey) {
  const panel = document.getElementById('fx-' + tabKey);
  if (!panel) return;
  const opps = _activeOppsForTab(tabKey);
  renderFilterPanel(tabKey, panel, opps);
}

// Re-render panel AND opp list — called when filter selections change
function _onFilterChange(tabKey) {
  const panel = document.getElementById('fx-' + tabKey);
  const list  = document.getElementById(tabKey + '-opp-list');
  const opps  = _activeOppsForTab(tabKey);
  if (panel) renderFilterPanel(tabKey, panel, opps);
  if (list) {
    const filtered = filterContracts(opps, tabKey);
    // oppRow + emptyState are existing helpers in index.html; we expect them to be defined.
    if (typeof oppRow === 'function' && typeof emptyState === 'function' && typeof OPPS !== 'undefined') {
      list.innerHTML = filtered.length
        ? filtered.map(o => oppRow(o, OPPS.indexOf(o))).join('')
        : emptyState('No matching ' + tabKey + ' opportunities', 'Adjust filters or run SCOUT to pull fresh contracts.');
    }
  }
  // Refresh state map if present
  const mapEl = document.getElementById(tabKey[0] + '-map');
  if (mapEl && typeof renderGrid === 'function' && typeof buildStateMap === 'function') {
    const filtered = filterContracts(opps, tabKey);
    renderGrid(mapEl, buildStateMap(filtered, tabKey), tabKey);
  }
}

// Pulls the same "active opps for this vertical" set that renderVertical uses.
// Single source of truth — keeps the filter panel honest with the rest of the UI.
function _activeOppsForTab(tabKey) {
  if (typeof OPPS === 'undefined' || typeof getVertical !== 'function') return [];
  return OPPS.filter(o =>
    getVertical(o) === tabKey &&
    (!o.status || o.status === 'new' || o.status === 'scored' || o.status === 'reviewing' || o.status === 'pursuing')
  );
}

// ─────────────────────────────────────────────────────────────
// 6) COMMAND CENTER SEARCH — fuzzy match across all opportunities
//    For when an opp didn't score high but the user knows what
//    they're looking for ("paper products", "fuel", "barracks").
// ─────────────────────────────────────────────────────────────
function commandCenterSearch(query, opts) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  if (typeof OPPS === 'undefined') return [];

  const limit = (opts && opts.limit) || 50;
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = [];
  for (const opp of OPPS) {
    const haystack = [
      opp.title || '',
      opp.description || '',
      opp.agency || '',
      opp.naics || '',
      opp.psc || opp.classification_code || '',
      opp.solicitation_number || '',
      opp.set_aside || '',
      opp.state || opp.place_of_performance || '',
    ].join(' ').toLowerCase();

    let score = 0;
    let allTokens = true;
    for (const tok of tokens) {
      if (haystack.includes(tok)) { score += 10; }
      else { allTokens = false; }
    }
    if (!allTokens) continue;

    // Title hits worth more
    const titleLo = (opp.title || '').toLowerCase();
    for (const tok of tokens) if (titleLo.includes(tok)) score += 8;

    // NAICS or solicitation# exact prefix match — strongest signal
    if ((opp.naics || '').toLowerCase().startsWith(q))               score += 25;
    if ((opp.solicitation_number || '').toLowerCase().includes(q))   score += 20;

    // What tier would this opp fall under — useful when query is broad
    const vertical = (typeof getVertical === 'function') ? getVertical(opp) : null;
    const hits = vertical ? _cachedMap(opp, vertical) : [];
    const tier = hits[0]
      ? `${vertical} → ${TAXONOMY[vertical]?.domains[hits[0].domain]?.label || hits[0].domain} → ${
          (TAXONOMY[vertical]?.domains[hits[0].domain]?.categories[hits[0].category]?.label) || hits[0].category
        }`
      : (vertical || 'unclassified');

    scored.push({ opp, score, tier, vertical, classification: hits[0] || null });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Renders the search box + results into a container. Drop into Command Center.
function renderCommandSearch(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="fx-search">
      <div class="fx-search-bar">
        <span class="fx-search-icon">🔍</span>
        <input id="fx-search-input" class="fx-search-input" type="search"
               placeholder="Search all opportunities — title, agency, NAICS, PSC, solicitation #…"
               oninput="_runCommandSearch()" autocomplete="off">
        <button class="fx-search-clear" onclick="_clearCommandSearch()">✕</button>
      </div>
      <div id="fx-search-results" class="fx-search-results"></div>
    </div>`;
}

function _runCommandSearch() {
  const inp = document.getElementById('fx-search-input');
  const out = document.getElementById('fx-search-results');
  if (!inp || !out) return;
  const q = inp.value;
  if (!q || q.trim().length < 2) { out.innerHTML = ''; return; }
  const results = commandCenterSearch(q, { limit: 30 });
  if (results.length === 0) {
    out.innerHTML = `<div class="fx-search-empty">No matches. Try a NAICS code, agency name, or solicitation #.</div>`;
    return;
  }
  out.innerHTML = `<div class="fx-search-meta">${results.length} result${results.length===1?'':'s'}</div>` +
    results.map(r => {
      const o = r.opp;
      const score = (typeof scoreOf === 'function') ? scoreOf(o) : 0;
      const verticalColor = (typeof vtColor === 'function') ? vtColor(r.vertical) : 'var(--cyan)';
      return `<div class="fx-search-row" onclick="_openOppFromSearch('${o.id || ''}')">
        <div class="fx-search-row-main">
          <div class="fx-search-row-title">${(o.title||'(untitled)').replace(/</g,'&lt;')}</div>
          <div class="fx-search-row-meta">
            <span style="color:${verticalColor};font-weight:700">${(r.vertical||'').toUpperCase()}</span> ·
            ${o.naics || '—'} · ${o.agency || '—'} · ${o.state || o.place_of_performance || '—'}
          </div>
          <div class="fx-search-row-tier">${r.tier}</div>
        </div>
        <div class="fx-search-row-score" style="color:${score>=85?'var(--green)':score>=70?'var(--gold)':score>=55?'var(--amber)':'var(--t3)'}">
          ${score ? score : '—'}
        </div>
      </div>`;
    }).join('');
}

function _clearCommandSearch() {
  const inp = document.getElementById('fx-search-input');
  const out = document.getElementById('fx-search-results');
  if (inp) inp.value = '';
  if (out) out.innerHTML = '';
}

// Stub — index.html should override with its own opp-detail open routine.
// We keep a default so a click never silently fails.
function _openOppFromSearch(oppId) {
  if (!oppId || typeof OPPS === 'undefined') return;
  const opp = OPPS.find(o => String(o.id) === String(oppId));
  if (!opp) return;
  if (typeof openDetail === 'function') openDetail(OPPS.indexOf(opp));
  else if (typeof openOpp === 'function') openOpp(opp);
  else console.warn('No opp-detail handler — wire renderCommandSearch to your detail panel');
}

// ─────────────────────────────────────────────────────────────
// 7) PUBLIC API — global functions index.html will call.
// ─────────────────────────────────────────────────────────────
window.TAXONOMY                = TAXONOMY;
window.FILTERS                 = FILTERS;
window.mapContractToCategories = mapContractToCategories;
window.filterContracts         = filterContracts;
window.countsByBucket          = countsByBucket;
window.toggleDomain            = toggleDomain;
window.toggleCategory          = toggleCategory;
window.toggleSubCategory       = toggleSubCategory;
window.toggleExpanded          = toggleExpanded;
window.clearFilters            = clearFilters;
window.toggleRegion            = toggleRegion;
window.clearRegions            = clearRegions;
window.selectAllRegions        = selectAllRegions;
window.togglePanelCollapsed    = togglePanelCollapsed;
window.regionAllowedStates     = regionAllowedStates;
window.REGION_STATES           = REGION_STATES;
window.ALL_REGIONS             = ALL_REGIONS;
window.renderFilterPanel       = renderFilterPanel;
window.commandCenterSearch     = commandCenterSearch;
window.renderCommandSearch     = renderCommandSearch;
window._runCommandSearch       = _runCommandSearch;
window._clearCommandSearch     = _clearCommandSearch;
window._openOppFromSearch      = _openOppFromSearch;
