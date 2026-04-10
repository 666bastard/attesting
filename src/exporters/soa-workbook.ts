/**
 * Statement of Applicability (SOA) Workbook Exporter
 *
 * Generates an ISO 27001 Statement of Applicability .xlsx workbook.
 * Includes all controls from catalogs where:
 *   - short_name LIKE '%iso%', OR
 *   - publisher = 'ISO'
 *
 * If no ISO catalog is found, all controls are included as a fallback.
 *
 * Sheet: "Statement of Applicability"
 * Columns: Control ID, Control Title, Applicable (Yes/No), Justification,
 *           Implementation Status, Statement
 */

import * as path from 'path';
import ExcelJS from 'exceljs';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Exports an ISO 27001 SOA .xlsx workbook.
 *
 * @param scopeName  Optional scope name to filter implementations.
 * @param outputPath File path for the output workbook.
 * @param db         Open database instance.
 */
export async function exportSoaWorkbook(
  scopeName: string | undefined,
  outputPath: string,
  db: Database.Database
): Promise<{ controls: number }> {
  // -------------------------------------------------------------------------
  // Determine which catalogs to include
  // -------------------------------------------------------------------------
  interface CatalogRow { id: string; short_name: string; name: string }

  let catalogs = db
    .prepare(
      `SELECT id, short_name, name FROM catalogs
       WHERE LOWER(short_name) LIKE '%iso%' OR LOWER(publisher) = 'iso'`
    )
    .all() as CatalogRow[];

  // Fallback: include all catalogs if no ISO catalog exists
  if (catalogs.length === 0) {
    catalogs = db
      .prepare('SELECT id, short_name, name FROM catalogs ORDER BY name')
      .all() as CatalogRow[];
  }

  if (catalogs.length === 0) {
    // Nothing to export — write an empty workbook
    const wb = new ExcelJS.Workbook();
    _buildSoaSheet(wb, []);
    await wb.xlsx.writeFile(path.resolve(outputPath));
    return { controls: 0 };
  }

  // -------------------------------------------------------------------------
  // Fetch controls + implementations for the selected catalogs
  // -------------------------------------------------------------------------
  interface SoaRow {
    control_id: string;
    title: string;
    status: string | null;
    statement: string | null;
    scope_name: string | null;
  }

  const catalogIds = catalogs.map((c) => c.id);
  const placeholders = catalogIds.map(() => '?').join(', ');

  const scopeFilter = scopeName
    ? `AND (s.name = ? OR i.scope_id IS NULL)`
    : '';

  const sql = `
    SELECT
      c.control_id,
      c.title,
      i.status,
      i.statement,
      s.name AS scope_name
    FROM controls c
    JOIN catalogs cat ON c.catalog_id = cat.id
    LEFT JOIN implementations i ON i.primary_control_id = c.id
    LEFT JOIN scopes s ON i.scope_id = s.id
    WHERE cat.id IN (${placeholders})
    ${scopeFilter}
    ORDER BY cat.short_name, c.sort_order, c.control_id
  `;

  const queryParams: (string | null)[] = [
    ...catalogIds,
    ...(scopeName ? [scopeName] : []),
  ];

  const rows = db.prepare(sql).all(...queryParams) as SoaRow[];

  // -------------------------------------------------------------------------
  // Build workbook
  // -------------------------------------------------------------------------
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Attesting';
  wb.created = new Date();

  _buildSoaSheet(wb, rows);

  const resolvedPath = path.resolve(outputPath);
  await wb.xlsx.writeFile(resolvedPath);

  return { controls: rows.length };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface SoaRow {
  control_id: string;
  title: string;
  status: string | null;
  statement: string | null;
  scope_name: string | null;
}

/**
 * Maps an implementation status to an "Applicable" column value.
 * 'not-applicable' → 'No', all others → 'Yes'.
 */
function applicableValue(status: string | null): string {
  return status === 'not-applicable' ? 'No' : 'Yes';
}

/**
 * Builds the "Statement of Applicability" worksheet.
 */
function _buildSoaSheet(wb: ExcelJS.Workbook, rows: SoaRow[]): void {
  const sheet = wb.addWorksheet('Statement of Applicability');

  // Column widths
  sheet.getColumn(1).width = 15;  // Control ID
  sheet.getColumn(2).width = 40;  // Control Title
  sheet.getColumn(3).width = 12;  // Applicable
  sheet.getColumn(4).width = 35;  // Justification
  sheet.getColumn(5).width = 25;  // Implementation Status
  sheet.getColumn(6).width = 60;  // Statement

  // Header row
  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9E1F2' },
  };

  const headers = [
    'Control ID',
    'Control Title',
    'Applicable',
    'Justification',
    'Implementation Status',
    'Statement',
  ];

  const headerRow = sheet.getRow(1);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = headerFill;
  });
  headerRow.commit();

  // Data rows
  rows.forEach((row, idx) => {
    const excelRow = sheet.getRow(idx + 2);
    excelRow.getCell(1).value = row.control_id;
    excelRow.getCell(2).value = row.title;
    excelRow.getCell(3).value = applicableValue(row.status);
    // Justification: derive from status for non-applicable controls
    excelRow.getCell(4).value =
      row.status === 'not-applicable' ? 'Not applicable to this scope' : '';
    excelRow.getCell(5).value = row.status ?? '';
    excelRow.getCell(6).value = row.statement ?? '';
    excelRow.commit();
  });
}
