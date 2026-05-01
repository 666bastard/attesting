import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Phase 5M — GitHub Actions workflow validation tests.
 *
 * These assert the shape of .github/workflows/*.yml without adding a
 * YAML parser dependency. Structural string checks are enough to catch
 * regressions like removing the Node matrix, breaking the release tag
 * trigger, or drifting the package size guard.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.resolve(__dirname, '..', '..', '.github', 'workflows');

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(workflowsDir, name), 'utf-8');
}

describe('.github/workflows — file presence', () => {
  it('ci.yml exists', () => {
    expect(fs.existsSync(path.join(workflowsDir, 'ci.yml'))).toBe(true);
  });

  it('release.yml exists', () => {
    expect(fs.existsSync(path.join(workflowsDir, 'release.yml'))).toBe(true);
  });

  it('codeql.yml exists', () => {
    expect(fs.existsSync(path.join(workflowsDir, 'codeql.yml'))).toBe(true);
  });
});

describe('ci.yml — build matrix and steps', () => {
  const ci = readWorkflow('ci.yml');

  it('declares name: CI', () => {
    expect(ci).toMatch(/^name:\s*CI\s*$/m);
  });

  it('triggers on push to main and pull_request to main', () => {
    expect(ci).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(ci).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  it('uses a Node matrix with both 20 and 22', () => {
    // `node-version: [20, 22]` — either order
    expect(ci).toMatch(/node-version:\s*\[.*\b20\b.*\]/);
    expect(ci).toMatch(/node-version:\s*\[.*\b22\b.*\]/);
  });

  it('runs typecheck, build, and tests', () => {
    expect(ci).toMatch(/npm run lint/);
    expect(ci).toMatch(/npm run build/);
    expect(ci).toMatch(/npm test/);
  });

  it('caches npm via setup-node', () => {
    expect(ci).toMatch(/setup-node@v\d+[\s\S]*?cache:\s*['"]?npm['"]?/);
  });

  it('has an npm pack size verification step', () => {
    expect(ci).toMatch(/npm pack --dry-run/);
    expect(ci).toMatch(/5242880/); // 5 MB byte threshold
  });

  it('runs supplementary jobs for security, oscal, catalog integrity, accessibility', () => {
    expect(ci).toMatch(/^\s*security:/m);
    expect(ci).toMatch(/^\s*oscal-validation:/m);
    expect(ci).toMatch(/^\s*catalog-integrity:/m);
    expect(ci).toMatch(/^\s*accessibility:/m);
  });
});

describe('release.yml — tag-triggered publish', () => {
  const release = readWorkflow('release.yml');

  it('declares name: Release', () => {
    expect(release).toMatch(/^name:\s*Release\s*$/m);
  });

  it('triggers ONLY on version tags (v*)', () => {
    expect(release).toMatch(/tags:\s*\n\s*-\s*['"]?v\*['"]?/);
    // Must NOT trigger on branch push or pull_request
    expect(release).not.toMatch(/^\s*pull_request:/m);
    expect(release).not.toMatch(/branches:/);
  });

  it('verifies the tag matches package.json version before publishing', () => {
    expect(release).toMatch(/GITHUB_REF_NAME/);
    expect(release).toMatch(/package\.json/);
    expect(release).toMatch(/TAG_VERSION.*PKG_VERSION|PKG_VERSION.*TAG_VERSION/);
  });

  it('runs build and tests before publishing', () => {
    const buildIdx = release.indexOf('npm run build');
    const testIdx = release.indexOf('npm test');
    // Match the exact `npm publish --access` invocation, not the "npm
    // publish" substring that also appears in the header comment.
    const publishIdx = release.indexOf('npm publish --access');
    expect(buildIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeLessThan(publishIdx);
    expect(testIdx).toBeLessThan(publishIdx);
  });

  it('publishes with provenance and public access', () => {
    expect(release).toMatch(/npm publish[^\n]*--access public/);
    expect(release).toMatch(/--provenance/);
    expect(release).toMatch(/id-token:\s*write/);
  });

  it('uses NODE_AUTH_TOKEN from NPM_TOKEN secret', () => {
    expect(release).toMatch(/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  });

  it('sets registry-url so npm publish authenticates against npmjs.org', () => {
    expect(release).toMatch(/registry-url:\s*['"]https:\/\/registry\.npmjs\.org['"]?/);
  });

  it('creates a GitHub Release after publish', () => {
    expect(release).toMatch(/softprops\/action-gh-release/);
    expect(release).toMatch(/generate_release_notes:\s*true/);
  });

  it('has a package size guard matching the CI one', () => {
    expect(release).toMatch(/npm pack --dry-run/);
    expect(release).toMatch(/5242880/);
  });
});

describe('workflow files — basic YAML sanity', () => {
  // Without a YAML parser we just check that the files don't contain
  // obvious structural mistakes (stray tabs, unmatched braces, BOM).
  for (const file of ['ci.yml', 'release.yml', 'codeql.yml']) {
    it(`${file} has no tab characters`, () => {
      const content = readWorkflow(file);
      expect(content.includes('\t'), `${file} contains literal tabs`).toBe(false);
    });

    it(`${file} starts with 'name:' or a comment`, () => {
      const content = readWorkflow(file);
      const firstNonEmpty = content.split('\n').find((l) => l.trim().length > 0) ?? '';
      expect(firstNonEmpty).toMatch(/^(#|name:)/);
    });

    it(`${file} has balanced \${{ }} expressions`, () => {
      const content = readWorkflow(file);
      const opens = (content.match(/\$\{\{/g) ?? []).length;
      const closes = (content.match(/\}\}/g) ?? []).length;
      expect(opens, `${file}: \${{ / }} mismatch`).toBe(closes);
    });
  }
});

describe('README badges', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '..', '..', 'README.md'), 'utf-8');

  it('CI badge points at the ci.yml workflow', () => {
    expect(readme).toMatch(/!\[CI\]\(https:\/\/github\.com\/xtonyknucklesx\/attesting\/actions\/workflows\/ci\.yml\/badge\.svg\)/);
  });

  it('License badge is present', () => {
    expect(readme).toMatch(/!\[License: MIT\]/);
  });

  it('Node version badge declares >=20', () => {
    expect(readme).toMatch(/!\[Node\][^)]*node-[^)]*20/);
  });
});
