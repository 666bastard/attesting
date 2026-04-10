# 6C · Import API Route

**Status:** 🔧 In Progress
**File:** `src/web/routes/import.ts`
**Scope:** Three endpoints: `POST /api/import/preview` (upload + scan + parse → preview), `POST /api/import/confirm` (execute import with path traversal guard + re-scan), `GET /api/import/formats` (list supported formats + size limits). Uses multer for file upload with tight limits (10 MB, 1 file, 3 extensions). Files stored in `~/.attesting/uploads/`, deleted after import or on rejection.
**Key:** Double scan (upload + confirm). Path traversal guard on confirm. Format override validated against enum.
**Exit:** Preview returns controls + mappings + scan results. Confirm writes to DB and cleans up file.
