Move the 7 Risk CLI files from the project root into src/commands/risk/:

index.ts, list.ts, create.ts, update.ts, link.ts, exceptions.ts, matrix.ts

Then integrate them into the CLI:

1. Open src/index.ts. Find where other command groups are registered (look for registerAssessment, registerCatalog, etc.). Add `import { registerRiskCommands } from './commands/risk/index.js';` and call `registerRiskCommands(program);` following the same pattern as the other command registrations.

2. Verify the import paths in all 7 files are correct relative to src/commands/risk/ — they should reference ../../db/connection.js, ../../utils/uuid.js, ../../utils/dates.js, ../../utils/logger.js, ../../services/propagation/dispatcher.js. Fix any that are wrong.

3. Run `npm run build` and fix any type errors. Common things to watch for:
   - The logger.js exports — verify `success` and `error` are exported from src/utils/logger.ts. If the names differ, update the imports in the risk files to match.
   - The `risk_asset_links` table used in link.ts — verify it exists in the schema or migration 002. If the table name differs, update the reference.
   - The `Actor` type from src/services/audit/logger.ts — verify `{ type: 'user', id: 'cli' }` matches the expected shape.

4. After build passes, do a quick smoke test:
   - `npx tsx src/index.ts risk --help` — should show all 6 subcommands
   - `npx tsx src/index.ts risk list` — should run without error (empty result is fine)
   - `npx tsx src/index.ts risk matrix` — should display or create the default matrix

5. Do NOT modify any existing files other than src/index.ts. Do NOT change the logic in the risk command files unless fixing a build error. Commit with message: "feat: add Phase 1A risk CLI commands (list, create, update, link, exceptions, matrix)"
