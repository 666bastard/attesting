import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Phase 5I — CLI smoke tests against the compiled dist/ entry point.
 *
 * These only run if `npm run build` has been executed. They verify the
 * final packaged binary actually loads, prints --help, and reports the
 * correct --version from package.json.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distIndex = path.join(repoRoot, 'dist', 'index.js');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

const buildExists = fs.existsSync(distIndex);

describe.skipIf(!buildExists)('CLI smoke (compiled dist/)', () => {
  it('--help prints the usage block and exits 0', () => {
    const out = execFileSync('node', [distIndex, '--help'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toContain('Usage: attesting');
    expect(out).toContain('OSCAL-native compliance control platform');
    expect(out).toContain('org');
    expect(out).toContain('catalog');
    expect(out).toContain('score');
    expect(out).toContain('evidence');
    expect(out).toContain('monitor');
    expect(out).toContain('report');
  });

  it('--version prints the package.json version', () => {
    const out = execFileSync('node', [distIndex, '--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out.trim()).toBe(pkg.version);
  });

  it('unknown commands exit non-zero with a helpful message', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('node', [distIndex, 'definitely-not-a-command'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stderr = (err.stderr ?? '').toString();
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/unknown command|help/i);
  });
});

describe.skipIf(buildExists)('CLI smoke (pre-build — skipped)', () => {
  it.skip('build the package first: `npm run build`', () => {});
});
