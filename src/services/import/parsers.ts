import { createRequire } from 'module';
import type { ImportFormat } from './detect-format.js';

// ESM shim: lets sync functions below call `require('xlsx')` / `require('fs')`
// lazily without converting them to async dynamic imports.
const require = createRequire(import.meta.url);

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
 */
export function parseFile(filePath: string, format: ImportFormat): ParsedCatalog | null {
  switch (format) {
    case 'sig-xlsx': return parseSigXlsx(filePath);
    case 'iso27001-xlsx': return parseIso27001Xlsx(filePath);
    case 'oscal-json': return parseOscalJson(filePath);
    case 'csv-generic': return parseCsvGeneric(filePath);
    default: return null;
  }
}

// ── SIG (Excel) ──────────────────────────────────────────────

function parseSigXlsx(filePath: string): ParsedCatalog | null {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const warnings: string[] = [];
    const controls: ImportPreviewControl[] = [];

    const sheetName = workbook.SheetNames.find(
      (n: string) => /question|content|control/i.test(n)
    ) ?? workbook.SheetNames[0];

    const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

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

function parseIso27001Xlsx(filePath: string): ParsedCatalog | null {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const warnings: string[] = [];
    const controls: ImportPreviewControl[] = [];

    const sheetName = workbook.SheetNames.find(
      (n: string) => /annex|control|27001/i.test(n)
    ) ?? workbook.SheetNames[0];

    const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

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
    const fs = require('fs');
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
    const fs = require('fs');
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
