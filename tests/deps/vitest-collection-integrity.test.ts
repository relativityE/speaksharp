// @vitest-environment node
// Node, not jsdom: this suite imports the vite/vitest configs themselves, and esbuild refuses to load under
// jsdom's TextEncoder ("new TextEncoder().encode('') instanceof Uint8Array" is false there).
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import rootConfig from '../../vitest.config.mjs';
import frontendConfig from '../../frontend/vitest.config.mjs';

// #1314 / #1258 Phase A — regression coverage for the two test-infrastructure corrections.
//
// Before these, a bare `npx vitest run …` from the repo root loaded NO config, which gave two wrong answers
// instead of an error:
//   (1) FALSE FAILURES — no `@` alias, so root suites importing `@/services/…` could not resolve. This is the
//       entire reason `tests/release/launch-telemetry-content-free.contract.test.ts` "failed".
//   (2) FALSE PASSES — no root-anchored `include`, so vitest's default `**/*.test.*` swept
//       `test-support/worktrees/**`: other branches' checkouts. Their results were collected and counted as
//       this branch's.
// (2) is the more dangerous failure mode, because it inflates a green total rather than announcing itself.

const REPO_ROOT = path.resolve(__dirname, '../..');

/** A real foreign-worktree test path — the shape that was being wrongly collected. */
const FOREIGN_WORKTREE_TEST = 'test-support/worktrees/test/1144-device-matrix/tests/release/deviceQualificationContract.test.ts';
/** A genuine first-party test that must always stay collected. */
const FIRST_PARTY_TEST = 'tests/release/launch-telemetry-content-free.contract.test.ts';

const testCfg = (c: { test?: Record<string, unknown> }) => c.test ?? {};
const include = testCfg(rootConfig as never).include as string[];
const exclude = testCfg(rootConfig as never).exclude as string[];

const matchesAny = (patterns: string[], p: string) => patterns.some((glob) => picomatch(glob)(p));

describe('#1314 — one vitest collection authority, regardless of how vitest is started', () => {
  it('the root config IS the frontend config (not a divergent copy)', () => {
    // Re-export, not duplication: a copied config would drift, and drift is what caused this.
    expect(rootConfig).toBe(frontendConfig);
  });

  it('resolves the `@` alias to frontend/src', () => {
    const alias = (rootConfig as { resolve?: { alias?: Array<{ find: unknown; replacement: string }> } }).resolve?.alias;
    expect(alias, 'root config must carry the @ alias').toBeTruthy();
    const bare = alias!.find((a) => a.find === '@');
    expect(bare?.replacement).toBe(path.resolve(REPO_ROOT, 'frontend/src'));
  });

  it('the aliased import that used to fail resolves to a file that actually exists', () => {
    // Proves the correction is real rather than nominal: follow the alias to disk.
    const resolved = path.resolve(REPO_ROOT, 'frontend/src', 'services/practiceTelemetry');
    expect(
      ['.ts', '.tsx', '.js'].some((ext) => existsSync(resolved + ext)),
      `@/services/practiceTelemetry must resolve under the alias (looked at ${resolved}.*)`,
    ).toBe(true);
  });
});

describe("#1314 — foreign worktree checkouts are never collected as this branch's tests", () => {
  it('excludes test-support/**', () => {
    expect(matchesAny(exclude, FOREIGN_WORKTREE_TEST)).toBe(true);
  });

  it('does not INCLUDE a foreign worktree test even before exclusion', () => {
    // Defence in depth: the root-anchored include must not reach into test-support/ on its own, so the suite
    // stays correct even if someone edits the exclude list.
    expect(matchesAny(include, FOREIGN_WORKTREE_TEST)).toBe(false);
  });

  it('keeps every include pattern root-anchored (no leading `**/`)', () => {
    // A single `**/` prefix is all it takes to sweep every sibling checkout back in.
    for (const glob of include) expect(glob.startsWith('**/'), `include pattern "${glob}" is not root-anchored`).toBe(false);
  });

  it('still collects genuine first-party tests', () => {
    expect(matchesAny(include, FIRST_PARTY_TEST)).toBe(true);
    expect(matchesAny(exclude, FIRST_PARTY_TEST)).toBe(false);
    expect(matchesAny(include, 'tests/deps/vitest-collection-integrity.test.ts')).toBe(true);
    expect(matchesAny(include, 'frontend/src/utils/__tests__/fillerWordUtils.test.ts')).toBe(true);
  });
});
