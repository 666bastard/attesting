import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { success, info, warn } from '../../utils/logger.js';

/**
 * `attesting risk matrix` — display or configure the risk matrix.
 */
export function registerRiskMatrix(riskCommand: Command): void {
  riskCommand
    .command('matrix')
    .description('Display or configure the risk matrix')
    .option('--appetite <level>', 'Set risk appetite: low, moderate, high')
    .option('--threshold <n>', 'Set appetite threshold score', parseInt)
    .option('--json', 'Output as JSON')
    .action(runRiskMatrix);
}

interface RiskMatrixOptions {
  appetite?: string;
  threshold?: number;
  json?: boolean;
}

interface MatrixRow {
  id: string;
  name: string;
  likelihood_levels: string;
  impact_levels: string;
  risk_appetite: string;
  appetite_threshold: number;
  created_at: string;
}

function runRiskMatrix(options: RiskMatrixOptions): void {
  const database = db.getDb();

  let matrix = database
    .prepare('SELECT * FROM risk_matrix LIMIT 1')
    .get() as MatrixRow | undefined;

  // Create default matrix if none exists
  if (!matrix) {
    const id = generateUuid();
    database
      .prepare(
        `INSERT INTO risk_matrix (id, name, likelihood_levels, impact_levels, risk_appetite, appetite_threshold)
         VALUES (?, 'Default',
                 '["Rare","Unlikely","Possible","Likely","Almost Certain"]',
                 '["Negligible","Minor","Moderate","Major","Critical"]',
                 'moderate', 9)`
      )
      .run(id);

    matrix = database.prepare('SELECT * FROM risk_matrix WHERE id = ?').get(id) as MatrixRow;
    success('Created default risk matrix.');
  }

  // Apply updates if flags provided
  if (options.appetite || options.threshold !== undefined) {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (options.appetite) {
      const valid = ['low', 'moderate', 'high'];
      if (!valid.includes(options.appetite)) {
        warn(`Invalid appetite "${options.appetite}". Must be one of: ${valid.join(', ')}`);
        process.exit(1);
      }
      sets.push('risk_appetite = ?');
      params.push(options.appetite);
    }
    if (options.threshold !== undefined) {
      sets.push('appetite_threshold = ?');
      params.push(options.threshold);
    }

    params.push(matrix.id);
    database.prepare(`UPDATE risk_matrix SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    // Reload
    matrix = database.prepare('SELECT * FROM risk_matrix WHERE id = ?').get(matrix.id) as MatrixRow;
    success('Risk matrix updated.');
  }

  if (options.json) {
    console.log(JSON.stringify(matrix, null, 2));
    return;
  }

  // Display the matrix
  const likelihoodLevels = JSON.parse(matrix.likelihood_levels) as string[];
  const impactLevels = JSON.parse(matrix.impact_levels) as string[];

  info(`Risk Matrix: "${matrix.name}"\n`);
  console.log(`  Appetite: ${matrix.risk_appetite}  Threshold: ${matrix.appetite_threshold}\n`);

  // Header row
  const colWidth = 14;
  const header = ''.padEnd(colWidth) + impactLevels.map(l => l.padEnd(colWidth)).join('');
  console.log(header);
  console.log('  ' + '─'.repeat(header.length));

  // Grid rows (likelihood × impact)
  for (let li = likelihoodLevels.length; li >= 1; li--) {
    const label = likelihoodLevels[li - 1]!.padEnd(colWidth);
    const cells = impactLevels.map((_, ii) => {
      const score = li * (ii + 1);
      const marker = score >= matrix!.appetite_threshold ? `[${score}]` : ` ${score} `;
      return marker.padEnd(colWidth);
    }).join('');
    console.log(`  ${label}${cells}`);
  }
}
