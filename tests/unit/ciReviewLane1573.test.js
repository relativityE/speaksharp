/**
 * #1573 (Browser PM 6067238534, user priority) — REVIEW ACTIVITY NEVER RE-RUNS OR CANCELS THE ENGINEERING LANE.
 *
 * `ci.yml` subscribed to review and inline-comment events, forced the full lane for both and shared `ci-<PR>` with
 * `cancel-in-progress: true`, so every Codex finding cancelled and rebuilt the same candidate. Review activity now runs a
 * separate, cheap review lane that reuses the exact-head engineering evidence and still fails closed on findings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { evaluateEngineeringEvidence, ENGINEERING_HOLD } from '../../scripts/ci-engineering-evidence.mjs';

const load = (f) => yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows', f), 'utf8'));
const REVIEW_EVENTS = ['pull_request_review', 'pull_request_review_comment'];

describe('engineering lane (ci.yml): review activity cannot start, force or cancel it', () => {
    const ci = load('ci.yml');
    it('does not subscribe to review or inline-comment events', () => {
        for (const e of REVIEW_EVENTS) expect(Object.keys(ci.on)).not.toContain(e);
    });
    it('a genuine code change still runs it (pull_request, push to main, merge queue, dispatch)', () => {
        expect(Object.keys(ci.on)).toEqual(expect.arrayContaining(['pull_request', 'push', 'merge_group', 'workflow_dispatch']));
    });
    it('no review event can force the full lane', () => {
        const forceFull = String(ci.jobs.scope.steps.find((s) => s.id === 'classify').env.FORCE_FULL);
        for (const e of REVIEW_EVENTS) expect(forceFull).not.toContain(e);
    });
    it('keeps its own concurrency group, so newer code still supersedes older code', () => {
        expect(ci.concurrency.group).toMatch(/^ci-\$\{\{/);
        expect(ci.concurrency['cancel-in-progress']).toBe(true);
    });
    it('`report` is still produced by the engineering lane', () => {
        expect(ci.jobs.report.name).toBe('report');
    });
});

describe('review lane (review-qualification.yml): cheap, isolated, read-only', () => {
    const wf = load('review-qualification.yml');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
    const runText = steps.map((s) => String(s.run ?? '')).join('\n');
    it('runs on review activity and on engineering completion', () => {
        for (const e of REVIEW_EVENTS) expect(Object.keys(wf.on)).toContain(e);
        expect(wf.on.workflow_run.workflows).toEqual(['CI - Test Audit']);
        expect(wf.on.workflow_run.types).toEqual(['completed']);
    });
    it('uses a concurrency group that can never cancel the engineering lane', () => {
        expect(wf.concurrency.group).toMatch(/^review-qual-/);
        expect(wf.concurrency.group).not.toMatch(/^ci-/);
    });
    it('runs no build, unit, E2E or install step, and never reports the required `report` context', () => {
        expect(runText).not.toMatch(/vitest|playwright|pnpm (install|build|test|ci:)|build:test/);
        expect(Object.values(wf.jobs).map((j) => j.name)).not.toContain('report');
        expect(Object.values(wf.jobs).some((j) => j.strategy?.matrix)).toBe(false);
    });
    it('has only read permissions', () => {
        expect(Object.values(wf.permissions)).toEqual(expect.arrayContaining(['read']));
        expect(Object.values(wf.permissions)).not.toContain('write');
    });
    it('checks engineering evidence AND live review state (Code and Security via the existing collector)', () => {
        expect(runText).toMatch(/scripts\/ci-engineering-evidence\.mjs/);
        expect(runText).toMatch(/scripts\/collect-review-qualification\.mjs/);
    });
});

describe('ci-engineering-evidence: only exact-head, complete, successful engineering evidence qualifies', () => {
    const HEAD = 'a'.repeat(40);
    const BASE = 'b'.repeat(40);
    const run = (over = {}) => ({
        id: 100, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: HEAD,
        created_at: '2026-10-08T19:00:00Z', pull_requests: [{ number: 1573, base: { sha: BASE }, head: { sha: HEAD } }], ...over,
    });
    const jobs = (over = {}) => ({ scope: 'success', 'full-evidence': 'success', report: 'success', ...over });
    const evaluate = (runs, jobsByRun, extra = {}) => evaluateEngineeringEvidence({
        pr: 1573, liveHeadSha: HEAD, liveBaseSha: BASE, expectedHeadSha: HEAD, runs, jobsByRun, headContainsBase: true, ...extra,
    });

    it('passing exact-head engineering qualifies (no further test run needed)', () => {
        expect(evaluate([run()], { 100: jobs() })).toMatchObject({ qualified: true, runId: 100, reasons: [] });
    });
    it('a head that moved since the event holds', () => {
        expect(evaluate([run()], { 100: jobs() }, { expectedHeadSha: 'c'.repeat(40) }).reasons).toContain(ENGINEERING_HOLD.HEAD_MOVED);
    });
    it('no engineering run for the exact head holds', () => {
        expect(evaluate([run({ head_sha: 'c'.repeat(40) })], {}).reasons).toContain(ENGINEERING_HOLD.NO_RUN);
    });
    it('the NEWEST run decides: a newer in-progress or failed run never falls back to an older green one', () => {
        const older = run({ id: 100, created_at: '2026-10-08T18:00:00Z' });
        const newerRunning = run({ id: 200, status: 'in_progress', conclusion: null, created_at: '2026-10-08T19:30:00Z' });
        const newerFailed = run({ id: 300, conclusion: 'failure', created_at: '2026-10-08T19:30:00Z' });
        expect(evaluate([older, newerRunning], { 100: jobs() })).toMatchObject({ qualified: false, runId: 200 });
        expect(evaluate([older, newerRunning], { 100: jobs() }).reasons).toContain(ENGINEERING_HOLD.NOT_COMPLETED);
        expect(evaluate([older, newerFailed], { 100: jobs(), 300: jobs({ report: 'failure' }) })).toMatchObject({ qualified: false, runId: 300 });
    });
    it('LIVE CASUALTY (run 37835913578): a run whose ONLY failures are its own review gates still qualifies', () => {
        // The engineering run concludes `failure` while reviews are pending, purely because its exact-head review and merge
        // qualification jobs fail closed. Requiring run-level success made the review lane circular: it could never qualify.
        const pendingReview = run({ conclusion: 'failure' });
        const j = jobs({ 'exact-head-review-qualification': 'failure', 'merge-qualification': 'failure', build: 'success', 'e2e-shard-2': 'success' });
        expect(evaluate([pendingReview], { 100: j })).toMatchObject({ qualified: true, runId: 100 });
    });
    it('a run with any OTHER failed or cancelled job holds', () => {
        const failed = run({ conclusion: 'failure' });
        expect(evaluate([failed], { 100: jobs({ 'e2e-shard-2': 'failure', 'merge-qualification': 'failure' }) }).reasons)
            .toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
        expect(evaluate([failed], { 100: jobs({ 'unit-shard-3': 'cancelled' }) }).reasons).toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
    });
    it('a cancelled run holds', () => {
        expect(evaluate([run({ conclusion: 'cancelled' })], { 100: jobs() }).reasons).toContain(ENGINEERING_HOLD.RUN_NOT_SUCCESSFUL);
    });
    it('a draft-lane run (report green, full-evidence skipped) holds', () => {
        expect(evaluate([run()], { 100: jobs({ 'full-evidence': 'skipped' }) }).reasons).toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
    });
    it('a missing required job holds', () => {
        const j = jobs(); delete j.report;
        expect(evaluate([run()], { 100: j }).reasons).toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
    });
    it('a run against a different base holds; a dispatch run (no PR base) needs the head to contain the live base', () => {
        expect(evaluate([run({ pull_requests: [{ number: 1573, base: { sha: 'd'.repeat(40) }, head: { sha: HEAD } }] })], { 100: jobs() }).reasons)
            .toContain(ENGINEERING_HOLD.BASE_MISMATCH);
        const dispatch = run({ event: 'workflow_dispatch', pull_requests: [] });
        expect(evaluate([dispatch], { 100: jobs() })).toMatchObject({ qualified: true });
        expect(evaluate([dispatch], { 100: jobs() }, { headContainsBase: false }).reasons).toContain(ENGINEERING_HOLD.BASE_MISMATCH);
    });
    it('review-event runs are not engineering evidence', () => {
        expect(evaluate([run({ event: 'pull_request_review' })], { 100: jobs() }).reasons).toContain(ENGINEERING_HOLD.NO_RUN);
    });
});
