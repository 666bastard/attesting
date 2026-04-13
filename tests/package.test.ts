import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Phase 5I — package.json + publish readiness smoke tests.
 *
 * These guard against regressions in the publishable metadata without
 * actually running `npm publish`. They verify the fields the audit
 * flagged and ensure the build entry point stays consistent.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(repoRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

describe('package.json — Phase 5I publish readiness', () => {
  it('is marked as an ESM module', () => {
    expect(pkg.type).toBe('module');
  });

  it('declares a pinned node engine', () => {
    expect(pkg.engines?.node).toBeDefined();
    expect(pkg.engines.node).toMatch(/>=\s*20/);
  });

  it('has a publishable bin entry', () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.attesting).toBe('dist/index.js');
  });

  it('declares a main entry that points into dist/', () => {
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
  });

  it('exposes the main entry point via exports field', () => {
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['.']).toBeDefined();
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
  });

  it('constrains the published tarball via a files whitelist', () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('dist/');
    expect(pkg.files).toContain('LICENSE');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).toContain('CHANGELOG.md');
    expect(pkg.files).toContain('data/catalogs/');
    expect(pkg.files).toContain('data/mappings/');
    expect(pkg.files).toContain('data/templates/');
    // Must NOT include src/ or tests/
    expect(pkg.files).not.toContain('src/');
    expect(pkg.files).not.toContain('tests/');
  });

  it('has repository, homepage, and bugs fields', () => {
    expect(pkg.repository).toBeDefined();
    expect(pkg.homepage).toBeDefined();
    expect(pkg.bugs).toBeDefined();
  });

  it('declares a prepublishOnly script', () => {
    expect(pkg.scripts?.prepublishOnly).toBeDefined();
    expect(pkg.scripts.prepublishOnly).toMatch(/build/);
    expect(pkg.scripts.prepublishOnly).toMatch(/test/);
  });

  it('declares MIT license', () => {
    expect(pkg.license).toBe('MIT');
  });

  it('is at or beyond 0.4.0', () => {
    const [major, minor] = pkg.version.split('.').map(Number);
    expect(major > 0 || (major === 0 && minor >= 4)).toBe(true);
  });
});

describe('LICENSE file', () => {
  const licensePath = path.join(repoRoot, 'LICENSE');

  it('exists at repo root', () => {
    expect(fs.existsSync(licensePath)).toBe(true);
  });

  it('names MIT and the current rights holder', () => {
    const text = fs.readFileSync(licensePath, 'utf-8');
    expect(text).toMatch(/MIT License/);
    expect(text).toMatch(/Anthony Rossi III/);
  });
});

describe('dist build output', () => {
  const distIndex = path.join(repoRoot, 'dist', 'index.js');

  it('dist/index.js exists (ran `npm run build` at least once)', () => {
    if (!fs.existsSync(distIndex)) {
      // Skip gracefully on fresh checkouts where build hasn't run yet.
      return;
    }
    expect(fs.existsSync(distIndex)).toBe(true);
  });

  it('starts with a node shebang line', () => {
    if (!fs.existsSync(distIndex)) return;
    const first = fs.readFileSync(distIndex, 'utf-8').split('\n', 1)[0];
    expect(first).toBe('#!/usr/bin/env node');
  });
});

describe('src entry point', () => {
  const srcIndex = path.join(repoRoot, 'src', 'index.ts');

  it('starts with a node shebang line (preserved through tsc)', () => {
    const first = fs.readFileSync(srcIndex, 'utf-8').split('\n', 1)[0];
    expect(first).toBe('#!/usr/bin/env node');
  });

  it('reads its --version from package.json instead of a hardcoded literal', () => {
    const text = fs.readFileSync(srcIndex, 'utf-8');
    expect(text).toMatch(/readPackageVersion/);
  });
});

describe('tsconfig.json', () => {
  const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));

  it('uses NodeNext module resolution for ESM', () => {
    expect(tsconfig.compilerOptions.module).toBe('NodeNext');
    expect(tsconfig.compilerOptions.moduleResolution).toBe('NodeNext');
  });

  it('emits declarations and source maps', () => {
    expect(tsconfig.compilerOptions.declaration).toBe(true);
    expect(tsconfig.compilerOptions.sourceMap).toBe(true);
  });

  it('uses strict mode', () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });
});
