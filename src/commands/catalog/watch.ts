import { Command } from 'commander';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn, log } from '../../utils/logger.js';

/**
 * Known NIST OSCAL content URLs for pre-seeding.
 */
const KNOWN_SOURCES: Array<{ shortName: string; url: string; format: string }> = [
  {
    shortName: 'nist-800-53-r5',
    url: 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json',
    format: 'oscal',
  },
  {
    shortName: 'nist-800-171-r3',
    url: 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json',
    format: 'oscal',
  },
  {
    shortName: 'nist-csf-2.0',
    url: 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/CSF/v2.0/json/NIST_CSF_v2.0_catalog.json',
    format: 'oscal',
  },
];

/**
 * Registers `attesting catalog watch` subcommands.
 */
export function registerCatalogWatch(catalogCommand: Command): void {
  const watchCommand = catalogCommand
    .command('watch')
    .description('Monitor upstream catalog sources for updates');

  watchCommand
    .command('list')
    .description('List all watched catalog sources')
    .action(runWatchList);

  watchCommand
    .command('check')
    .description('Check all watched sources for updates')
    .action(runWatchCheck);

  watchCommand
    .command('add')
    .description('Add a new catalog source to the watch list')
    .requiredOption('--url <url>', 'Upstream source URL')
    .requiredOption('--catalog <shortName>', 'Associated catalog short name')
    .option('--format <format>', 'Source format (oscal|csv)', 'oscal')
    .option('--auto-download', 'Automatically download when changes detected')
    .action(runWatchAdd);

  watchCommand
    .command('seed')
    .description('Pre-seed watch list with known NIST OSCAL sources')
    .action(runWatchSeed);
}

// ---------------------------------------------------------------------------
// Ensure table exists (for existing databases that predate this feature)
// ---------------------------------------------------------------------------

function ensureWatchTable(database: import('better-sqlite3').Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS catalog_watches (
      id TEXT PRIMARY KEY,
      catalog_short_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT 'oscal',
      last_hash TEXT,
      last_checked_at TEXT,
      last_changed_at TEXT,
      auto_download INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ---------------------------------------------------------------------------
// watch list
// ---------------------------------------------------------------------------

interface WatchRow {
  id: string;
  catalog_short_name: string;
  source_url: string;
  source_format: string;
  last_hash: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  auto_download: number;
}

function runWatchList(): void {
  const database = db.getDb();
  ensureWatchTable(database);

  const rows = database
    .prepare('SELECT * FROM catalog_watches ORDER BY catalog_short_name')
    .all() as WatchRow[];

  if (rows.length === 0) {
    warn('No watched sources. Run `attesting catalog watch seed` to add known NIST sources.');
    return;
  }

  log('');
  log('Watched catalog sources:');
  log('─'.repeat(100));

  for (const row of rows) {
    const checked = row.last_checked_at ?? 'never';
    const changed = row.last_changed_at ?? 'unknown';
    const auto = row.auto_download ? ' [auto-download]' : '';
    log(`  ${row.catalog_short_name}`);
    log(`    URL:     ${row.source_url}`);
    log(`    Format:  ${row.source_format}  |  Last checked: ${checked}  |  Last changed: ${changed}${auto}`);
    if (row.last_hash) {
      log(`    Hash:    ${row.last_hash.slice(0, 16)}…`);
    }
    log('');
  }
}

// ---------------------------------------------------------------------------
// watch check
// ---------------------------------------------------------------------------

async function runWatchCheck(): Promise<void> {
  const database = db.getDb();
  ensureWatchTable(database);

  const rows = database
    .prepare('SELECT * FROM catalog_watches ORDER BY catalog_short_name')
    .all() as WatchRow[];

  if (rows.length === 0) {
    warn('No watched sources. Run `attesting catalog watch seed` to add known sources.');
    return;
  }

  info(`Checking ${rows.length} watched source(s)…`);
  log('');

  let changedCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    process.stdout.write(`  Checking ${row.catalog_short_name}… `);

    try {
      const content = await fetchUrl(row.source_url);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const timestamp = now();

      if (row.last_hash && row.last_hash === hash) {
        log('no changes');
      } else if (!row.last_hash) {
        log(`baseline set (hash: ${hash.slice(0, 16)}…)`);
        database
          .prepare(
            'UPDATE catalog_watches SET last_hash = ?, last_checked_at = ?, last_changed_at = ? WHERE id = ?'
          )
          .run(hash, timestamp, timestamp, row.id);
      } else {
        changedCount++;
        log(`CHANGED (old: ${row.last_hash.slice(0, 8)}… → new: ${hash.slice(0, 8)}…)`);
        warn(`  ⚡ ${row.catalog_short_name} has been updated upstream!`);
        info(`     Re-import with: attesting catalog update --old ${row.catalog_short_name} --new-file <downloaded-file> --format ${row.source_format} …`);

        database
          .prepare(
            'UPDATE catalog_watches SET last_hash = ?, last_checked_at = ?, last_changed_at = ? WHERE id = ?'
          )
          .run(hash, timestamp, timestamp, row.id);
      }

      // Update last_checked_at even if unchanged
      database
        .prepare('UPDATE catalog_watches SET last_checked_at = ? WHERE id = ?')
        .run(timestamp, row.id);
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${msg}`);
    }
  }

  log('');
  if (changedCount > 0) {
    warn(`${changedCount} source(s) have changed since last check.`);
  } else if (errorCount === 0) {
    success('All sources unchanged.');
  }
  if (errorCount > 0) {
    error(`${errorCount} source(s) could not be checked.`);
  }
}

// ---------------------------------------------------------------------------
// watch add
// ---------------------------------------------------------------------------

interface WatchAddOptions {
  url: string;
  catalog: string;
  format: string;
  autoDownload?: boolean;
}

function runWatchAdd(options: WatchAddOptions): void {
  const database = db.getDb();
  ensureWatchTable(database);

  // Check for duplicate
  const existing = database
    .prepare('SELECT id FROM catalog_watches WHERE source_url = ? AND catalog_short_name = ?')
    .get(options.url, options.catalog);
  if (existing) {
    warn(`Watch already exists for ${options.catalog} with this URL.`);
    return;
  }

  database
    .prepare(
      `INSERT INTO catalog_watches (id, catalog_short_name, source_url, source_format, auto_download, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(generateUuid(), options.catalog, options.url, options.format,
      options.autoDownload ? 1 : 0, now());

  success(`Added watch for ${options.catalog}: ${options.url}`);
}

// ---------------------------------------------------------------------------
// watch seed
// ---------------------------------------------------------------------------

function runWatchSeed(): void {
  const database = db.getDb();
  ensureWatchTable(database);

  let added = 0;
  for (const src of KNOWN_SOURCES) {
    const existing = database
      .prepare('SELECT id FROM catalog_watches WHERE source_url = ?')
      .get(src.url);
    if (existing) continue;

    database
      .prepare(
        `INSERT INTO catalog_watches (id, catalog_short_name, source_url, source_format, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(generateUuid(), src.shortName, src.url, src.format, now());
    added++;
  }

  if (added > 0) {
    success(`Seeded ${added} known NIST OSCAL source(s).`);
  } else {
    info('All known sources already in watch list.');
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (Node built-in, no external deps)
// ---------------------------------------------------------------------------

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    const request = client.get(url, { headers: { 'User-Agent': 'attesting-cli/0.1' } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}
