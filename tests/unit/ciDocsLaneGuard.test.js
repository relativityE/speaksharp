// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  DOCS_LANE_JOBS, NOT_TEST_SURFACES, REVIEWED_MARKDOWN_MENTIONS, RUNNER_ROOTS, GUARD_HOLD,
  evaluateDocsLaneGuard, runGuard, scanSkippedSurfaces, skippedSurfaces,
} from '../../scripts/ci-docs-lane-guard.mjs';
import { isDocsLaneChange } from '../../scripts/ci-change-scope.mjs';

const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));

/** A throwaway checkout: a workflow whose `build` job the docs lane skips, plus the files that job runs. */
function fixture(files, buildRun = 'node scripts/entry.mjs') {
  const root = mkdtempSync(join(tmpdir(), 'docs-guard-'));
  const jobs = Object.fromEntries([...DOCS_LANE_JOBS, ...Object.keys(NOT_TEST_SURFACES)].map((j) => [j, { steps: [] }]));
  jobs.build = { steps: [{ run: buildRun }] };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  const scan = scanSkippedSurfaces({ root, workflow: { jobs }, packageScripts: {}, files: Object.keys(files) });
  rmSync(root, { recursive: true, force: true });
  return scan;
}
const verdict = (scan, changedFiles, reviewed = {}) => evaluateDocsLaneGuard({ changedFiles, scan, reviewed });

describe('docs-lane guard decisions (synthetic surfaces)', () => {
  it('confirms a change nothing skipped reads', () => {
    const scan = fixture({ 'scripts/entry.mjs': "import fs from 'node:fs'; fs.readFileSync('package.json');", 'docs/a.md': '#' });
    expect(verdict(scan, ['docs/a.md'])).toEqual({ ok: true, reasons: [] });
  });

  it('follows imports transitively and rejects a changed file a skipped job reads', () => {
    const scan = fixture({
      'scripts/entry.mjs': "import { load } from './lib/load.mjs'; load();",
      'scripts/lib/load.mjs': "import fs from 'node:fs'; export const load = () => fs.readFileSync('docs/a.md', 'utf8');",
      'docs/a.md': '#', 'docs/b.md': '#',
    });
    expect(verdict(scan, ['docs/b.md']).ok).toBe(true);
    const held = verdict(scan, ['docs/b.md', 'docs/a.md']);
    expect(held.ok).toBe(false);
    expect(held.reasons).toContain(`${GUARD_HOLD.REFERENCED}:docs/a.md<-scripts/lib/load.mjs`);
  });

  it('follows scripts that a skipped job spawns by name', () => {
    const scan = fixture({
      'scripts/entry.mjs': "import { spawnSync } from 'node:child_process'; spawnSync('bash', ['scripts/stage.sh']);",
      'scripts/stage.sh': 'cat docs/a.md\n',
      'docs/a.md': '#',
    });
    expect(verdict(scan, ['docs/a.md']).reasons[0]).toMatch(/^docs_guard_changed_file_read_by_skipped_surface:docs\/a\.md<-/);
  });

  it('treats a referenced directory as reading every file in it', () => {
    const scan = fixture({ 'scripts/entry.mjs': "const dir = 'docs/guide'; readdir(dir);", 'docs/guide/x.md': '#', 'docs/other.md': '#' });
    expect(verdict(scan, ['docs/guide/x.md']).ok).toBe(false);
    expect(verdict(scan, ['docs/other.md']).ok).toBe(true);
  });

  it('matches a bare or computed Markdown name against any changed path ending with it, and a deleted file too', () => {
    const scan = fixture({ 'scripts/entry.mjs': "const f = `${id}.worksheet.md`; const r = 'README.md'; const gone = 'docs/removed.md';" });
    expect(verdict(scan, ['docs/run-7.worksheet.md']).ok).toBe(false);
    expect(verdict(scan, ['notes/README.md']).ok).toBe(false);
    expect(verdict(scan, ['docs/removed.md']).ok).toBe(false); // not in the checkout: deleted by the change
    expect(verdict(scan, ['docs/NOT_README.md']).ok).toBe(true);
  });

  it('rejects an unreviewed Markdown pattern, and a review covers only the exact string it names', () => {
    const scan = fixture({ 'scripts/entry.mjs': "glob('**/*.md');" });
    expect(verdict(scan, ['docs/a.md']).reasons).toEqual([`${GUARD_HOLD.UNREVIEWED}:scripts/entry.mjs::**/*.md`]);
    expect(verdict(scan, ['docs/a.md'], { 'scripts/entry.mjs::**/*.md': 'reviewed' }).ok).toBe(true);
    const moved = fixture({ 'scripts/entry.mjs': "glob('docs/**/*.md');" });
    expect(verdict(moved, ['docs/a.md'], { 'scripts/entry.mjs::**/*.md': 'reviewed' }).ok).toBe(false);
  });

  it('ignores comments in code but not strings', () => {
    const scan = fixture({ 'scripts/entry.mjs': "// see docs/a.md\n/* docs/a.md */ const x = 1;", 'docs/a.md': '#' });
    expect(verdict(scan, ['docs/a.md']).ok).toBe(true);
  });

  it('does not treat a static asset swept in with a runner root as a reader, but does read code there', () => {
    const scan = fixture({
      'frontend/public/vocab.json': JSON.stringify({ 'docs/a.md': 1 }),
      'frontend/src/main.ts': "export const x = 'safe';",
      'docs/a.md': '#',
    }, 'echo build');
    expect(verdict(scan, ['docs/a.md']).ok).toBe(true);
    const reads = fixture({ 'frontend/src/main.ts': "import doc from '../../docs/a.md?raw'; export default doc;", 'docs/a.md': '#' }, 'echo build');
    expect(verdict(reads, ['docs/a.md']).ok).toBe(false);
  });

  it('refuses anything that is not docs-lane Markdown', () => {
    const scan = fixture({ 'scripts/entry.mjs': '' });
    for (const changed of [[], null, ['scripts/a.mjs'], ['docs/a.md', 'frontend/x.ts'], ['product_release/ROADMAP.md']]) {
      expect(verdict(scan, changed)).toEqual({ ok: false, reasons: [GUARD_HOLD.NOT_DOCS_LANE] });
    }
  });

  it('fails if the workflow stops defining a job the docs lane runs or a declared non-test surface', () => {
    const jobs = Object.fromEntries([...DOCS_LANE_JOBS, ...Object.keys(NOT_TEST_SURFACES)].map((j) => [j, { steps: [] }]));
    expect(skippedSurfaces({ jobs }).map((s) => s.job)).toEqual([]);
    for (const missing of ['docs-evidence', 'draft-checks']) {
      const without = { ...jobs };
      delete without[missing];
      expect(() => skippedSurfaces({ jobs: without })).toThrow(missing);
    }
  });
});

describe('docs-lane guard on this repository', () => {
  let result;
  beforeAll(() => { result = runGuard(process.cwd(), ['docs/a-new-note.md']); }, 60000);

  it('scans every job the docs lane skips, derived from ci.yml', () => {
    const skipped = Object.keys(workflow.jobs).filter((j) => !DOCS_LANE_JOBS.includes(j) && !Object.hasOwn(NOT_TEST_SURFACES, j));
    expect(skippedSurfaces(workflow).map((s) => s.job)).toEqual(skipped);
    expect(skipped).toEqual(expect.arrayContaining(['build', 'e2e', 'health-check', 'edge-tests', 'full-evidence', 'lighthouse-advisory']));
    expect(result.scan.closure.length).toBeGreaterThan(500);
    expect(result.decision).toEqual({ ok: true, reasons: [] });
  });

  it('finds the Markdown that skipped jobs really read (negative controls)', () => {
    for (const read of ['ops-health/ops-health.md', 'tests/model-dropin/EXECUTION.md']) {
      const decision = evaluateDocsLaneGuard({ changedFiles: [read], scan: result.scan });
      expect(decision.ok).toBe(false);
      expect(decision.reasons.some((r) => r.startsWith(`${GUARD_HOLD.REFERENCED}:${read}<-`))).toBe(true);
    }
  });

  it('keeps every reviewed mention current: each one still exists exactly as reviewed', () => {
    const present = new Set(result.scan.markdownLiterals.map((m) => `${m.file}::${m.text}`));
    for (const key of Object.keys(REVIEWED_MARKDOWN_MENTIONS)) expect(present.has(key)).toBe(true);
  });

  it('pins each runner root to the configuration that selects it', () => {
    expect(RUNNER_ROOTS).toEqual(['frontend', 'tests/e2e', 'backend/supabase/functions']);
    expect(readFileSync('playwright.config.ts', 'utf8')).toMatch(/testDir:\s*'\.\/tests\/e2e'/);
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:edge']).toContain(' backend/supabase/functions');
  });
});

describe('docs-lane workflow wiring', () => {
  const jobs = workflow.jobs;
  const ifOf = (job) => String(jobs[job].if ?? '');

  it('offers the docs lane only after the guard confirms it on the same checkout', () => {
    const steps = jobs.scope.steps;
    const names = steps.map((s) => s.name);
    const candidate = names.indexOf('Detect Docs Lane Candidate');
    const guard = names.indexOf('Check No Skipped Job Names The Changed Files (Static)');
    const classify = names.indexOf('Classify Change');
    expect(candidate).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(candidate);
    expect(classify).toBeGreaterThan(guard);
    expect(steps[guard].if).toBe("steps.candidate.outputs.docs_lane_candidate == 'true'");
    expect(steps[guard].run).toContain('node scripts/ci-docs-lane-guard.mjs "$RUNNER_TEMP/changed.txt"');
    expect(steps[classify].env.DOCS_LANE_CONFIRMED).toBe("${{ steps.docs_guard.outputs.confirmed == 'true' }}");
    expect(steps[candidate].env.DOCS_LANE_CONFIRMED).toBeUndefined();
    expect(jobs.scope.outputs.docs_lane).toBe('${{ steps.classify.outputs.docs_lane }}');
  });

  it('runs the complete unit suite, quality and the partition proof on the docs lane', () => {
    for (const job of ['deps-prep', 'unit-shard', 'quality', 'unit-coverage-merge', 'docs-evidence']) {
      expect(ifOf(job)).toContain("needs.scope.outputs.docs_lane == 'true'");
    }
    expect(ifOf('draft-checks')).toContain("needs.scope.outputs.docs_lane != 'true'");
  });

  it('never runs a scanned (skipped) job on the docs lane', () => {
    for (const { job } of skippedSurfaces(workflow)) expect(ifOf(job)).not.toContain('docs_lane');
  });

  it('re-derives the lane and re-runs the guard inside docs-evidence, and uploads its receipt', () => {
    const steps = jobs['docs-evidence'].steps;
    const derive = steps.find((s) => s.name === 'Re-derive The Docs Lane On This Checkout');
    expect(derive.env.REQUIRE_DOCS_LANE).toBe('true');
    expect(derive.run).toContain('node scripts/ci-change-scope.mjs');
    expect(derive.run).toContain('node scripts/ci-docs-lane-guard.mjs');
    expect(derive.run).toContain('set -euo pipefail');
    for (const run of ['node scripts/validate-env.mjs', 'pnpm test:billing-qualification']) {
      expect(steps.some((s) => s.run === run)).toBe(true);
    }
    expect(steps.some((s) => String(s.run).startsWith('git diff --check'))).toBe(true);
    expect(steps.find((s) => s.name === 'Upload Docs Lane Evidence').with['if-no-files-found']).toBe('error');
    expect(steps.every((s) => s['continue-on-error'] === undefined)).toBe(true);
  });

  it('lists both sides of a rename in every diff the docs lane is derived from (real git)', () => {
    // Codex P1 on e302468: with rename detection, code renamed to Markdown listed only the Markdown destination.
    const diffLine = (job, name) => jobs[job].steps.find((s) => s.name === name).run.split('\n')
      .map((l) => l.trim()).find((l) => l.startsWith('git diff') && l.includes('changed.txt'));
    const lines = [diffLine('scope', 'Resolve Changed Files'), diffLine('docs-evidence', 'Re-derive The Docs Lane On This Checkout')];
    const repo = mkdtempSync(join(tmpdir(), 'docs-lane-rename-'));
    const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    try {
      git('init', '-q');
      git('config', 'diff.renames', 'copies');
      mkdirSync(join(repo, 'tests/e2e'), { recursive: true });
      writeFileSync(join(repo, 'tests/e2e/flow.e2e.spec.ts'), 'export const steps = ["sign in", "delete account", "remount"];\n'.repeat(20));
      git('add', '-A'); git('commit', '-qm', 'base');
      const base = git('rev-parse', 'HEAD').stdout.trim();
      mkdirSync(join(repo, 'docs'), { recursive: true });
      git('mv', 'tests/e2e/flow.e2e.spec.ts', 'docs/retired.md'); git('commit', '-qm', 'rename');
      for (const line of lines) {
        expect(line).toContain('--no-renames');
        const out = spawnSync('bash', ['-c', `set -euo pipefail; ${line}; cat "$RUNNER_TEMP/changed.txt"`],
          { cwd: repo, encoding: 'utf8', env: { ...process.env, BASE_SHA: base, RUNNER_TEMP: repo } });
        expect(out.status).toBe(0);
        const changed = out.stdout.split('\n').filter((l) => l && l !== 'changed.txt');
        expect(changed.sort()).toEqual(['docs/retired.md', 'tests/e2e/flow.e2e.spec.ts']);
        expect(isDocsLaneChange(changed)).toBe(false);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('docs-evidence refuses to qualify a non-draft PR, even a confirmed docs-only one (real CLI)', () => {
    // #1837 (Sam's review): the docs lane is for drafts only. docs-evidence re-runs the classifier with
    // REQUIRE_DOCS_LANE, so a merge candidate cannot be qualified by docs-lane evidence however it was selected.
    const dir = mkdtempSync(join(tmpdir(), 'docs-lane-draft-'));
    try {
      writeFileSync(join(dir, 'changed.txt'), 'README.md\ndocs/guide/x.md\n');
      const run = (isDraft) => spawnSync(process.execPath, ['scripts/ci-change-scope.mjs', join(dir, 'changed.txt')], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: '', EVENT_NAME: 'pull_request', IS_DRAFT: isDraft, DOCS_LANE_CONFIRMED: 'true', REQUIRE_DOCS_LANE: 'true' },
      });
      expect(run('true').status).toBe(0);
      const merge = run('false');
      expect(merge.status).not.toBe(0);
      expect(merge.stdout).toContain('non_draft_pr');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('report requires both the unit gate and docs-evidence on the docs lane (real shell)', () => {
    const step = jobs.report.steps.find((s) => s.name === 'Enforce Selected Lane');
    expect(jobs.report.needs).toContain('docs-evidence');
    const run = (env) => spawnSync('bash', ['-c', step.run], {
      env: { ...process.env, SCOPE_RESULT: 'success', FULL_REQUIRED: 'false', DOCS_LANE: 'true', DRAFT_RESULT: 'skipped', QUALITY_RESULT: 'success', ...env },
      encoding: 'utf8',
    }).status;
    expect(run({ UNIT_RESULT: 'success', DOCS_RESULT: 'success' })).toBe(0);
    for (const [unit, docs] of [['success', 'failure'], ['success', 'skipped'], ['failure', 'success'], ['skipped', 'success'], ['cancelled', 'success']]) {
      expect(run({ UNIT_RESULT: unit, DOCS_RESULT: docs })).not.toBe(0);
    }
  });
});
