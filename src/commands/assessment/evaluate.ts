import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error, log } from '../../utils/logger.js';
import { resolveControl } from '../../mappers/resolver.js';

/**
 * Registers the `attesting assessment evaluate` subcommand.
 *
 * Algorithm:
 *   For each control in the assessment's catalog:
 *     1. Look for a direct implementation in scope.
 *     2. If none, look for a mapped (transitive) implementation via resolver.
 *     3. Map implementation status → assessment result:
 *        - 'implemented'           → 'satisfied'
 *        - 'partially-implemented' → 'partial'
 *        - 'not-applicable'        → 'not-applicable'
 *        - no implementation       → 'not-satisfied'
 *        - mapped (transitive)     → 'partial' (needs human review)
 *     4. Insert assessment_results rows.
 *     5. Update assessment summary counts and mark completed.
 */
export function registerAssessmentEvaluate(assessmentCommand: Command): void {
  assessmentCommand
    .command('evaluate')
    .description('Evaluate an assessment against current implementations')
    .requiredOption('--assessment <name-or-id>', 'Assessment name or ID')
    .option('--json', 'Output as JSON')
    .action(runAssessmentEvaluate);
}

interface EvaluateOptions {
  assessment: string;
  json?: boolean;
}

interface AssessmentRow {
  id: string;
  name: string;
  org_id: string;
  scope_id: string | null;
  catalog_id: string;
  status: string;
}

interface ControlRow {
  id: string;
  control_id: string;
}

interface ImplRow {
  id: string;
  status: string;
}

/**
 * Maps an implementation status to an OSCAL assessment result.
 */
function statusToResult(
  status: string
): 'satisfied' | 'partial' | 'not-applicable' | 'not-satisfied' {
  switch (status) {
    case 'implemented':
      return 'satisfied';
    case 'partially-implemented':
      return 'partial';
    case 'not-applicable':
      return 'not-applicable';
    default:
      return 'not-satisfied';
  }
}

function runAssessmentEvaluate(options: EvaluateOptions): void {
  const database = db.getDb();

  // Look up assessment by name or ID
  const assessment = database
    .prepare(
      `SELECT id, name, org_id, scope_id, catalog_id, status
       FROM assessments
       WHERE id = ? OR name = ?
       LIMIT 1`
    )
    .get(options.assessment, options.assessment) as AssessmentRow | undefined;

  if (!assessment) {
    error(`Assessment not found: "${options.assessment}"`);
    process.exit(1);
  }

  // Load all controls for the catalog
  const controls = database
    .prepare(
      `SELECT id, control_id FROM controls WHERE catalog_id = ? ORDER BY sort_order, control_id`
    )
    .all(assessment.catalog_id) as ControlRow[];

  if (controls.length === 0) {
    error('No controls found in the assessment catalog.');
    process.exit(1);
  }

  // Delete any previous results for this assessment
  database
    .prepare('DELETE FROM assessment_results WHERE assessment_id = ?')
    .run(assessment.id);

  // Prepare insert statement for results
  const insertResult = database.prepare(
    `INSERT INTO assessment_results
       (id, assessment_id, control_id, implementation_id, result, finding, assessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let satisfied = 0;
  let notSatisfied = 0;
  let naCount = 0;
  let partialCount = 0;

  const timestamp = now();

  const evaluate = database.transaction(() => {
    for (const control of controls) {
      // 1. Look for a direct implementation in this scope
      const scopeFilter = assessment.scope_id
        ? `AND (i.scope_id = ? OR i.scope_id IS NULL)`
        : '';

      const directImpl = database
        .prepare(
          `SELECT i.id, i.status
           FROM implementations i
           WHERE i.primary_control_id = ?
             AND i.org_id = ?
             ${scopeFilter}
           LIMIT 1`
        )
        .get(
          ...[
            control.id,
            assessment.org_id,
            ...(assessment.scope_id ? [assessment.scope_id] : []),
          ]
        ) as ImplRow | undefined;

      let result: string = 'not-satisfied';
      let implementationId: string | null = null;
      let finding: string | null = null;

      if (directImpl) {
        result = statusToResult(directImpl.status);
        implementationId = directImpl.id;
      } else {
        // 2. Check for a transitive (mapped) implementation
        const mappedControls = resolveControl(control.id, database);
        let foundMapped = false;

        for (const mapped of mappedControls) {
          const mappedImpl = database
            .prepare(
              `SELECT i.id, i.status
               FROM implementations i
               WHERE i.primary_control_id = ?
                 AND i.org_id = ?
               LIMIT 1`
            )
            .get(mapped.controlId, assessment.org_id) as ImplRow | undefined;

          if (mappedImpl) {
            // Transitive mapping → 'partial' regardless of the mapped status
            result = 'partial';
            implementationId = mappedImpl.id;
            finding = `Satisfied via mapped control (${mapped.catalogShortName}:${mapped.controlNativeId}) — review required.`;
            foundMapped = true;
            break;
          }
        }

        if (!foundMapped) {
          result = 'not-satisfied';
          finding = 'No direct or mapped implementation found.';
        }
      }

      // Count results
      switch (result) {
        case 'satisfied':
          satisfied++;
          break;
        case 'not-satisfied':
          notSatisfied++;
          break;
        case 'not-applicable':
          naCount++;
          break;
        case 'partial':
          partialCount++;
          break;
      }

      insertResult.run(
        generateUuid(),
        assessment.id,
        control.id,
        implementationId,
        result,
        finding,
        timestamp
      );
    }
  });

  evaluate();

  // Update assessment summary
  database
    .prepare(
      `UPDATE assessments SET
         status          = 'completed',
         completed_at    = ?,
         controls_met    = ?,
         controls_not_met= ?,
         controls_na     = ?,
         controls_partial= ?,
         total_controls  = ?
       WHERE id = ?`
    )
    .run(
      timestamp,
      satisfied,
      notSatisfied,
      naCount,
      partialCount,
      controls.length,
      assessment.id
    );

  const coveragePct =
    controls.length > 0
      ? Math.round(((satisfied + naCount) / controls.length) * 100)
      : 0;

  if (options.json) {
    const result = {
      assessment: assessment.name,
      totalControls: controls.length,
      satisfied,
      partial: partialCount,
      notSatisfied,
      notApplicable: naCount,
      coveragePct,
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  success(`Assessment "${assessment.name}" evaluation complete.`);
  log('');
  log(`  Total controls:     ${controls.length}`);
  log(`  Satisfied:          ${satisfied}`);
  log(`  Partial:            ${partialCount}`);
  log(`  Not satisfied:      ${notSatisfied}`);
  log(`  Not applicable:     ${naCount}`);
  log(`  Coverage:           ${coveragePct}%`);
}
