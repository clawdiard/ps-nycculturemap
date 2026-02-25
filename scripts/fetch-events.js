/**
 * Fetches live event data from NYC cultural institution websites.
 * Scrapes public event pages and outputs events.json for the static site.
 * 
 * Sources:
 * - Lincoln Center: lincolncenter.org/calendar
 * - Carnegie Hall: carnegiehall.org/calendar
 * - Metropolitan Museum: metmuseum.org/events
 * - MoMA: moma.org/calendar
 * - NYPL: nypl.org/events
 * - BAM: bam.org/events
 * - Guggenheim, Whitney, Brooklyn Museum, etc.
 */

const https = require('https');
const fs = require('fs');

const SOURCES = [
  {
    institution: 'Lincoln Center for the Performing Arts',
    url: 'https://www.lincolncenter.org/calendar',
    parser: 'generic'
  },
  {
    institution: 'Carnegie Hall',
    url: 'https://www.carnegiehall.org/Calendar',
    parser: 'generic'
  },
  {
    institution: 'The Metropolitan Museum of Art',
    url: 'https://www.metmuseum.org/events',
    parser: 'generic'
  },
  {
    institution: 'Museum of Modern Art (MoMA)',
    url: 'https://www.moma.org/calendar/',
    parser: 'generic'
  },
  {
    institution: 'New York Public Library',
    url: 'https://www.nypl.org/events',
    parser: 'generic'
  },
  {
    institution: 'Brooklyn Academy of Music (BAM)',
    url: 'https://www.bam.org/events',
    parser: 'generic'
  },
  {
    institution: 'Guggenheim Museum',
    url: 'https://www.guggenheim.org/calendar',
    parser: 'generic'
  },
  {
    institution: 'Whitney Museum of American Art',
    url: 'https://whitney.org/events',
    parser: 'generic'
  },
  {
    institution: 'Brooklyn Museum',
    url: 'https://www.brooklynmuseum.org/visit/calendar',
    parser: 'generic'
  },
  {
    institution: 'American Museum of Natural History',
    url: 'https://www.amnh.org/calendar',
    parser: 'generic'
  },
  {
    institution: 'The Shed',
    url: 'https://theshed.org/program',
    parser: 'generic'
  },
  {
    institution: 'New York Botanical Garden',
    url: 'https://www.nybg.org/event/',
    parser: 'generic'
  }
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : require('http').get;
    get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EventBot/1.0)' }, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Generic HTML event parser.
 * Looks for common patterns: JSON-LD, schema.org Event markup, 
 * or structured event-like elements in the HTML.
 */
function parseJsonLd(html) {
  const events = [];
  const ldRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldRegex.exec(html)) !== null) {
    try {
      let parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed)) parsed = [parsed];
      for (const item of parsed) {
        const items = item['@graph'] || [item];
        for (const obj of items) {
          if (obj['@type'] === 'Event' || obj['@type']?.includes?.('Event')) {
            events.push({
              title: obj.name || obj.headline || '',
              date: obj.startDate || obj.datePublished || '',
              location: obj.location?.name || '',
              url: obj.url || ''
            });
          }
        }
      }
    } catch (e) { /* skip malformed JSON-LD */ }
  }
  return events;
}

function parseMetaTags(html) {
  const events = [];
  // Look for og:title + event date patterns in meta tags
  const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  // Also check for event-related microdata
  const eventBlocks = html.match(/itemprop=["']name["'][^>]*>([^<]+)/gi) || [];
  const dateBlocks = html.match(/itemprop=["']startDate["'][^>]*content=["']([^"']+)["']/gi) || [];
  
  for (let i = 0; i < Math.min(eventBlocks.length, 10); i++) {
    const nameMatch = eventBlocks[i].match(/>([^<]+)/);
    const dateMatch = dateBlocks[i]?.match(/content=["']([^"']+)["']/);
    if (nameMatch) {
      events.push({
        title: nameMatch[1].trim(),
        date: dateMatch ? dateMatch[1] : '',
        location: '',
        url: ''
      });
    }
  }
  return events;
}

async function fetchEvents(source) {
  try {
    const html = await fetch(source.url);
    let events = parseJsonLd(html);
    if (events.length === 0) {
      events = parseMetaTags(html);
    }
    return events.slice(0, 8).map(e => ({
      ...e,
      institution: source.institution,
      source: source.url,
      fetchedAt: new Date().toISOString()
    }));
  } catch (err) {
    console.warn(`Failed to fetch ${source.institution}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log(`Fetching events from ${SOURCES.length} institutions...`);
  const results = {};
  
  for (const source of SOURCES) {
    const events = await fetchEvents(source);
    if (events.length > 0) {
      results[source.institution] = events;
      console.log(`  ✓ ${source.institution}: ${events.length} events`);
    } else {
      console.log(`  ✗ ${source.institution}: no events found (will use fallback)`);
    }
  }
  
  const output = {
    lastUpdated: new Date().toISOString(),
    sources: SOURCES.length,
    totalEvents: Object.values(results).reduce((s, arr) => s + arr.length, 0),
    events: results
  };
  
  fs.writeFileSync('events.json', JSON.stringify(output, null, 2));
  console.log(`\nWrote events.json: ${output.totalEvents} events from ${Object.keys(results).length} sources`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
