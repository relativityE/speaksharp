// CI-GATE (#1328) — falsification for fail-closed merge qualification.
//
// Each case below is a way the previous aggregation could report a mergeable run while nothing ran.
// Two of the fixtures are REAL captured job sets rather than invented ones, because the defect this
// guards against already reached production twice and the genuine article is stronger evidence than
// anything hand-written.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateMergeQualification, formatQualification, REQUIRED_JOBS } from '../../scripts/ci-merge-qualification.mjs';

/** A full lane where everything ran — real shape of main push run 32744959454 at e1b07886. */
const ALL_SUCCESS = {
  scope: 'success', build: 'success', 'edge-tests': 'success', 'unit-shard': 'success',
  'unit-coverage-merge': 'success', e2e: 'success', 'health-check': 'success', 'full-evidence': 'success',
  'draft-checks': 'skipped', 'deps-prep': 'success', 'lighthouse-advisory': 'success', report: 'success',
};

/**
 * REAL SPECIMEN — Draft PR run 32742595731 on head 3bf41d27 (PR #1335).
 * Workflow-level conclusion: success. Jobs that actually executed: scope, draft-checks, report.
 * Every substantive job was skipped. This exact shape is what merged #1306 onto a red main.
 */
const REAL_FALSE_GREEN_32742595731 = {
  scope: 'success', 'draft-checks': 'success', 'deps-prep': 'skipped', build: 'skipped',
  'edge-tests': 'skipped', 'lighthouse-advisory': 'skipped', 'unit-shard': 'skipped',
  'unit-coverage-merge': 'skipped', 'health-check': 'skipped', e2e: 'skipped',
  'full-evidence': 'skipped', report: 'success',
};

const withRequired = (overrides) => ({ ...ALL_SUCCESS, ...overrides });

describe('CI-GATE merge qualification', () => {
  it('CASE 1 — every required job success on a full lane: QUALIFIED', () => {
    const d = evaluateMergeQualification({ fullRequired: 'true', results: ALL_SUCCESS });
    expect(d.reasons).toEqual([]);
    expect(d.qualified).toBe(true);
  });

  it('CASE 2 — one required job skipped: NOT qualified', () => {
    const d = evaluateMergeQualification({ fullRequired: 'true', results: withRequired({ e2e: 'skipped' }) });
    expect(d.qualified).toBe(false);
    expect(d.reasons).toContain('e2e:skipped');
  });

  it('CASE 3 — one required job cancelled: NOT qualified', () => {
    const d = evaluateMergeQualification({ fullRequired: 'true', results: withRequired({ build: 'cancelled' }) });
    expect(d.qualified).toBe(false);
    expect(d.reasons).toContain('build:cancelled');
  });

  it('CASE 4 — one required job failed: NOT qualified', () => {
    const d = evaluateMergeQualification({ fullRequired: 'true', results: withRequired({ 'edge-tests': 'failure' }) });
    expect(d.qualified).toBe(false);
    expect(d.reasons).toContain('edge-tests:failure');
  });

  it('CASE 5 — a required job MISSING from needs entirely: NOT qualified', () => {
    // Silently dropping a job from `needs:` must break qualification, not disappear from it.
    const results = { ...ALL_SUCCESS };
    delete results['full-evidence'];
    const d = evaluateMergeQualification({ fullRequired: 'true', results });
    expect(d.qualified).toBe(false);
    expect(d.reasons).toContain('full-evidence:missing');
  });

  it('CASE 6 — draft partial lane where draft-checks alone succeeded: NOT qualified', () => {
    const d = evaluateMergeQualification({
      fullRequired: 'false',
      results: { scope: 'success', 'draft-checks': 'success', report: 'success' },
    });
    expect(d.qualified).toBe(false);
    expect(d.reasons).toContain('full_lane_not_required:draft_or_partial_run_is_not_merge_qualified');
    // ...and the substantive jobs are reported individually as missing, not glossed over.
    expect(d.reasons).toContain('build:missing');
    expect(d.reasons).toContain('e2e:missing');
  });

  it('CASE 7 — REAL specimen 32742595731 (workflow said success) is REJECTED', () => {
    const d = evaluateMergeQualification({ fullRequired: 'false', results: REAL_FALSE_GREEN_32742595731 });
    expect(d.qualified).toBe(false);
    // Every substantive job must be named in the rejection, so the operator sees what did not run.
    for (const job of ['build', 'edge-tests', 'unit-shard', 'unit-coverage-merge', 'e2e', 'health-check', 'full-evidence']) {
      expect(d.reasons).toContain(`${job}:skipped`);
    }
    // The two jobs that DID succeed must not launder the run.
    expect(d.reasons.some(r => r.startsWith('draft-checks'))).toBe(false);
    expect(REQUIRED_JOBS).not.toContain('draft-checks');
    expect(REQUIRED_JOBS).not.toContain('report');
  });

  // ---- Mutation resistance: an aggregator loosened to accept non-success work must fail here ----

  it('ONLY the literal "success" qualifies — every other GitHub conclusion is rejected', () => {
    // Kills the family of mutants that accept 'skipped', 'neutral', 'success-ish' truthiness, etc.
    for (const bad of ['skipped', 'cancelled', 'failure', 'neutral', 'timed_out', 'action_required', 'stale', 'SUCCESS', 'Success', 'true', '1']) {
      const d = evaluateMergeQualification({ fullRequired: 'true', results: withRequired({ e2e: bad }) });
      expect(d.qualified, `conclusion "${bad}" must not qualify`).toBe(false);
    }
  });

  it('null / empty / undefined results are rejected, and a non-object results is not treated as clean', () => {
    for (const bad of [null, undefined, '']) {
      const d = evaluateMergeQualification({ fullRequired: 'true', results: withRequired({ build: bad }) });
      expect(d.qualified).toBe(false);
    }
    for (const notAMap of [null, undefined, 'success', 42, ['success']]) {
      const d = evaluateMergeQualification({ fullRequired: 'true', results: notAMap });
      expect(d.qualified, `results=${JSON.stringify(notAMap)} must fail closed`).toBe(false);
    }
  });

  it('an empty required set cannot be used to wave a run through', () => {
    // Guards the mutant that empties REQUIRED_JOBS: with no required jobs the loop finds nothing to
    // complain about, so the full-lane gate must still stand on its own.
    const d = evaluateMergeQualification({ fullRequired: 'false', results: {}, required: [] });
    expect(d.qualified).toBe(false);
  });

  it('REQUIRED_JOBS covers every substantive lane and is immutable', () => {
    for (const job of ['scope', 'build', 'edge-tests', 'unit-shard', 'unit-coverage-merge', 'e2e', 'health-check', 'full-evidence']) {
      expect(REQUIRED_JOBS).toContain(job);
    }
    expect(Object.isFrozen(REQUIRED_JOBS)).toBe(true);
  });

  it('formats a rejection that names the failing job', () => {
    const d = evaluateMergeQualification({ fullRequired: 'true', results: withRequired({ e2e: 'skipped' }) });
    const text = formatQualification(d);
    expect(text).toContain('FAIL  e2e: skipped');
    expect(text).toContain('NOT MERGE-QUALIFIED');
  });

  // ---- The workflow must actually consume the decision ----

  it('ci.yml wires a merge-qualification job that feeds every required job into the evaluator', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('merge-qualification:');
    expect(ci).toContain('scripts/ci-merge-qualification.mjs');
    // It must depend on each required job, or `needs.<job>.result` would silently be missing —
    // which the evaluator rejects, but the workflow should not be built to rely on that.
    for (const job of REQUIRED_JOBS) {
      expect(ci, `merge-qualification must need "${job}"`).toMatch(new RegExp(`needs:[^\\n]*\\n?[\\s\\S]{0,400}?${job.replace('-', '-')}`));
    }
    // It must run even when an upstream job failed, or a red lane would simply skip the gate.
    expect(ci).toMatch(/merge-qualification:[\s\S]{0,400}if:\s*always\(\)/);
  });
});
