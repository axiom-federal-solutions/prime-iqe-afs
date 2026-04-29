const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
        PageNumber, Header, Footer, PageBreak } = require('docx');
const fs = require('fs');

// ── Helpers ───────────────────────────────────────────────────────────────
const border  = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

const GOLD   = "C49A1A";
const NAVY   = "1F3864";
const LTBLUE = "D5E8F4";
const LTGOLD = "FFF3CD";
const LTGRAY = "F5F5F5";
const GREEN  = "D4EDDA";
const RED    = "F8D7DA";
const WHITE  = "FFFFFF";

const cell = (text, opts = {}) => new TableCell({
  borders: opts.noBorder ? noBorders : borders,
  width:   { size: opts.width || 3120, type: WidthType.DXA },
  shading: { fill: opts.fill || WHITE, type: ShadingType.CLEAR },
  margins: { top: 80, bottom: 80, left: 140, right: 140 },
  verticalAlign: opts.vAlign || "top",
  children: [new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({
      text,
      font: "Arial",
      size: opts.size || 18,
      bold: !!opts.bold,
      color: opts.color || "000000",
    })]
  })]
});

const hdr = (texts, widths) => new TableRow({
  tableHeader: true,
  children: texts.map((t, i) => new TableCell({
    borders,
    width: { size: widths[i], type: WidthType.DXA },
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: t, font: "Arial", size: 20, bold: true, color: "FFFFFF" })]
    })]
  }))
});

const row2 = (col1, col2, fill1, fill2) => new TableRow({ children: [
  cell(col1, { width: 4680, fill: fill1 || WHITE }),
  cell(col2, { width: 4680, fill: fill2 || WHITE }),
]});

const row3 = (col1, col2, col3, opts = {}) => new TableRow({ children: [
  cell(col1, { width: opts.w1 || 2800, fill: opts.f1 || WHITE, bold: opts.bold1, size: opts.size }),
  cell(col2, { width: opts.w2 || 3280, fill: opts.f2 || WHITE, size: opts.size }),
  cell(col3, { width: opts.w3 || 3280, fill: opts.f3 || WHITE, size: opts.size }),
]});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 320, after: 120 },
  children: [new TextRun({ text, font: "Arial", size: 36, bold: true, color: NAVY })]
});

const body = (text, opts = {}) => new Paragraph({
  spacing: { before: 60, after: 60 },
  children: [new TextRun({ text, font: "Arial", size: 20, bold: !!opts.bold, color: opts.color || "333333" })]
});

const spacer = () => new Paragraph({ children: [new TextRun({ text: " ", size: 18 })] });

const divider = () => new Paragraph({
  spacing: { before: 180, after: 180 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 1 } },
  children: [new TextRun({ text: "" })]
});

// ── TABLE 1: Side-by-Side Overview ───────────────────────────────────────
const overviewTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [4680, 4680],
  rows: [
    hdr(["prime-system (Original)", "prime-iqe-afs (Current Build)"], [4680, 4680]),
    row2("Private GitHub repo (target)", "Public GitHub repo — needs to become dashboard-only", LTGOLD, LTGOLD),
    row2("Architectural engine — all agent logic lives here", "Originally full system, should become dashboard-only", LTBLUE, LTBLUE),
    row2("2 verticals: Construction + Supply", "3 verticals: Construction + Supply + Real Estate", WHITE, WHITE),
    row2("9 core agents", "9 core agents (upgraded) + T.E.S.T. (new)", WHITE, WHITE),
    row2("25 database tables", "29 database tables + additional columns", WHITE, WHITE),
    row2("Node.js 20", "Node.js 24", WHITE, WHITE),
    row2("2 scoring models: PRIME Score + ACQ Score", "3 scoring models: PRIME Score + ACQ Score + LEASE Score", WHITE, WHITE),
    row2("Basic dashboard (original index.html)", "v19: 15 tabs, live data, PIN lock, GitHub Pages deploy", WHITE, WHITE),
    row2("No opportunity status management", "Full status workflow: new > reviewing > pursuing > passed/expired", WHITE, WHITE),
    row2("No T.E.S.T. validation agent", "T.E.S.T.: 20 test cases across 7 categories", WHITE, WHITE),
    row2("No DIBBS integration", "DIBBS (DLA) RSS feed for direct supply sourcing", WHITE, WHITE),
    row2("No supplier intelligence", "RECON supplier scan: matches subs to opportunities", WHITE, WHITE),
    row2("No pre-scoring", "pre_prime_score: rough score at SCOUT intake time", WHITE, WHITE),
    row2("No MCP connection", "MCP-connected Supabase (luilinnjlsmtgkqopzmg)", WHITE, WHITE),
    row2("~$8-9/month", "~$5-7/month (optimized)", WHITE, WHITE),
  ]
});

// ── TABLE 2: Agent Inventory ──────────────────────────────────────────────
const agentTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2000, 3680, 3680],
  rows: [
    hdr(["Agent", "prime-system", "prime-iqe-afs"], [2000, 3680, 3680]),
    new TableRow({ children: [
      cell("SCOUT", { width: 2000, fill: LTBLUE, bold: true }),
      cell("SAM.gov scan for 2 verticals. Basic NAICS list. No status handling.", { width: 3680 }),
      cell("UPGRADED: 32 NAICS codes, 3 verticals, DIBBS, preserves status on re-scan, auto-expires past-deadline opps, pre_prime_score on intake.", { width: 3680, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("JUDGE", { width: 2000, fill: LTBLUE, bold: true }),
      cell("PRIME Score + ACQ Score. 2 scoring models.", { width: 3680 }),
      cell("UPGRADED: Added LEASE Score for real estate. 3 models. Handles null raw_data.", { width: 3680, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("VAULT", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Daily compliance: licenses, insurance, SAM registration.", { width: 3680 }),
      cell("Same core function. Workflow renamed vault.yml.", { width: 3680 }),
    ]}),
    new TableRow({ children: [
      cell("RECON", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Incumbents + competitor prices from USASpending.", { width: 3680 }),
      cell("UPGRADED: Added supplier intelligence — finds/scores subs per opportunity. Fixed column names.", { width: 3680, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("DRAFT", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Writes construction proposals via Claude Sonnet.", { width: 3680 }),
      cell("UPGRADED: Added supply proposal template. Fixed column names.", { width: 3680, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("BID ENGINE", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Competitive price calculator.", { width: 3680 }),
      cell("Same core function.", { width: 3680 }),
    ]}),
    new TableRow({ children: [
      cell("LEDGER", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Win/loss learning. Weekly report.", { width: 3680 }),
      cell("Same core function.", { width: 3680 }),
    ]}),
    new TableRow({ children: [
      cell("EXEC", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Costs, payroll, prompt payment, retainage tracking.", { width: 3680 }),
      cell("Same core function.", { width: 3680 }),
    ]}),
    new TableRow({ children: [
      cell("BRANDI", { width: 2000, fill: LTBLUE, bold: true }),
      cell("Daily email brief to PrimeOpps1@gmail.com.", { width: 3680 }),
      cell("UPGRADED: Parallelized queries, critical alerts, weekly supply digest.", { width: 3680, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("T.E.S.T.", { width: 2000, fill: LTGOLD, bold: true }),
      cell("DOES NOT EXIST", { width: 3680, fill: RED }),
      cell("NEW: 20 validation tests across 7 categories. Pre-flight + post-run verification. Zero LLM cost.", { width: 3680, fill: GREEN }),
    ]}),
  ]
});

// ── TABLE 3: Workflow Inventory ───────────────────────────────────────────
const wfTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3400, 2980, 2980],
  rows: [
    hdr(["Workflow", "prime-system", "prime-iqe-afs"], [3400, 2980, 2980]),
    row3("scout-sam.yml / scout-sam-scan.yml", "YES (scout-sam-scan.yml)", "YES - upgraded (scout-sam.yml)", { f2: GREEN, f3: GREEN }),
    row3("scout-state-portals.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("judge-scoring.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("vault-compliance.yml / vault.yml", "YES (vault-compliance.yml)", "YES (renamed vault.yml)", { f2: GREEN, f3: GREEN }),
    row3("brandi-daily.yml / brandi-briefing.yml", "YES (brandi-briefing.yml)", "YES - upgraded (brandi-daily.yml)", { f2: GREEN, f3: GREEN }),
    row3("recon-supplier-scan.yml", "NO - missing", "YES (NEW)", { f2: RED, f3: GREEN }),
    row3("recon-congressional.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("recon-intel.yml", "YES", "NO - needs to be ported", { f2: GREEN, f3: RED }),
    row3("cpars-monitor.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("gao-protest-scan.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("osdbu-event-finder.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("prompt-payment-check.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("retainage-monitor.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("exec-cost-sync.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("exec-certified-payroll.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("exec-daily.yml", "YES", "NO - needs to be ported", { f2: GREEN, f3: RED }),
    row3("ledger-monthly-report.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("ledger-weekly.yml", "YES", "NO - needs to be ported", { f2: GREEN, f3: RED }),
    row3("sam-health-check.yml", "YES", "YES", { f2: GREEN, f3: GREEN }),
    row3("seed-db.yml", "YES", "NO - missing", { f2: GREEN, f3: RED }),
    row3("test-validation.yml (T.E.S.T.)", "NO - missing", "YES (NEW)", { f2: RED, f3: GREEN }),
    row3("deploy-dashboard.yml (GitHub Pages)", "NO - not needed here", "YES (NEW - stays here)", { f2: WHITE, f3: GREEN }),
    row3("bidengine.yml", "NO - missing workflow", "YES", { f2: RED, f3: GREEN }),
    row3("draft.yml", "NO - missing workflow", "YES", { f2: RED, f3: GREEN }),
  ]
});

// ── TABLE 4: Gap Analysis ─────────────────────────────────────────────────
const gapTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2400, 3480, 3480],
  rows: [
    hdr(["Category", "In prime-system ONLY (port these in)", "In prime-iqe-afs ONLY (preserve these)"], [2400, 3480, 3480]),
    new TableRow({ children: [
      cell("Agents", { width: 2400, bold: true, fill: LTGRAY }),
      cell("seed.js — database seeding agent", { width: 3480, fill: LTGOLD }),
      cell("test.js — T.E.S.T. validation suite (20 tests, zero LLM cost)", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Verticals", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none — only 2 verticals)", { width: 3480 }),
      cell("Real Estate & Rental vertical + LEASE Score model", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Scoring", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none)", { width: 3480 }),
      cell("pre_prime_score: rough score at SCOUT intake before JUDGE runs", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Data Sources", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none)", { width: 3480 }),
      cell("DIBBS (DLA) RSS feed integration for direct supply sourcing", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Pipeline Mgmt", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none)", { width: 3480 }),
      cell("Opportunity status: new > reviewing > pursuing > passed/expired. Pass button + Passed Archive in dashboard.", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Shared Library", { width: 2400, bold: true, fill: LTGRAY }),
      cell("lib/claude.js — standalone AI wrapper\nlib/supabase.js — standalone DB wrapper\nconfig/settings.json — centralized config", { width: 3480, fill: LTGOLD }),
      cell("fetch-retry.js — retry logic for API calls\ncost-guard.js — spend cap enforcement", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Missing Workflows", { width: 2400, bold: true, fill: LTGRAY }),
      cell("recon-intel.yml, exec-daily.yml, ledger-weekly.yml, seed-db.yml — all need to be ported to prime-iqe-afs", { width: 3480, fill: LTGOLD }),
      cell("test-validation.yml, deploy-dashboard.yml, bidengine.yml, draft.yml, recon-supplier-scan.yml — NEW additions", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("DB Schema", { width: 2400, bold: true, fill: LTGRAY }),
      cell("25 tables (original schema)", { width: 3480, fill: LTGOLD }),
      cell("29 tables + new columns: response_deadline, naics_code, set_aside_type, lease_score, pre_prime_score, passed_at, passed_reason. Status CHECK constraint (5 states).", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Dashboard", { width: 2400, bold: true, fill: LTGRAY }),
      cell("Basic index.html (original)", { width: 3480, fill: LTGOLD }),
      cell("v19: 15 tabs, live Supabase data, PIN lock (8888), GitHub Pages, state heat maps, status pills, action queue, agent feed, passed archive", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Intelligence", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none)", { width: 3480 }),
      cell("Supplier intelligence — RECON finds and scores subcontractors per opportunity", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Testing / Evals", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none)", { width: 3480 }),
      cell("evals/test-cases.json (20 cases), evals/eval-viewer.html, No_Human_Build.skill deploy guide", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Infrastructure", { width: 2400, bold: true, fill: LTGRAY }),
      cell("(none)", { width: 3480 }),
      cell("MCP-connected Supabase. GitHub Pages with PIN gate serves dashboard publicly.", { width: 3480, fill: GREEN }),
    ]}),
    new TableRow({ children: [
      cell("Node.js Runtime", { width: 2400, bold: true, fill: LTGRAY }),
      cell("Node.js 20", { width: 3480 }),
      cell("Node.js 24", { width: 3480 }),
    ]}),
  ]
});

// ── TABLE 5: Recommended Architecture ────────────────────────────────────
const archTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2200, 3580, 3580],
  rows: [
    hdr(["What", "prime-system (PRIVATE)", "prime-iqe-afs (PUBLIC)"], [2200, 3580, 3580]),
    row3("Agents", "ALL .js agent files — scout, judge, vault, recon, draft, bidengine, ledger, exec, brandi, test", "Nothing — no agent code", { f2: GREEN }),
    row3("Workflows", "All GitHub Actions .yml that run agents", "deploy-dashboard.yml only", { f2: GREEN, f3: LTBLUE }),
    row3("Shared Lib", "lib/ folder — claude.js, supabase.js, fetch-retry.js, cost-guard.js", "Nothing", { f2: GREEN }),
    row3("Config", "config/settings.json, package.json", "Nothing", { f2: GREEN }),
    row3("SQL / Schema", "sql/ folder — all migration files", "Nothing", { f2: GREEN }),
    row3("Dashboard", "Nothing", "index.html only", { f3: LTBLUE }),
    row3("Secrets", "SUPABASE_URL, SERVICE_ROLE_KEY, SAM_API_KEY, ANTHROPIC_API_KEY, SENDGRID_API_KEY, CAGE_CODE", "No secrets (anon key in index.html is intentional — read-only)", { f3: LTBLUE }),
    row3("Visibility", "PRIVATE — protects scoring algorithm, NAICS strategy, bid logic", "PUBLIC — allows GitHub Pages team sharing with PIN lock", { f2: LTGOLD, f3: LTGOLD }),
  ]
});

// ── BUILD DOCUMENT ────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: NAVY },
        paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: NAVY },
        paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 15840, height: 12240 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } },
        children: [
          new TextRun({ text: "PRIME SYSTEM — Repository Comparison & Gap Analysis", font: "Arial", size: 18, bold: true, color: NAVY }),
          new TextRun({ text: "    |    Axiom Federal Solutions  |  Walker Contractors LLC    |    CONFIDENTIAL", font: "Arial", size: 16, color: "888888" }),
        ]
      })]})
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } },
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: "Page ", font: "Arial", size: 16, color: "888888" }),
          new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "888888" }),
          new TextRun({ text: " of ", font: "Arial", size: 16, color: "888888" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 16, color: "888888" }),
        ]
      })]})
    },
    children: [

      // TITLE
      new Paragraph({ spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: "PRIME SYSTEM", font: "Arial", size: 56, bold: true, color: NAVY })] }),
      new Paragraph({ spacing: { before: 0, after: 60 },
        children: [new TextRun({ text: "Repository Comparison, Capability Inventory & Gap Analysis", font: "Arial", size: 28, color: GOLD })] }),
      new Paragraph({ spacing: { before: 0, after: 200 },
        children: [new TextRun({ text: "Axiom Federal Solutions  |  Walker Contractors LLC  |  April 28, 2026  |  CONFIDENTIAL", font: "Arial", size: 18, color: "888888" })] }),
      divider(),

      // SECTION 1
      h1("1. System Overview"),
      body("Two local repositories contain PRIME build artifacts. prime-system is the original private architecture containing all 9 agents, shared libraries, and GitHub Actions workflows. prime-iqe-afs was built as a full system upgrade but must now be restructured: prime-system becomes the private engine holding all logic, while prime-iqe-afs becomes a thin public repository serving only the dashboard (index.html)."),
      spacer(),

      // SECTION 2
      h1("2. Side-by-Side Repository Comparison"),
      overviewTable,
      spacer(),
      new Paragraph({ children: [new PageBreak()] }),

      // SECTION 3
      h1("3. Agent Inventory — Capabilities by Repository"),
      body("Green = upgraded in prime-iqe-afs.  Yellow = exists only in prime-system.  Red = missing from one repo."),
      spacer(),
      agentTable,
      spacer(),
      new Paragraph({ children: [new PageBreak()] }),

      // SECTION 4
      h1("4. GitHub Actions Workflow Inventory"),
      body("Workflows marked NO in prime-iqe-afs need to be ported from prime-system during the merge. Workflows marked NEW in prime-iqe-afs are net-new capabilities to be preserved."),
      spacer(),
      wfTable,
      spacer(),
      new Paragraph({ children: [new PageBreak()] }),

      // SECTION 5
      h1("5. Gap Analysis"),
      body("Yellow = exists only in prime-system (original) and must be merged forward. Green = exists only in prime-iqe-afs (new build) and must be preserved in the combined architecture."),
      spacer(),
      gapTable,
      spacer(),
      new Paragraph({ children: [new PageBreak()] }),

      // SECTION 6
      h1("6. Recommended Target Architecture"),
      body("After the merge, all intellectual property lives in the private prime-system repo. The public prime-iqe-afs repo serves only the dashboard HTML with read-only Supabase access."),
      spacer(),
      archTable,
      spacer(),
      divider(),
      spacer(),

      // SECTION 7
      h1("7. Merge Priority Order"),
      body("Step 1 — Port 4 missing workflows into prime-system: recon-intel.yml, exec-daily.yml, ledger-weekly.yml, seed-db.yml", { bold: true }),
      body("Step 2 — Upgrade prime-system agents with prime-iqe-afs improvements: SCOUT (32 NAICS + DIBBS + status), JUDGE (LEASE Score), RECON (supplier intel), BRANDI (parallelization), DRAFT (supply template)"),
      body("Step 3 — Add new lib utilities to prime-system: fetch-retry.js, cost-guard.js from prime-iqe-afs lib/"),
      body("Step 4 — Merge config/settings.json from original prime-system into the new build"),
      body("Step 5 — Strip prime-iqe-afs down to index.html + deploy-dashboard.yml only"),
      body("Step 6 — Set prime-system repository to PRIVATE on GitHub"),
      body("Step 7 — Update prime-system GitHub Secrets with MCP Supabase project (luilinnjlsmtgkqopzmg)"),
      body("Step 8 — Run T.E.S.T. from prime-system to confirm all systems operational", { bold: true }),
      spacer(),
      spacer(),
      new Paragraph({ spacing: { before: 60, after: 60 },
        children: [new TextRun({ text: "PRIME IQE v19  |  Axiom Federal Solutions  |  Walker Contractors LLC  |  CAGE: 7JKKO  |  UEI: USMQMFAGL9M4", font: "Arial", size: 16, color: "AAAAAA" })] }),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("PRIME_Repository_Comparison.docx", buf);
  console.log("Done: PRIME_Repository_Comparison.docx");
});
