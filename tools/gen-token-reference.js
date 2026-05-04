// =============================================================
// TOOLS/GEN-TOKEN-REFERENCE.JS — Generate PRIME Bid Template Token Reference.docx
// JOB: One-shot script to produce a Word document listing every {{TOKEN}}
//      the bid-draft agent supports, grouped by category.
// USAGE: From C:\Users\renke\Code\prime-iqe-afs:
//        npm install --no-save docx
//        node tools/gen-token-reference.js
// OUTPUT: PRIME-Bid-Template-Tokens.docx in the repo root
// =============================================================

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber,
} = require('docx');

const TOKENS = [
  {
    section: '1. Company Identity',
    note: 'Pre-filled with Walker Contractors / Axiom Federal Solutions facts. Use these anywhere your template references the bidder.',
    rows: [
      { token: '{{COMPANY_NAME}}',    fills: 'Legal company name',                   example: 'Walker Contractors LLC' },
      { token: '{{COMPANY_DBA}}',     fills: 'Doing-business-as name',                example: 'Axiom Federal Solutions' },
      { token: '{{COMPANY_CAGE}}',    fills: 'CAGE Code',                             example: '7JKKO' },
      { token: '{{COMPANY_UEI}}',     fills: 'SAM.gov UEI',                           example: 'USMQMFAGL9M4' },
      { token: '{{COMPANY_CONTACT}}', fills: 'Primary contact name + title',          example: 'Mr. Kemp, Managing Member' },
      { token: '{{COMPANY_EMAIL}}',   fills: 'Bid submission email',                  example: 'PrimeOpps1@gmail.com' },
      { token: '{{COMPANY_ADDRESS}}', fills: 'Headquarters address',                  example: 'New Orleans, Louisiana 70114' },
    ],
  },
  {
    section: '2. Date Stamps',
    note: 'Always populated at draft generation time. Useful for cover pages and signature blocks.',
    rows: [
      { token: '{{TODAY}}',          fills: 'Today’s date (long format)',       example: 'May 3, 2026' },
      { token: '{{GENERATED_DATE}}', fills: 'Same as TODAY — alias',             example: 'May 3, 2026' },
      { token: '{{GENERATED_AT}}',   fills: 'Date + time of draft generation',        example: '5/3/2026, 1:24:00 PM' },
    ],
  },
  {
    section: '3. Opportunity Facts',
    note: 'Pulled from the opportunity row SCOUT created. Anything not yet captured shows as "—" (em dash).',
    rows: [
      { token: '{{TITLE}}',                fills: 'Opportunity title',                 example: 'Fort Polk MILCON Renovation' },
      { token: '{{SOLICITATION_NUMBER}}',  fills: 'Solicitation #',                  example: 'W912EE-26-R-0042' },
      { token: '{{AGENCY}}',               fills: 'Issuing agency',                     example: 'U.S. Army Corps of Engineers' },
      { token: '{{NAICS}}',                fills: 'Primary NAICS code',                 example: '236220' },
      { token: '{{PSC}}',                  fills: 'Product/Service Code',               example: 'Y1AA' },
      { token: '{{SET_ASIDE}}',            fills: 'Set-aside type',                     example: 'SDB Sole Source' },
      { token: '{{STATE}}',                fills: 'Place of performance state',         example: 'LA' },
      { token: '{{VALUE}}',                fills: 'Estimated contract value',           example: '$1,250,000' },
      { token: '{{POSTED_DATE}}',          fills: 'Date solicitation was posted',       example: 'April 18, 2026' },
      { token: '{{DEADLINE}}',             fills: 'Response deadline',                  example: 'May 30, 2026' },
      { token: '{{NOTICE_URL}}',           fills: 'Direct SAM.gov link',                example: 'https://sam.gov/opp/abc123/view' },
      { token: '{{DESCRIPTION}}',          fills: 'Synopsis text (capped at 1500 chars)', example: 'Renovation of Building 9023 ...' },
    ],
  },
  {
    section: '4. Scoring (JUDGE)',
    note: 'JUDGE writes one of PRIME / ACQ / LEASE depending on vertical. Use {{SCORE}} to display whichever applies without caring about vertical.',
    rows: [
      { token: '{{SCORE}}',          fills: 'Whichever vertical’s score is set',     example: '86' },
      { token: '{{PRIME_SCORE}}',    fills: 'Construction PRIME Score',                 example: '86' },
      { token: '{{ACQ_SCORE}}',      fills: 'Supply ACQ Score',                          example: '—' },
      { token: '{{LEASE_SCORE}}',    fills: 'Real Estate LEASE Score',                   example: '—' },
      { token: '{{TIER}}',           fills: 'STRONG_BID / BID / CONDITIONAL / NO_BID',   example: 'STRONG_BID' },
      { token: '{{RECOMMENDATION}}', fills: 'Plain-language verdict',                    example: 'STRONG BID' },
      { token: '{{REASONING}}',      fills: 'JUDGE’s explanation paragraph',         example: 'Set-aside match + Gulf South home advantage …' },
    ],
  },
  {
    section: '5. Pricing (BID ENGINE)',
    note: 'Empty until BID ENGINE has run on the opportunity. PRICING_NOTE flags estimates vs live distributor quotes.',
    rows: [
      { token: '{{PRICING_MODEL}}',     fills: 'Pricing model used',                  example: 'construction' },
      { token: '{{PRICING_SOURCE}}',    fills: 'Distributor quotes vs estimate flag', example: 'distributor_quotes' },
      { token: '{{PRICING_BASE}}',      fills: 'Year-1 bid amount',                   example: '$1,180,000' },
      { token: '{{PRICING_ESCALATED}}', fills: 'Final-year (escalated) amount',        example: '$1,387,000' },
      { token: '{{PRICING_TOTAL}}',     fills: 'Sum across all option years',          example: '$6,420,000' },
      { token: '{{PRICING_BREAKDOWN}}', fills: 'Multi-line breakdown (wages, materials, mobilization, bond, overhead, profit)', example: '  wages: $260,000\n  materials: $185,000\n  ...' },
      { token: '{{PRICING_NOTE}}',      fills: 'Pricing engine note (estimate flag, etc.)', example: 'ESTIMATED — no distributor quotes on file...' },
      { token: '{{COMPETITOR_AVG}}',    fills: 'Avg competitor bid (when known)',     example: '$1,205,000' },
    ],
  },
  {
    section: '6. Compliance (VAULT)',
    note: 'Compliance gates determined by VAULT’s daily run. Empty until VAULT has scanned this bid.',
    rows: [
      { token: '{{COMPLIANCE_STATUS}}', fills: 'ELIGIBLE / INELIGIBLE / pending',       example: 'ELIGIBLE' },
      { token: '{{COMPLIANCE_TABLE}}',  fills: 'Multi-line list of every check + result + note', example: '  • SAM.gov Active: PASS — UEI USMQMFAGL9M4\n  • LA Contractor License: PASS — active, expires 2026-09-30\n  • Bonding Capacity: WARN — contract value may exceed bonding limit …' },
    ],
  },
  {
    section: '7. Suppliers / Teaming',
    note: 'Top 10 supplier matches by score. Empty until RECON Supplier Scan has run.',
    rows: [
      { token: '{{SUPPLIER_LIST}}',  fills: 'Numbered list of top suppliers (name, state, score, certs)', example: '  1. Beck Group LLC (LA) · Score 87 · SDB, HUBZone\n  2. Brasfield & Gorrie (AL) · Score 82 · None on file\n  ...' },
      { token: '{{SUPPLIER_COUNT}}', fills: 'How many supplier matches were found',  example: '7' },
    ],
  },
];

// ── Document construction ───────────────────────────────────────────────
const HEADING_BLUE = '1F4E79';
const TABLE_HEADER = 'D5E8F0';
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const ALL_BORDERS  = { top: TABLE_BORDER, bottom: TABLE_BORDER, left: TABLE_BORDER, right: TABLE_BORDER, insideHorizontal: TABLE_BORDER, insideVertical: TABLE_BORDER };

function tokenTable(rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Token', 'What it fills in', 'Example output'].map((label, i) => new TableCell({
      width: { size: [2880, 3000, 3480][i], type: WidthType.DXA },
      shading: { fill: TABLE_HEADER, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
    })),
  });
  const dataRows = rows.map(r => new TableRow({
    children: [
      new TableCell({
        width: { size: 2880, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: r.token, font: 'Consolas', size: 18, color: '0070C0' })] })],
      }),
      new TableCell({
        width: { size: 3000, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: r.fills, size: 20 })] })],
      }),
      new TableCell({
        width: { size: 3480, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: r.example.split('\n').map(line =>
          new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18, color: '595959' })] })
        ),
      }),
    ],
  }));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2880, 3000, 3480],
    rows: [headerRow, ...dataRows],
  });
}

const children = [];

// Title
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'PRIME — Bid Template Token Reference', bold: true, size: 32, color: HEADING_BLUE })] }));
children.push(new Paragraph({ children: [new TextRun({ text: 'Walker Contractors LLC · DBA Axiom Federal Solutions', italics: true, size: 22, color: '595959' })] }));
children.push(new Paragraph({ children: [new TextRun({ text: '', size: 20 })] }));

// Intro
children.push(new Paragraph({ children: [
  new TextRun({ text: 'How to use this reference. ', bold: true, size: 22 }),
  new TextRun({ text: 'Replace any field in your bid template with the matching token below. The bid-draft agent (powered by Google Docs API + replaceAllText) substitutes the token with live data from the opportunity each time it runs. Tokens that don’t appear in your template are simply skipped — no errors. Tokens that match but the data isn’t available yet (e.g., BID ENGINE hasn’t run) are filled with an em-dash placeholder.', size: 22 }),
]}));
children.push(new Paragraph({ children: [new TextRun({ text: '', size: 20 })] }));

children.push(new Paragraph({ children: [
  new TextRun({ text: 'Format. ', bold: true, size: 22 }),
  new TextRun({ text: 'Tokens are case-sensitive and must be wrapped in double curly braces with no spaces inside (e.g., ', size: 22 }),
  new TextRun({ text: '{{TITLE}}', font: 'Consolas', size: 20, color: '0070C0' }),
  new TextRun({ text: ', not ', size: 22 }),
  new TextRun({ text: '{{ Title }}', font: 'Consolas', size: 20, color: 'C00000' }),
  new TextRun({ text: '). Tokens can appear anywhere in the document — paragraphs, tables, headers, footers, bullet lists.', size: 22 }),
]}));
children.push(new Paragraph({ children: [new TextRun({ text: '', size: 20 })] }));

// Sections
TOKENS.forEach((sec, idx) => {
  if (idx > 0) children.push(new Paragraph({ children: [new TextRun({ text: '', size: 20 })] }));
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sec.section, bold: true, size: 26, color: HEADING_BLUE })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: sec.note, italics: true, size: 20, color: '595959' })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: '', size: 12 })] }));
  children.push(tokenTable(sec.rows));
});

// Footer with page numbers
const footer = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: 'PRIME Bid Template Token Reference · ', size: 18, color: '808080' }),
      new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '808080' }),
      new TextRun({ text: ' / ', size: 18, color: '808080' }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '808080' }),
    ],
  })],
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Calibri', color: HEADING_BLUE },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Calibri', color: HEADING_BLUE },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    footers: { default: footer },
    children,
  }],
});

const outPath = 'PRIME-Bid-Template-Tokens.docx';
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('✅ Generated ' + outPath + ' (' + buf.length.toLocaleString() + ' bytes)');
  console.log('Open it in Word to see the token reference. Use it as you edit your template Doc.');
});
