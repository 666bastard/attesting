Integrate the proprietary catalog import feature. These files are at the project root and need to be moved into place, wired up, and verified.

## File placement

Move these files to their target locations:

- `detect-format.ts` → `src/services/import/detect-format.ts`
- `file-scanner.ts` → `src/services/import/file-scanner.ts`
- `parsers.ts` → `src/services/import/parsers.ts`
- `pipeline.ts` → `src/services/import/pipeline.ts`
- `import.ts` (the route file) → `src/web/routes/import.ts`
- `import-proprietary.ts` → `src/commands/catalog/import-proprietary.ts`
- `ImportProprietary.tsx` → `src/web/client/components/ImportProprietary.tsx`

## Wiring

1. **API route:** Open `src/web/server.ts`. Import `importRoutes` from the routes directory and mount it: `app.use('/api/import', importRoutes())`. Follow the pattern of other route mounts. The route uses `multer` for file uploads — add `multer` as a dependency: `npm install multer @types/multer`.

2. **CLI command:** Open the file that registers catalog subcommands. Import `registerImportProprietary` from `./import-proprietary.js` and call it alongside other catalog subcommands.

3. **Web UI:** Open `src/web/client/App.tsx`. Add a route for the import page — either standalone `/import` or as a tab within Catalogs. Import `ImportProprietary` and add a navigation link.

4. **xlsx dependency:** Install `xlsx` for Excel parsing: `npm install xlsx`. The parsers use `require('xlsx')` with dynamic import so it only loads when xlsx files are processed.

## Security model

The file scanner (`file-scanner.ts`) runs on EVERY uploaded file BEFORE any parsing. It enforces:

- **10 MB hard cap** — catalog files should never be larger
- **Extension whitelist** — only `.xlsx`, `.json`, `.csv` accepted (no .tsv, no .xls, no .xlsm)
- **MIME type validation** — rejects mismatched MIME types
- **Filename sanitization** — blocks path traversal (`../`, `..\\`), control characters
- **Magic byte analysis** — detects executables (ELF, PE, Mach-O), archives (RAR, 7z, gzip), shell scripts — rejects them even if extension is faked
- **XLSX container validation** — verifies .xlsx files have PK zip magic bytes
- **JSON structure validation** — checks JSON starts with valid character, attempts full parse on files under 1 MB
- **CSV structure validation** — verifies header + at least one data row with delimiters
- **Embedded script detection** — scans text files for `<script>`, `javascript:`, `eval(`, `<?php`, event handlers, null bytes, dynamic imports
- **Path traversal guard on confirm** — upload_path must resolve inside `~/.attesting/uploads/`
- **Double scan** — files are scanned both on upload AND before confirm execution

The scanner deletes any file that fails a check immediately. The route also re-scans before confirm in case the file was tampered with between preview and confirm.

## Verify import paths

Check every moved `.ts` file — all import paths must be correct relative to their new locations. Fix any that are wrong.

## Build and test

1. `npm run build` — fix any type errors
2. `npx tsx src/index.ts catalog import-proprietary --help` — should show usage
3. Test the scanner: create a file called `test.csv` with `<script>alert(1)</script>` in it and verify it's rejected
4. Test with a small valid CSV to verify the full preview → confirm flow works in both CLI and browser
5. Start the dev server and verify `/api/import/formats` returns the format list with size limit

## Important constraints

- Do NOT modify any existing service, route, or component files beyond adding the mount/registration lines
- `xlsx` and `multer` are the only new dependencies
- If the `controls` table lacks a `family` column, add it via a new migration file (NOT by editing schema.sql): `ALTER TABLE controls ADD COLUMN family TEXT;` wrapped in try/catch for duplicate column tolerance
- Commit with message: "feat: add proprietary catalog import with file security scanning"
