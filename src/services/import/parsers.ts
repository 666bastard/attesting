import * as fs from 'fs';
import ExcelJS from 'exceljs';
import type { ImportFormat } from './detect-format.js';

// Phase 5M follow-up: swapped `xlsx` (GHSA-4r6h-8v6p-xvw6 + GHSA-5pgg-2g8v-p4x9,
// no upstream fix available) for `exceljs` (already a dep, used in the SIG and
// SOA exporters). ExcelJS is Promise-based, so the xlsx parsers became async —
// the sync surface of `parseFile` grew a `Promise` return.

export interface ImportPreviewControl {
  control_id: string;
  title: string;
  description?: string;
  family?: string;
  source_row?: number;
}

export interface ParsedCatalog {
  catalogName: string;
  shortName: string;
  controls: ImportPreviewControl[];
  warnings: string[];
}

/**
 * Route to the correct parser by format.
 * Excel parsers are async (ExcelJS is Promise-based).
 */
export async function parseFile(
  filePath: string,
  format: ImportFormat,
): Promise<ParsedCatalog | null> {
  switch (format) {
    case 'sig-xlsx':      return parseSigXlsx(filePath);
    case 'iso27001-xlsx': return parseIso27001Xlsx(filePath);
    case 'oscal-json':    return parseOscalJson(filePath);
    case 'csv-generic':   return parseCsvGeneric(filePath);
    default:              return null;
  }
}

// ── ExcelJS helpers ─────────────────────────────────────────

/**
 * Load an xlsx file via ExcelJS and return an array of objects keyed by
 * the first-row column headers. Mimics the shape `xlsx`'s
 * `sheet_to_json(..., { defval: '' })` returned, so downstream parsers
 * can keep their field-lookup logic unchanged.
 */
async function loadSheetRows(
  filePath: string,
  sheetPredicate: (name: string) => boolean,
): Promise<Array<Record<string, string>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet =
    workbook.worksheets.find((w) => sheetPredicate(w.name)) ??
    workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  const rows: Array<Record<string, string>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      const cell = row.getCell(i + 1);
      obj[key] = cellText(cell.value);
    }
    rows.push(obj);
  });
  return rows;
}

/** Coerce any ExcelJS cell value shape to a plain string. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  // Rich text { richText: [{text}, ...] }
  if (typeof value === 'object' && 'richText' in (value as any)) {
    return ((value as any).richText as Array<{ text: string }>).map((r) => r.text).join('');
  }
  // Hyperlink { text, hyperlink } or formula { result, formula }
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown };
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
  }
  return String(value);
}

// ── SIG (Excel) ──────────────────────────────────────────────

async function parseSigXlsx(filePath: string): Promise<ParsedCatalog | null> {
  try {
    const warnings: string[] = [];
    const controls: ImportPreviewControl[] = [];

    const rows = await loadSheetRows(filePath, (n) => /question|content|control/i.test(n));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row['SIG ID'] || row['ID'] || row['Question ID'] || row['Ref'] || '';
      const title = row['Question'] || row['Title'] || row['Control'] || row['Description'] || '';
      const family = row['Domain'] || row['Category'] || row['Section'] || '';

      if (!id && !title) continue;
      controls.push({
        control_id: String(id).trim(),
        title: String(title).trim().substring(0, 500),
        family: String(family).trim() || undefined,
        source_row: i + 2,
      });
    }

    if (controls.length === 0) {
      warnings.push('No controls found — check that the sheet has SIG ID/Question columns');
    }

    const variant = controls.length > 300 ? 'Full' : 'Lite';
    return {
      catalogName: `SIG ${variant} (Proprietary Import)`,
      shortName: `sig-${variant.toLowerCase()}-proprietary`,
      controls,
      warnings,
    };
  } catch { return null; }
}

// ── ISO 27001 (Excel) ────────────────────────────────────────

async function parseIso27001Xlsx(filePath: string): Promise<ParsedCatalog | null> {
  try {
    const warnings: string[] = [];
    const controls: ImportPreviewControl[] = [];

    const rows = await loadSheetRows(filePath, (n) => /annex|control|27001/i.test(n));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row['Control ID'] || row['Ref'] || row['Clause'] || row['ID'] || '';
      const title = row['Control'] || row['Title'] || row['Name'] || '';
      const desc = row['Description'] || row['Guidance'] || row['Purpose'] || '';
      const family = row['Category'] || row['Theme'] || row['Domain'] || row['Clause'] || '';

      if (!id && !title) continue;
      controls.push({
        control_id: String(id).trim(),
        title: String(title).trim().substring(0, 500),
        description: desc ? String(desc).trim() : undefined,
        family: String(family).trim() || undefined,
        source_row: i + 2,
      });
    }

    if (controls.length === 0) {
      warnings.push('No controls found — check column headers match ISO 27001 structure');
    }

    return {
      catalogName: 'ISO 27001:2022 Annex A (Proprietary Import)',
      shortName: 'iso27001-proprietary',
      controls,
      warnings,
    };
  } catch { return null; }
}

// ── OSCAL JSON ───────────────────────────────────────────────

function parseOscalJson(filePath: string): ParsedCatalog | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const catalog = raw.catalog ?? raw;
    const controls: ImportPreviewControl[] = [];

    function walkGroups(groups: any[], family?: string): void {
      for (const g of groups) {
        const fam = g.title ?? family;
        if (g.controls) {
          for (const c of g.controls) {
            controls.push({
              control_id: c.id ?? '',
              title: c.title ?? '',
              description: c.props?.find((p: any) => p.name === 'label')?.value,
              family: fam,
            });
            if (c.controls) walkGroups([{ controls: c.controls }], fam);
          }
        }
        if (g.groups) walkGroups(g.groups, fam);
      }
    }

    if (catalog.groups) walkGroups(catalog.groups);

    return {
      catalogName: catalog.metadata?.title ?? 'OSCAL Import',
      shortName: (catalog.metadata?.title ?? 'oscal-import')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40),
      controls,
      warnings: [],
    };
  } catch { return null; }
}

// ── Generic CSV ──────────────────────────────────────────────

function parseCsvGeneric(filePath: string): ParsedCatalog | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim());
    if (lines.length < 2) return null;

    const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));
    const controls: ImportPreviewControl[] = [];
    const warnings: string[] = [];

    const idCol = headers.findIndex((h: string) => /^(id|control.?id|ref|code)$/i.test(h));
    const titleCol = headers.findIndex((h: string) => /^(title|name|control|question)$/i.test(h));
    const descCol = headers.findIndex((h: string) => /^(description|detail|guidance)$/i.test(h));
    const famCol = headers.findIndex((h: string) => /^(family|domain|category|section)$/i.test(h));

    if (idCol < 0 && titleCol < 0) {
      warnings.push('Could not find ID or Title columns');
      return { catalogName: 'CSV Import', shortName: 'csv-import', controls: [], warnings };
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c: string) => c.trim().replace(/"/g, ''));
      const id = idCol >= 0 ? cols[idCol] : `ROW-${i}`;
      const title = titleCol >= 0 ? cols[titleCol] : cols[idCol] ?? '';
      if (!id && !title) continue;

      controls.push({
        control_id: id,
        title: title.substring(0, 500),
        description: descCol >= 0 ? cols[descCol] : undefined,
        family: famCol >= 0 ? cols[famCol] : undefined,
        source_row: i + 1,
      });
    }

    return {
      catalogName: 'CSV Import',
      shortName: 'csv-import-' + Date.now(),
      controls,
      warnings,
    };
  } catch { return null; }
}
