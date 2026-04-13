#!/usr/bin/env npx tsx
/**
 * CI script: Catalog Data Integrity
 *
 * Verifies all expected catalog files exist, are valid, and haven't
 * been corrupted or accidentally deleted.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname shim (package is "type": "module" since Phase 5I)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_DIR = path.join(__dirname, '../data/catalogs');

const EXPECTED_JSON = [
  'nist-800-53-r5.json',
  'nist-800-171-r3.json',
  'nist-csf-2.0.json',
  'nist-800-218.json',
  'nist-800-53-r5-low.json',
  'nist-800-53-r5-moderate.json',
  'nist-800-53-r5-high.json',
  'nist-800-53-r5-privacy.json',
];

const EXPECTED_CSV = [
  'cmmc-2.0.csv',
  'nispom-117.csv',
  'gdpr.csv',
  'eu-ai-act.csv',
  'ccpa-cpra.csv',
  'hipaa-security.csv',
  'soc2-tsc.csv',
  'pci-dss-4.csv',
];

function main() {
  console.log('Catalog Data Integrity Check');
  console.log('============================\n');

  let errors = 0;
  let warnings = 0;

  // Check JSON catalogs
  for (const file of EXPECTED_JSON) {
    const filePath = path.join(CATALOG_DIR, file);
    process.stdout.write(`  ${file}: `);

    if (!fs.existsSync(filePath)) {
      console.log('MISSING');
      console.error(`::error file=data/catalogs/${file}::Expected catalog file not found`);
      errors++;
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Check it has OSCAL structure
      const rootKey = Object.keys(data)[0];
      if (!rootKey || !['catalog', 'profile'].includes(rootKey)) {
        console.log(`WARN (root key: ${rootKey})`);
        warnings++;
        continue;
      }

      const sizeKb = Math.round(content.length / 1024);
      console.log(`OK (${sizeKb}KB, root: ${rootKey})`);
    } catch (err) {
      console.log('INVALID JSON');
      console.error(`::error file=data/catalogs/${file}::Invalid JSON: ${(err as Error).message}`);
      errors++;
    }
  }

  // Check CSV catalogs
  for (const file of EXPECTED_CSV) {
    const filePath = path.join(CATALOG_DIR, file);
    process.stdout.write(`  ${file}: `);

    if (!fs.existsSync(filePath)) {
      console.log('MISSING');
      console.error(`::error file=data/catalogs/${file}::Expected catalog file not found`);
      errors++;
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      if (lines.length < 11) {
        console.log(`WARN (only ${lines.length} lines, expected >10)`);
        console.error(`::warning file=data/catalogs/${file}::CSV has only ${lines.length} lines`);
        warnings++;
        continue;
      }

      // Check header has at least 3 columns
      const headerCols = lines[0].split(',').length;
      if (headerCols < 3) {
        console.log(`WARN (only ${headerCols} columns, expected >=3)`);
        warnings++;
        continue;
      }

      const sizeKb = Math.round(content.length / 1024);
      console.log(`OK (${sizeKb}KB, ${lines.length} rows, ${headerCols} cols)`);
    } catch (err) {
      console.log('ERROR');
      console.error(`::error file=data/catalogs/${file}::${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\nResults: ${errors} errors, ${warnings} warnings`);
  console.log(`Files checked: ${EXPECTED_JSON.length + EXPECTED_CSV.length}`);

  if (errors > 0) {
    console.log('\nFAILED: Catalog integrity check found errors');
    process.exit(1);
  }

  console.log('\nPASSED: All catalog files present and valid');
}

main();
