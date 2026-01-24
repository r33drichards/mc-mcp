#!/usr/bin/env node
/**
 * Minecraft Wiki Respectful Crawler
 *
 * Uses the sitemap (explicitly allowed in robots.txt) and MediaWiki API
 * to fetch wiki content. Respects rate limits and licensing.
 *
 * License: Content is CC BY-NC-SA 3.0 - Non-commercial use only
 * Attribution: Content from https://minecraft.wiki/
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  baseUrl: 'https://minecraft.wiki',
  apiUrl: 'https://minecraft.wiki/api.php',
  sitemapIndex: 'https://minecraft.wiki/images/sitemaps/index.xml',
  outputDir: __dirname,

  // Rate limiting - be respectful
  delayBetweenRequests: 500, // ms between requests
  batchSize: 50, // pages per batch
  delayBetweenBatches: 2000, // ms between batches

  // What to fetch
  fetchWikitext: true, // Raw wikitext source
  fetchHtml: false, // Parsed HTML (larger, slower)
  fetchImages: false, // Image files (very large)

  // Filtering
  namespaces: [0], // 0 = main namespace (articles), add others as needed
  // Full list: 0=Main, 1=Talk, 2=User, 4=Project, 6=File, 10=Template, 14=Category

  maxPages: null, // Set to a number to limit (null = all)
  resumeFrom: null, // Page title to resume from (for interrupted crawls)
};

// Stats
const stats = {
  pagesProcessed: 0,
  pagesFailed: 0,
  bytesDownloaded: 0,
  startTime: Date.now(),
};

// Utility: HTTP GET with redirect following
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'MinecraftWikiCrawler/1.0 (Educational/Personal use; Respects robots.txt)',
        'Accept': 'application/json, text/xml, */*',
        ...options.headers,
      },
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, options).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        stats.bytesDownloaded += buffer.length;

        // Handle gzip
        if (url.endsWith('.gz') || res.headers['content-encoding'] === 'gzip') {
          zlib.gunzip(buffer, (err, unzipped) => {
            if (err) reject(err);
            else resolve(unzipped.toString('utf8'));
          });
        } else {
          resolve(buffer.toString('utf8'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Utility: Sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Safe filename
function safeFilename(title) {
  return title
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

// Utility: Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Parse sitemap index to get all sitemap URLs
async function getSitemapUrls() {
  console.log('Fetching sitemap index...');
  const xml = await fetchUrl(CONFIG.sitemapIndex);

  const sitemapUrls = [];
  const regex = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    sitemapUrls.push(match[1]);
  }

  console.log(`Found ${sitemapUrls.length} sitemaps`);
  return sitemapUrls;
}

// Parse a sitemap to get page URLs
async function getPageUrlsFromSitemap(sitemapUrl) {
  const xml = await fetchUrl(sitemapUrl);

  const urls = [];
  const regex = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1]);
  }

  return urls;
}

// Extract page title from URL
function getTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/w/');
    if (pathParts.length > 1) {
      return decodeURIComponent(pathParts[1].replace(/_/g, ' '));
    }
  } catch (e) {}
  return null;
}

// Fetch page content via MediaWiki API
export async function fetchPageContent(title) {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'revisions|info',
    rvprop: 'content|timestamp',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  });

  const url = `${CONFIG.apiUrl}?${params}`;
  const response = await fetchUrl(url);
  const data = JSON.parse(response);

  if (data.query && data.query.pages && data.query.pages.length > 0) {
    const page = data.query.pages[0];
    if (page.missing) {
      return null;
    }

    return {
      title: page.title,
      pageid: page.pageid,
      ns: page.ns,
      timestamp: page.revisions?.[0]?.timestamp,
      content: page.revisions?.[0]?.slots?.main?.content,
    };
  }

  return null;
}

// Fetch multiple pages in one API call (more efficient)
async function fetchPagesBatch(titles) {
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'revisions|info',
    rvprop: 'content|timestamp',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  });

  const url = `${CONFIG.apiUrl}?${params}`;
  const response = await fetchUrl(url);
  const data = JSON.parse(response);

  const results = [];
  if (data.query && data.query.pages) {
    for (const page of data.query.pages) {
      if (!page.missing) {
        results.push({
          title: page.title,
          pageid: page.pageid,
          ns: page.ns,
          timestamp: page.revisions?.[0]?.timestamp,
          content: page.revisions?.[0]?.slots?.main?.content,
        });
      }
    }
  }

  return results;
}

// Save page to disk
function savePage(page) {
  const filename = safeFilename(page.title);
  const dir = path.join(CONFIG.outputDir, 'pages');
  ensureDir(dir);

  // Save wikitext
  if (CONFIG.fetchWikitext && page.content) {
    const wikitextPath = path.join(dir, `${filename}.wiki`);
    fs.writeFileSync(wikitextPath, page.content, 'utf8');
  }

  // Save metadata
  const metaPath = path.join(dir, `${filename}.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    title: page.title,
    pageid: page.pageid,
    ns: page.ns,
    timestamp: page.timestamp,
    source: 'https://minecraft.wiki/w/' + encodeURIComponent(page.title.replace(/ /g, '_')),
    license: 'CC BY-NC-SA 3.0',
    attribution: 'Content from Minecraft Wiki (https://minecraft.wiki/)',
  }, null, 2), 'utf8');
}

// Get all page titles using API (alternative to sitemap)
export async function getAllPageTitles(namespace = 0) {
  const titles = [];
  let continueToken = null;

  console.log(`Fetching page list for namespace ${namespace}...`);

  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'allpages',
      apnamespace: namespace,
      aplimit: '500',
      format: 'json',
    });

    if (continueToken) {
      params.set('apcontinue', continueToken);
    }

    const url = `${CONFIG.apiUrl}?${params}`;
    const response = await fetchUrl(url);
    const data = JSON.parse(response);

    if (data.query && data.query.allpages) {
      for (const page of data.query.allpages) {
        titles.push(page.title);
      }
    }

    continueToken = data.continue?.apcontinue;

    if (titles.length % 5000 === 0) {
      console.log(`  Found ${titles.length} pages so far...`);
    }

    await sleep(CONFIG.delayBetweenRequests);
  } while (continueToken);

  console.log(`Found ${titles.length} pages in namespace ${namespace}`);
  return titles;
}

// Main crawl function
export async function crawl(options = {}) {
  // Merge options with defaults
  Object.assign(CONFIG, options);

  console.log('='.repeat(60));
  console.log('Minecraft Wiki Crawler - Respectful Edition');
  console.log('='.repeat(60));
  console.log('');
  console.log('License: CC BY-NC-SA 3.0 - Non-commercial use only');
  console.log('Source: https://minecraft.wiki/');
  console.log('');

  // Create output directories
  ensureDir(path.join(CONFIG.outputDir, 'pages'));

  // Get all page titles
  let allTitles = [];
  for (const ns of CONFIG.namespaces) {
    const titles = await getAllPageTitles(ns);
    allTitles = allTitles.concat(titles);
  }

  console.log(`\nTotal pages to fetch: ${allTitles.length}`);

  // Apply limits
  if (CONFIG.resumeFrom) {
    const idx = allTitles.indexOf(CONFIG.resumeFrom);
    if (idx !== -1) {
      allTitles = allTitles.slice(idx);
      console.log(`Resuming from "${CONFIG.resumeFrom}" (${allTitles.length} remaining)`);
    }
  }

  if (CONFIG.maxPages) {
    allTitles = allTitles.slice(0, CONFIG.maxPages);
    console.log(`Limited to ${CONFIG.maxPages} pages`);
  }

  // Process in batches
  const batches = [];
  for (let i = 0; i < allTitles.length; i += CONFIG.batchSize) {
    batches.push(allTitles.slice(i, i + CONFIG.batchSize));
  }

  console.log(`Processing ${batches.length} batches of ${CONFIG.batchSize} pages each\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const progress = ((i + 1) / batches.length * 100).toFixed(1);

    console.log(`Batch ${i + 1}/${batches.length} (${progress}%) - ${batch[0]} ... ${batch[batch.length - 1]}`);

    try {
      const pages = await fetchPagesBatch(batch);

      for (const page of pages) {
        savePage(page);
        stats.pagesProcessed++;
      }

      stats.pagesFailed += batch.length - pages.length;

    } catch (err) {
      console.error(`  Error: ${err.message}`);
      stats.pagesFailed += batch.length;
    }

    // Rate limiting
    if (i < batches.length - 1) {
      await sleep(CONFIG.delayBetweenBatches);
    }
  }

  // Final stats
  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('Crawl Complete!');
  console.log('='.repeat(60));
  console.log(`Pages processed: ${stats.pagesProcessed}`);
  console.log(`Pages failed: ${stats.pagesFailed}`);
  console.log(`Data downloaded: ${(stats.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Time elapsed: ${elapsed.toFixed(1)} seconds`);
  console.log(`\nOutput saved to: ${path.join(CONFIG.outputDir, 'pages')}`);
}

// Run if called directly
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('crawler.js')
);

if (isMain) {
  crawl().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
