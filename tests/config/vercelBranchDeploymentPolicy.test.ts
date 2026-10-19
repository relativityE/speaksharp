// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Use minimatch from ESLint's declared dependency, without adding a runtime/lockfile dependency.
const localRequire = createRequire(import.meta.url);
const eslintRequire = createRequire(localRequire.resolve('eslint/package.json'));
const { Minimatch } = eslintRequire('minimatch') as {
  Minimatch: new (pattern: string) => { match: (branch: string) => boolean };
};
// @ts-expect-error — existing dependency-free Vercel build script is intentionally plain .mjs.
import { decideExitCode, EXIT_BUILD } from '../../scripts/vercel-ignore-build.mjs';
// @ts-expect-error — existing manual-preview assembly script is intentionally plain .mjs.
import { deploymentConfigFrom } from '../../scripts/ci/build-preview-deploy-root.mjs';

type DeploymentPolicy = boolean | Record<string, boolean>;
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  git?: { deploymentEnabled?: DeploymentPolicy };
  github?: { autoJobCancelation?: boolean };
  ignoreCommand?: string;
  rewrites: unknown[];
  headers: unknown[];
};
const policy = config.git?.deploymentEnabled;

/**
 * Executable model of Vercel's documented Git policy, not a hosted deployment receipt:
 * https://vercel.com/docs/project-configuration/git-configuration
 * Patterns use minimatch; unmatched branches default to enabled; any matching true enables.
 */
function allowsDeployment(branch: string, rules: DeploymentPolicy | undefined = policy): boolean {
  if (typeof rules === 'boolean') return rules;
  const matches = Object.entries(rules ?? {}).filter(([pattern]) => new Minimatch(pattern).match(branch));
  return matches.length === 0 || matches.some(([, enabled]) => enabled);
}

const allowed = ['main', 'preview/rc', 'preview/team/rc', 'preview/team/device/rc'];
const denied = [
  'work', 'feature', 'fix/one', 'cli-dev/evaluator', 'cli-dev/team/task',
  'candidate/mvp-rc1-20261019', 'release/next', 'feature/team/topic',
  'preview', 'preview-rc', 'previews/rc', 'Preview/rc', 'feat/preview/rc',
  'my-preview/rc', 'main/topic', 'Main', 'MAIN', 'master',
];

describe('Vercel automatic Git deployment branch policy', () => {
  it.each(allowed)('allows deliberate automatic build branch %s', (branch) => {
    expect(allowsDeployment(branch)).toBe(true);
  });

  it.each(denied)('blocks ordinary or near-miss branch %s before build creation', (branch) => {
    expect(allowsDeployment(branch)).toBe(false);
  });

  it('has the same decisions regardless of rule ordering', () => {
    expect(policy).toBeTypeOf('object');
    const reversed = Object.fromEntries(Object.entries(policy as Record<string, boolean>).reverse());
    for (const branch of [...allowed, ...denied]) {
      expect(allowsDeployment(branch, reversed)).toBe(allowsDeployment(branch));
    }
  });

  it('detects a single-star catch-all that leaks nested ordinary branches', () => {
    expect(allowsDeployment('fix/one', { '*': false, main: true, 'preview/**': true })).toBe(true);
    expect(allowsDeployment('fix/one')).toBe(false);
  });

  it('detects omitted catch-all and blanket-allow policies', () => {
    expect(allowsDeployment('candidate/rc', { main: true, 'preview/**': true })).toBe(true);
    expect(allowsDeployment('candidate/rc', true)).toBe(true);
    expect(allowsDeployment('candidate/rc')).toBe(false);
  });

  it('detects a single-level preview rule and blanket-disable policies', () => {
    expect(allowsDeployment('preview/team/rc', { '**': false, main: true, 'preview/*': true })).toBe(false);
    expect(allowsDeployment('main', false)).toBe(false);
    expect(allowsDeployment('preview/team/rc')).toBe(true);
    expect(allowsDeployment('main')).toBe(true);
  });

  it('keeps allowed flat/nested previews aligned with the existing ignored-build step', () => {
    expect(config.ignoreCommand).toBe('node scripts/vercel-ignore-build.mjs');
    for (const branch of allowed) {
      expect(decideExitCode(branch === 'main' ? 'production' : 'preview', branch)).toBe(EXIT_BUILD);
    }
    expect(config.github?.autoJobCancelation).not.toBe(false);
  });

  it('preserves runtime directives for the explicit manual-preview upload', () => {
    const manual = deploymentConfigFrom(config);
    expect(manual.rewrites).toEqual(config.rewrites);
    expect(manual.headers).toEqual(config.headers);
    expect(manual).not.toHaveProperty('git');
    expect(manual).not.toHaveProperty('ignoreCommand');
  });
});
