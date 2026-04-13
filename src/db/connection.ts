import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname shim (tsconfig module=NodeNext)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Splits a SQL file into individual statements, respecting parentheses
 * (so CHECK constraints and CREATE TABLE bodies don't get split mid-statement).
 */
/**
 * Splits a SQL file into individual statements, respecting parentheses
 * (so CHECK constraints and CREATE TABLE bodies don't get split mid-statement).
 * Strips SQL comment lines (-- ...) before splitting.
 */
function splitSqlStatements(sql: string): string[] {
  // First strip comment-only lines so they don't interfere with splitting
  const cleaned = sql.split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const stmts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of cleaned) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ';' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) stmts.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }
  const last = current.trim();
  if (last) stmts.push(last);
  return stmts;
}

/**
 * DatabaseManager handles the SQLite connection lifecycle.
 * The database file lives at ~/.attesting/attesting.db.
 * On first connect the schema is applied if the database is empty.
 */
export class DatabaseManager {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor() {
    const dir = path.join(os.homedir(), '.attesting');
    this.dbPath = path.join(dir, 'attesting.db');

    // Ensure the directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Returns the open Database instance, initializing it on first call.
   */
  getDb(): Database.Database {
    if (this.db) {
      return this.db;
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency characteristics
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Apply schema if the database is brand new (no tables yet)
    const tableCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
        .get() as { cnt: number }
    ).cnt;

    if (tableCount === 0) {
      this.applySchema();
    }

    // Apply any pending migrations
    this.applyMigrations();

    return this.db;
  }

  /**
   * Reads schema.sql from the package root (works for both tsx dev and dist/ build)
   * and executes it against the open database.
   */
  private applySchema(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const schemaPath = this.resolveSchemaPath();
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

    // Execute the entire schema in a single transaction
    this.db.exec(schemaSql);
  }

  /**
   * Walks up from __dirname to find schema.sql regardless of whether
   * we are running from src/ (via tsx) or dist/ (compiled build).
   */
  private resolveSchemaPath(): string {
    // Try relative paths from __dirname outward
    const candidates = [
      // Running via tsx: __dirname = src/db
      path.join(__dirname, 'schema.sql'),
      // Running from dist/db after tsc build
      path.join(__dirname, '../../src/db/schema.sql'),
      // Fallback: project root relative
      path.join(__dirname, '../db/schema.sql'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `schema.sql not found. Searched:\n${candidates.join('\n')}`
    );
  }

  /**
   * Closes the database connection if open.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Applies numbered SQL migration files from src/db/migrations/.
   * Tracks which migrations have been applied in a `_migrations` table
   * so each file runs exactly once, in order.
   */
  private applyMigrations(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const migrationsDir = this.resolveMigrationsDir();
    if (!migrationsDir) return;

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const applied = new Set(
      (this.db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[])
        .map(r => r.filename)
    );

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      this.db.transaction(() => {
        // Split on semicolons that are NOT inside parentheses (to avoid
        // breaking CREATE TABLE statements with CHECK constraints)
        const stmts = splitSqlStatements(sql);
        for (const stmt of stmts) {
          try {
            this.db!.exec(stmt + ';');
          } catch (err: any) {
            // Tolerate "duplicate column" and "already exists" errors
            // from ALTER TABLE on columns that were added by schema.sql
            if (!err.message.includes('duplicate column')
                && !err.message.includes('already exists')) {
              throw err;
            }
          }
        }
        this.db!.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
      })();
    }
  }

  /**
   * Locates the migrations directory relative to __dirname.
   */
  private resolveMigrationsDir(): string | null {
    const candidates = [
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '../../src/db/migrations'),
      path.join(process.cwd(), 'src/db/migrations'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    return null;
  }
}

/** Singleton database manager instance for the process lifetime. */
export const db = new DatabaseManager();
