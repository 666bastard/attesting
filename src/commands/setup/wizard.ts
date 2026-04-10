import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, info, error } from '../../utils/logger.js';
import { getState, completeStage, skipStage, isOnboardingComplete, STAGES } from '../../services/onboarding/state.js';
import { getRecommendations, INDUSTRIES, ORG_SIZES } from '../../services/onboarding/recommendations.js';
import { seedRisksFromGaps } from '../../services/onboarding/gap-seed.js';
import { input, select, confirm, multiSelect } from './prompts.js';

export function registerSetup(program: Command): void {
  const setupCmd = program
    .command('setup')
    .description('Guided onboarding wizard')
    .option('--status', 'Show onboarding progress')
    .option('--reset', 'Reset onboarding state')
    .action(runSetup);
}

interface SetupOptions {
  status?: boolean;
  reset?: boolean;
}

async function runSetup(options: SetupOptions): Promise<void> {
  const database = db.getDb();

  if (options.reset) {
    const { resetOnboarding } = await import('../../services/onboarding/state.js');
    resetOnboarding(database);
    success('Onboarding state reset.');
    return;
  }

  if (options.status) {
    const state = getState(database);
    info('Onboarding status:\n');
    for (const stage of STAGES) {
      const done = state.completed_stages.includes(stage.num) ? '✓' :
                   state.skipped_stages.includes(stage.num) ? '⊘' :
                   state.current_stage === stage.num ? '→' : ' ';
      console.log(`  ${done} Stage ${stage.num}: ${stage.name}`);
    }
    console.log(`\n  Current stage: ${state.current_stage}`);
    return;
  }

  console.log('\n  Welcome to Attesting.\n');
  console.log('  This wizard will walk you through initial setup.\n');
  console.log('  Every stage after organization setup can be skipped.\n');

  const state = getState(database);
  let currentStage = state.current_stage;

  // Stage 1: Organization
  if (currentStage <= 1 && !state.completed_stages.includes(1)) {
    info('Stage 1 · Organization Setup\n');
    const name = await input('  Organization name');
    if (!name) { error('Organization name is required.'); process.exit(1); }

    const industry = await select('Industry:', INDUSTRIES);
    const size = await select('Organization size:', ORG_SIZES);
    const contact = await input('  Primary contact name', '');
    const email = await input('  Primary contact email', '');

    const orgId = generateUuid();
    const ts = now();
    database.prepare(
      'INSERT INTO organizations (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).run(orgId, name, JSON.stringify({ industry, size, contact, email }), ts, ts);

    completeStage(database, 1, { org_id: orgId });
    success(`Organization created: "${name}"\n`);
    currentStage = 2;
  }

  // Stage 2: Select Frameworks
  if (currentStage <= 2 && !state.completed_stages.includes(2)) {
    info('Stage 2 · Select Compliance Frameworks\n');

    // Get industry from org description
    const org = database.prepare('SELECT description FROM organizations LIMIT 1').get() as any;
    const meta = JSON.parse(org?.description ?? '{}');
    const recs = getRecommendations(meta.industry ?? 'other', meta.size ?? 'small');

    const selected = await multiSelect(
      'Select frameworks to activate:',
      recs.map(r => ({
        label: `${r.name} (${r.controlCount} controls)${r.recommended ? ' ★' : ''}`,
        value: r.shortName,
        selected: r.recommended,
      })),
    );

    if (selected.length === 0) {
      if (await confirm('Skip framework selection?')) {
        skipStage(database, 2);
      }
    } else {
      completeStage(database, 2, { selected_catalogs: selected });
      success(`${selected.length} framework(s) selected.\n`);
    }
    currentStage = 3;
  }

  // Stage 3: Define Scopes
  if (currentStage <= 3 && !state.completed_stages.includes(3)) {
    info('Stage 3 · Define Scopes\n');

    const template = await select('Scope template:', [
      'Single scope — "All Systems"',
      'By environment — Production, Development, Corporate',
      'Custom — define my own',
      'Skip',
    ]);

    const scopeIds: string[] = [];
    const ts = now();
    const orgState = getState(database);

    if (template.includes('Single')) {
      const id = generateUuid();
      database.prepare('INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, orgState.org_id, 'All Systems', 'product', ts, ts);
      scopeIds.push(id);
    } else if (template.includes('environment')) {
      for (const name of ['Production', 'Development', 'Corporate']) {
        const id = generateUuid();
        database.prepare('INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at) VALUES (?,?,?,?,?,?)')
          .run(id, orgState.org_id, name, 'environment', ts, ts);
        scopeIds.push(id);
      }
    } else if (template.includes('Custom')) {
      let adding = true;
      while (adding) {
        const name = await input('  Scope name');
        if (name) {
          const id = generateUuid();
          database.prepare('INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at) VALUES (?,?,?,?,?,?)')
            .run(id, orgState.org_id, name, 'product', ts, ts);
          scopeIds.push(id);
        }
        adding = await confirm('Add another scope?');
      }
    } else {
      skipStage(database, 3);
      currentStage = 4;
    }

    if (scopeIds.length > 0) {
      completeStage(database, 3, { scope_ids: scopeIds });
      success(`${scopeIds.length} scope(s) created.\n`);
    }
    currentStage = 4;
  }

  // Stage 4: Register Assets
  if (currentStage <= 4 && !state.completed_stages.includes(4)) {
    info('Stage 4 · Register Key Assets\n');

    const assetIds: string[] = [];
    const action = await select('How would you like to register assets?', [
      'Add manually (3-5 critical systems)',
      'Skip — add later',
    ]);

    if (action.includes('manually')) {
      let adding = true;
      while (adding) {
        const name = await input('  Asset name');
        if (name) {
          const platform = await input('  Platform (aws, azure, gcp, on-prem, saas)', 'on-prem');
          const type = await select('  Asset type:', ['application', 'infrastructure', 'data-store', 'network', 'endpoint']);
          const id = generateUuid();
          database.prepare(
            "INSERT INTO assets (id, name, asset_type, platform, status, created_at, updated_at) VALUES (?,?,?,?,'active',datetime('now'),datetime('now'))"
          ).run(id, name, type, platform);
          assetIds.push(id);
          success(`  Added: ${name}`);
        }
        adding = await confirm('Add another asset?');
      }
      completeStage(database, 4, { asset_ids: assetIds });
      success(`${assetIds.length} asset(s) registered.\n`);
    } else {
      skipStage(database, 4);
    }
    currentStage = 5;
  }

  // Stage 5: Assign Owners
  if (currentStage <= 5 && !state.completed_stages.includes(5)) {
    info('Stage 5 · Assign Owners\n');

    const ownerAction = await select('Owner setup:', [
      "I'm the sole owner — assign everything to me",
      "I'll add team members",
      'Skip',
    ]);

    const ownerIds: string[] = [];

    if (ownerAction.includes('sole')) {
      const name = await input('  Your name');
      const email = await input('  Your email');
      const id = generateUuid();
      database.prepare(
        "INSERT INTO owners (id, name, email, role, is_supervisor, created_at) VALUES (?,?,?,'ciso',1,datetime('now'))"
      ).run(id, name, email);
      ownerIds.push(id);
      success(`  Owner created: ${name}\n`);
    } else if (ownerAction.includes('team')) {
      let adding = true;
      while (adding) {
        const name = await input('  Name');
        const email = await input('  Email');
        const role = await select('  Role:', ['ciso', 'security-lead', 'analyst', 'engineer', 'auditor']);
        const id = generateUuid();
        database.prepare(
          "INSERT INTO owners (id, name, email, role, is_supervisor, created_at) VALUES (?,?,?,?,0,datetime('now'))"
        ).run(id, name, email, role);
        ownerIds.push(id);
        success(`  Added: ${name}`);
        adding = await confirm('Add another?');
      }
    } else {
      skipStage(database, 5);
      currentStage = 6;
    }

    if (ownerIds.length > 0) {
      completeStage(database, 5, { owner_ids: ownerIds });
    }
    currentStage = 6;
  }

  // Stage 6: Initial Risk Posture
  if (currentStage <= 6 && !state.completed_stages.includes(6)) {
    info('Stage 6 · Initial Risk Posture\n');

    const riskAction = await select('How to seed your risk register?', [
      'Quick start — add 3-5 risks manually',
      'Auto-generate from framework gaps',
      'Skip',
    ]);

    const riskIds: string[] = [];

    if (riskAction.includes('Quick')) {
      let adding = true;
      while (adding) {
        const title = await input('  Risk title');
        if (title) {
          const category = await select('  Category:', ['operational', 'technical', 'compliance', 'strategic', 'third-party']);
          const likelihood = await input('  Likelihood (1-5)', '3');
          const impact = await input('  Impact (1-5)', '3');
          const l = parseInt(likelihood, 10);
          const i = parseInt(impact, 10);
          const count = (database.prepare('SELECT COUNT(*) AS c FROM risks').get() as any).c;
          const riskRef = `RISK-${String(count + 1).padStart(3, '0')}`;
          const id = generateUuid();
          database.prepare(
            `INSERT INTO risks (id, risk_id, title, category, likelihood, impact, inherent_risk_score, treatment, owner, status, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
          ).run(id, riskRef, title, category, l, i, l * i, 'mitigate', 'Unassigned', 'open');
          riskIds.push(id);
          success(`  Created: ${riskRef} — ${title}`);
        }
        adding = await confirm('Add another risk?');
      }
    } else if (riskAction.includes('Auto-generate')) {
      const onbState = getState(database);
      const generated = seedRisksFromGaps(database, onbState.selected_catalogs);
      riskIds.push(...generated);
      success(`  Auto-generated ${generated.length} risk(s) from gap analysis.\n`);
    } else {
      skipStage(database, 6);
      currentStage = 7;
    }

    if (riskIds.length > 0) {
      completeStage(database, 6, { risk_ids: riskIds });
    }
    currentStage = 7;
  }

  // Stage 7: Connect Threat Feeds
  if (currentStage <= 7 && !state.completed_stages.includes(7)) {
    info('Stage 7 · Connect Threat Feeds (Optional)\n');

    const enableKev = await confirm('Enable CISA KEV connector? (free, no API key needed)', true);

    const connectorIds: string[] = [];

    if (enableKev) {
      const id = generateUuid();
      const ts = now();
      database.prepare(`
        INSERT INTO connectors (id, name, connector_type, direction, target_module,
          adapter_class, is_enabled, health_status, sync_mode, created_at, updated_at)
        VALUES (?,?,?,?,?,?,1,'unknown','manual',?,?)
      `).run(id, 'CISA KEV', 'threat_feed', 'inbound', 'multi', 'CISAKEVAdapter', ts, ts);
      connectorIds.push(id);
      success('  CISA KEV connector registered.\n');

      const syncNow = await confirm('Run initial sync now?', true);
      if (syncNow) {
        try {
          const { AdapterRegistry } = await import('../../services/connectors/registry.js');
          const registry = new AdapterRegistry();
          const conn = database.prepare('SELECT * FROM connectors WHERE id = ?').get(id) as any;
          const adapter = registry.create(database, conn);
          info('  Syncing CISA KEV feed...');
          const stats = await adapter.sync('full');
          success(`  Sync complete: ${stats.created} vulnerabilities loaded.`);
        } catch (err: any) {
          error(`  Sync failed: ${err.message}. You can retry later with: attesting connector sync ${id}`);
        }
      }
    } else {
      skipStage(database, 7);
      currentStage = 8;
    }

    if (connectorIds.length > 0) {
      completeStage(database, 7, { connector_ids: connectorIds });
    }
    currentStage = 8;
  }

  // Stage 8: Review & Launch
  if (currentStage <= 8) {
    const finalState = getState(database);
    const orgRow = database.prepare('SELECT name FROM organizations LIMIT 1').get() as any;
    const catalogCount = finalState.selected_catalogs.length;
    const controlCount = catalogCount > 0
      ? (database.prepare(
          `SELECT COUNT(*) AS c FROM controls WHERE catalog_id IN (
            SELECT id FROM catalogs WHERE short_name IN (${finalState.selected_catalogs.map(() => '?').join(',')})
          )`
        ).get(...finalState.selected_catalogs) as any)?.c ?? 0
      : 0;
    const scopeCount = finalState.scope_ids.length;
    const assetCount = finalState.asset_ids.length;
    const ownerCount = finalState.owner_ids.length;
    const riskCount = finalState.risk_ids.length;
    const connectorCount = finalState.connector_ids.length;

    console.log('\n  ┌──────────────────────────────────────────────┐');
    console.log('  │  Attesting Setup Complete                    │');
    console.log('  ├──────────────────────────────────────────────┤');
    console.log(`  │  Organization:  ${(orgRow?.name ?? '—').padEnd(28)}│`);
    console.log(`  │  Catalogs:      ${String(catalogCount).padEnd(3)} active (${String(controlCount).padEnd(4)} controls)   │`);
    console.log(`  │  Scopes:        ${String(scopeCount).padEnd(28)}│`);
    console.log(`  │  Assets:        ${String(assetCount).padEnd(28)}│`);
    console.log(`  │  Owners:        ${String(ownerCount).padEnd(28)}│`);
    console.log(`  │  Risks:         ${String(riskCount).padEnd(28)}│`);
    console.log(`  │  Connectors:    ${String(connectorCount).padEnd(28)}│`);
    console.log('  └──────────────────────────────────────────────┘');
    console.log('\n  What\'s next:');
    console.log('    • Run `attesting serve` to open the dashboard');
    console.log('    • Run `attesting assessment create` to start your first assessment');
    console.log('    • Run `attesting drift check` to run your first posture check');
    console.log();

    completeStage(database, 8);
  }
}
