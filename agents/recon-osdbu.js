// =============================================================
// RECON-OSDBU.JS — Agency OSDBU Event Finder
// JOB: Scrape 8 agency OSDBU pages for matchmaking events.
//      Create calendar entries with registration links.
//      Generate agency-tailored talking points for each event.
// SCHEDULE: Monday 9 AM UTC (osdbu-event-finder.yml)
// OSDBU = Office of Small & Disadvantaged Business Utilization
// COST: ~$1/month (Haiku for talking points generation)
// =============================================================

const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// Walker Contractors company profile for tailored talking points
const COMPANY = {
  name: 'Walker Contractors LLC',
  dba: 'Axiom Federal Solutions',
  owner: 'Joseph Walker IV',
  certifications: 'SDB (8(a) pending, HUBZone pending)',
  specialty: 'Federal construction, commercial building, civil infrastructure — Gulf South region',
  naics_primary: '236220',
  hq: 'New Orleans, LA',
};

// 8 agency OSDBU pages to monitor
const OSDBU_PAGES = [
  {
    agency: 'Army Corps of Engineers',
    url: 'https://www.usace.army.mil/Business-With-Us/Small-Business/',
    keywords: ['small business', 'matchmaking', 'event', 'workshop', 'training'],
  },
  {
    agency: 'Veterans Affairs',
    url: 'https://www.va.gov/osdbu/',
    keywords: ['matchmaking', 'vendor outreach', 'construction', 'event'],
  },
  {
    agency: 'GSA',
    url: 'https://www.gsa.gov/buying-selling/small-business-utilization',
    keywords: ['small business', 'event', 'conference', 'matchmaking'],
  },
  {
    agency: 'DHS',
    url: 'https://www.dhs.gov/osdbu',
    keywords: ['small business', 'event', 'construction', 'matchmaking'],
  },
  {
    agency: 'Air Force',
    url: 'https://www.afsbirsttr.af.mil/',
    keywords: ['small business', 'event', 'matchmaking', 'construction'],
  },
  {
    agency: 'Navy',
    url: 'https://www.secnav.navy.mil/smallbusiness/Pages/default.aspx',
    keywords: ['small business', 'event', 'construction', 'matchmaking'],
  },
  {
    agency: 'DLA',
    url: 'https://www.dla.mil/SmallBusiness/',
    keywords: ['small business', 'event', 'matchmaking', 'training'],
  },
  {
    agency: 'SBA',
    url: 'https://www.sba.gov/events',
    keywords: ['construction', 'federal contracting', '8(a)', 'HUBZone', 'SDB'],
  },
];

// ----------------------------------------------------------
// MAIN: Run weekly OSDBU event scan
// ----------------------------------------------------------
async function runOSDBUEventFinder() {
  console.log('RECON OSDBU: Scanning agency OSDBU pages for events...');

  try {
    let eventsFound = 0;

    for (const page of OSDBU_PAGES) {
      const found = await scanOSDBUPage(page);
      eventsFound += found;
    }

    await logAction('RECON', 'OSDBU event scan complete', {
      pages_scanned: OSDBU_PAGES.length,
      events_found: eventsFound,
      agencies: OSDBU_PAGES.map(p => p.agency),
    });

    console.log('RECON OSDBU: Scan complete. ' + eventsFound + ' events found.');

  } catch (err) {
    console.error('RECON OSDBU ERROR:', err.message);
    await logAction('RECON', 'OSDBU event scan failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SCAN: Check one OSDBU page for upcoming events
// ----------------------------------------------------------
async function scanOSDBUPage(page) {
  console.log('RECON OSDBU: Scanning ' + page.agency + '...');

  try {
    const response = await fetch(page.url, {
      headers: { 'User-Agent': 'PRIME Federal Contracting Intelligence System' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn('RECON OSDBU: Could not reach ' + page.agency + ' (' + response.status + ')');
      return 0;
    }

    const text = await response.text();
    const lowerText = text.toLowerCase();

    // 2026-05-02: tightened event detection. The original check
    // `keywords.some(...)` matched every OSDBU page because the words
    // "small business" appear on all of them — false-positive every Monday.
    // Now we require BOTH:
    //   (a) at least 2 distinct event keywords matched, AND
    //   (b) at least one signal that there's an actual scheduled event
    //       (a date pattern, registration link, or RSVP/register CTA).
    // Misses are better than spam — Mr. Kemp won't bother reading the brief
    // if it's full of "events" that don't exist.
    const matchedKeywords = page.keywords.filter(kw => lowerText.includes(kw.toLowerCase()));
    const hasEventSignal = (
      /\b(20\d{2})\b/.test(text) &&                                                // year mention
      /(register|rsvp|sign[\s-]?up|join us|webinar|conference)/i.test(text) &&     // CTA
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)/i.test(text) // month name
    );

    if (matchedKeywords.length < 2 || !hasEventSignal) {
      // Page is online but doesn't show an actual scheduled event right now.
      return 0;
    }

    // Generate agency-tailored talking points using Haiku
    const talkingPoints = await claudeHaiku(
      'Generate 5 specific talking points for ' + COMPANY.name + ' (' + COMPANY.dba + ') ' +
      'to use at a ' + page.agency + ' OSDBU matchmaking event. ' +
      'Company profile: ' + JSON.stringify(COMPANY) + '. ' +
      'Format: 5 bullet points. Each point should: ' +
      '(1) Connect Walker Contractors capabilities to ' + page.agency + ' mission, ' +
      '(2) Reference a specific program, project type, or NAICS code, ' +
      '(3) Be 1-2 sentences max. Lead with a differentiator.'
    );

    // Check if this event is already tracked
    const { data: existing } = await supabase
      .from('osdbu_events')
      .select('id')
      .eq('agency', page.agency)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .single();

    if (!existing) {
      // Store the event
      await supabase.from('osdbu_events').insert({
        agency: page.agency,
        event_name: page.agency + ' OSDBU Event — Detected',
        event_type: 'matchmaking',
        registration_url: page.url,
        registered: false,
        attended: false,
      });

      await logAction('RECON', 'OSDBU event found', {
        agency: page.agency,
        url: page.url,
        talking_points: talkingPoints,
        action: 'Review talking points in Brandi brief and register for event',
      });

      return 1;
    }

    return 0;

  } catch (err) {
    console.warn('RECON OSDBU: Error scanning ' + page.agency + ' — ' + err.message);
    return 0;
  }
}

// Run when file is executed
runOSDBUEventFinder();
