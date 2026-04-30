import * as fs from 'fs';
import { db } from '../db/connection.js';
import { generateUuid } from '../utils/uuid.js';
import { now } from '../utils/dates.js';

/**
 * Maps a column letter (A, B, C, ...) to a zero-based index.
 * Supports single uppercase letters only (A=0, Z=25).
 */
function letterToIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
}

/**
 * Parses a CSV string into rows of string arrays.
 * Handles:
 *  - Quoted fields that may contain commas or newlines
 *  - Double-quote escaping inside quoted fields ("")
 *  - CRLF and LF line endings
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        // Peek ahead: doubled quote is an escaped quote
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && content[i + 1] === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i += 2;
        continue;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }

    i++;
  }

  // Flush any trailing content
  if (field !== '' || row.length > 0) {
    row.push(field);
    // Skip empty trailing rows (common with trailing newlines)
    if (row.some((f) => f !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

/** Maps field names to column letter identifiers. */
export interface ColumnMapping {
  control_id: string;
  title?: string;
  description?: string;
  guidance?: string;
  category?: string;
  [key: string]: string | undefined;
}

export interface ImportResult {
  imported: number;
  errors: string[];
}

/**
 * Imports controls from a CSV file into the given catalog.
 *
 * @param filePath      Absolute path to the CSV file.
 * @param catalogId     UUID of the target catalog record.
 * @param columnMapping Maps field names to column letters (A=0, B=1, …).
 * @param options       Optional flags. `skipHeader` (default true) drops the
 *                      first row before importing. Bundled catalogs without
 *                      header rows pass `skipHeader: false`.
 * @returns             Count of successfully imported controls and any errors.
 */
export function importCsvCatalog(
  filePath: string,
  catalogId: string,
  columnMapping: ColumnMapping,
  options?: { skipHeader?: boolean }
): ImportResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsv(content);

  if (rows.length === 0) {
    return { imported: 0, errors: ['CSV file is empty'] };
  }

  const skipHeader = options?.skipHeader ?? true;
  const dataRows = skipHeader ? rows.slice(1) : rows;

  const database = db.getDb();

  const insert = database.prepare(
    `INSERT INTO controls
       (id, catalog_id, control_id, title, description, guidance, metadata, sort_order, created_at)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const errors: string[] = [];
  let imported = 0;

  const insertMany = database.transaction(() => {
    dataRows.forEach((row, rowIndex) => {
      const sortOrder = rowIndex;

      // Helper: get a field value by column letter, falling back to empty string
      const get = (letter: string | undefined): string | null => {
        if (!letter) return null;
        const idx = letterToIndex(letter);
        return row[idx]?.trim() ?? null;
      };

      const fileRow = rowIndex + (skipHeader ? 2 : 1);
      const controlId = get(columnMapping.control_id);
      if (!controlId) {
        errors.push(
          `Row ${fileRow}: missing control_id (column ${columnMapping.control_id})`
        );
        return;
      }

      const title = get(columnMapping.title) ?? controlId;
      const description = get(columnMapping.description);
      const guidance = get(columnMapping.guidance);

      // Build a metadata JSON with any extra mapped columns (e.g. category)
      const metaObj: Record<string, string> = {};
      if (columnMapping.category) {
        const cat = get(columnMapping.category);
        if (cat) metaObj['category'] = cat;
      }

      try {
        insert.run(
          generateUuid(),
          catalogId,
          controlId,
          title,
          description,
          guidance,
          JSON.stringify(metaObj),
          sortOrder,
          now()
        );
        imported++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${fileRow} (${controlId}): ${msg}`);
      }
    });
  });

  insertMany();

  return { imported, errors };
}
