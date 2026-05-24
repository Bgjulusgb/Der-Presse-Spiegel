'use strict';

const logger = require('./logger');

// Per-Website Adapters for custom RSS fetching, header tweaking, and extraction rules
// Maps site domains to custom strategies for problematic feeds that fail with standard approach

const SITE_ADAPTERS = {
  'saechsische.de': {
    name: 'Saechsische Zeitung',
    priority: 70,
    // Known working alternative feed endpoints (verified 2026)
    // Source: GitHub rss feed databases, rss-verzeichnis.de
    alternative_feeds: [
      'http://www.sz-online.de/Sachsen.rss',
      'http://www.sz-online.de/Kultur.rss',
      'http://www.sz-online.de/Politik.rss',
      'https://www.saechsische.de/rss/feuilleton',
      'https://www.saechsische.de/feeds/xml/topnews/',
      'https://www.saechsische.de/feeds/xml/sachsen/',
    ],
    // Custom header profile for this domain
    custom_headers: {
      'Referer': 'https://www.saechsische.de/',
      'Origin': 'https://www.saechsische.de',
      'Accept': 'application/rss+xml, application/xml, */*;q=0.1',
    },
    // Specific extraction selectors if HTML fallback needed
    article_selectors: [
      'article.artikel',
      'div.artikel',
      'div.story',
      'div.newsitem',
    ],
    use_browser_fallback: true,
    retry_delay: 5000,
    notes: '403 errors require browser or specific feed paths'
  },

  'lvz.de': {
    name: 'Leipziger Volkszeitung',
    priority: 75,
    alternative_feeds: [
      'https://www.lvz.de/feeds/',
      'https://www.lvz.de/feeds/nachrichten/',
      'https://www.lvz.de/feeds/kultur/',
    ],
    custom_headers: {
      'Referer': 'https://www.lvz.de/',
    },
    use_browser_fallback: true,
    retry_delay: 4000,
    notes: '403/blocked, try alternative feed paths'
  },

  'aachener-zeitung.de': {
    name: 'Aachener Zeitung',
    priority: 75,
    alternative_feeds: [
      'https://www.aachener-zeitung.de/feeds/',
      'https://www.aachener-zeitung.de/feeds/nachrichten/',
    ],
    custom_headers: {
      'Referer': 'https://www.aachener-zeitung.de/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    use_browser_fallback: true,
    retry_delay: 4000,
    notes: '403 errors, browser fallback recommended'
  },

  'ruhrnachrichten.de': {
    name: 'Ruhr Nachrichten',
    priority: 75,
    alternative_feeds: [
      'https://www.ruhrnachrichten.de/feeds/nachrichten/',
      'https://www.ruhrnachrichten.de/feeds/',
    ],
    custom_headers: {
      'Referer': 'https://www.ruhrnachrichten.de/',
    },
    use_browser_fallback: true,
    retry_delay: 5000,
    notes: 'Redirect loop issues, use browser rendering'
  },

  'generalanzeiger-bonn.de': {
    name: 'General-Anzeiger Bonn',
    priority: 70,
    alternative_feeds: [
      'https://www.general-anzeiger-bonn.de/feeds/',
      'https://www.general-anzeiger-bonn.de/feeds/nachrichten/',
    ],
    custom_headers: {
      'Referer': 'https://www.general-anzeiger-bonn.de/',
    },
    use_browser_fallback: true,
    retry_delay: 5000,
    notes: 'Excessive redirects, requires browser'
  },

  'freitag.de': {
    name: 'Der Freitag',
    priority: 70,
    alternative_feeds: [
      'https://www.freitag.de/rss.xml',
      'https://www.freitag.de/feeds/rss/',
      'https://www.freitag.de/section/kultur/rss',
    ],
    custom_headers: {
      'Referer': 'https://www.freitag.de/',
    },
    use_browser_fallback: true,
    retry_delay: 5000,
    notes: 'Redirect loop, multiple feed formats available'
  },

  'taz.de': {
    name: 'taz',
    priority: 85,
    alternative_feeds: [
      'https://taz.de/index.rss',
      'https://taz.de/!p2;rss/',
      'https://taz.de/rss/',
    ],
    custom_headers: {
      'Referer': 'https://taz.de/',
      'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    },
    use_browser_fallback: true,
    retry_delay: 3000,
    notes: 'Redirect issues, prefer native RSS over custom URLs'
  },

  'deutschlandfunk.de': {
    name: 'Deutschlandfunk',
    priority: 95,
    alternative_feeds: [
      'https://www.deutschlandfunk.de/aktuell.rss',
      'https://www.deutschlandfunk.de/kultur.rss',
      'https://www.deutschlandfunk.de/kultur-100.rss',
    ],
    custom_headers: {
      'Referer': 'https://www.deutschlandfunk.de/',
    },
    use_browser_fallback: false,
    retry_delay: 2000,
    notes: 'Invalid URLs in config, use standard paths'
  },

  'deutschlandfunkkultur.de': {
    name: 'Deutschlandfunk Kultur',
    priority: 95,
    alternative_feeds: [
      'https://www.deutschlandfunkkultur.de/buehne.rss',
      'https://www.deutschlandfunkkultur.de/buehne-100.rss',
      'https://www.deutschlandfunkkultur.de/feuilleton.rss',
      'https://www.deutschlandfunkkultur.de/kultur.rss',
    ],
    custom_headers: {
      'Referer': 'https://www.deutschlandfunkkultur.de/',
    },
    use_browser_fallback: false,
    retry_delay: 2000,
    notes: 'URL format changed, use standard RSS paths'
  },

  'backstagepro.de': {
    name: 'BackstagePRO',
    priority: 65,
    alternative_feeds: [
      'https://www.backstagepro.de/feed',
      'https://www.backstagepro.de/rss.xml',
    ],
    use_browser_fallback: true,
    retry_delay: 5000,
    notes: 'Puppeteer issues, requires specific handling'
  },

  'theaterkompass.de': {
    name: 'Theaterkompass',
    priority: 70,
    // Working FeedBurner feed (verified 2026)
    // Source: https://theaterkompass.de/service/rss-service
    alternative_feeds: [
      'https://feeds.feedburner.com/Theaterkompass',
      'https://www.theaterkompass.de/rss/',
      'https://www.theaterkompass.de/rss.php',
    ],
    use_browser_fallback: false,
    retry_delay: 3000,
    notes: 'FeedBurner hosted, primary source for theater news'
  },

  'vanmagazin.de': {
    name: 'VAN Magazin',
    priority: 75,
    alternative_feeds: [
      'https://van-magazin.de/feed/',
      'https://van-magazin.de/category/klassik/feed/',
    ],
    use_browser_fallback: true,
    retry_delay: 4000,
    notes: 'Puppeteer Timeout, alternate feeds'
  },
};

// Get adapter config for a domain or feed name
function getAdapter(urlOrName) {
  if (!urlOrName) return null;

  // Try direct domain lookup
  for (const [domain, config] of Object.entries(SITE_ADAPTERS)) {
    if (urlOrName.includes(domain) || urlOrName.includes(config.name)) {
      return { domain, ...config };
    }
  }

  // Try partial name match
  const nameNormalized = urlOrName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [domain, config] of Object.entries(SITE_ADAPTERS)) {
    const domainNorm = domain.replace(/[^a-z0-9]/g, '');
    const nameNorm = config.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nameNormalized.includes(domainNorm) || nameNormalized.includes(nameNorm)) {
      return { domain, ...config };
    }
  }

  return null;
}

// Try alternative feed URLs for a domain
async function tryAlternativeFeed(domain, fetchFunction) {
  const adapter = getAdapter(domain);
  if (!adapter || !adapter.alternative_feeds) return null;

  logger.info(`Versuche alternative Feeds fuer ${domain}...`);
  for (const altUrl of adapter.alternative_feeds) {
    try {
      logger.debug(`  -> ${altUrl}`);
      const result = await fetchFunction(altUrl, {
        headers: adapter.custom_headers || {},
        timeout: 15000,
      });
      if (result && result.status === 'ok' && result.items.length > 0) {
        logger.info(`  ✓ Alternative Feed erfolgreich: ${altUrl}`);
        return result;
      }
    } catch (err) {
      logger.debug(`  ✗ ${altUrl} fehlgeschlagen: ${err.message}`);
    }
  }
  return null;
}

// Get retry config for a domain
function getRetryConfig(domain) {
  const adapter = getAdapter(domain);
  if (!adapter) return { delay: 3000, useBrowser: false };
  return {
    delay: adapter.retry_delay || 3000,
    useBrowser: adapter.use_browser_fallback !== false,
  };
}

module.exports = {
  SITE_ADAPTERS,
  getAdapter,
  tryAlternativeFeed,
  getRetryConfig,
};
