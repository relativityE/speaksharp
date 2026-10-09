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

describe('review trigger (review-event.yml): marks review activity and can be trusted with nothing', () => {
    const ev = load('review-event.yml');
    const steps = Object.values(ev.jobs).flatMap((j) => j.steps ?? []);
    it('is the "Review Event" workflow the review lane listens to, on review and inline-comment activity', () => {
        expect(ev.name).toBe('Review Event');
        expect(Object.keys(ev.on).sort()).toEqual([...REVIEW_EVENTS].sort());
    });
    it('has no permissions, no checkout, no action and no secret — only a no-op step', () => {
        expect(ev.permissions).toEqual({});
        expect(steps.some((s) => s.uses)).toBe(false);
        expect(steps.map((s) => s.run)).toEqual(['echo "review activity recorded"']);
        expect(JSON.stringify(ev)).not.toMatch(/secrets\.|github\.token|GITHUB_TOKEN/);
    });
});

describe('review lane (review-qualification.yml): cheap, isolated, read-only', () => {
    const wf = load('review-qualification.yml');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
    const runText = steps.map((s) => String(s.run ?? '')).join('\n');
    it('runs on engineering completion and review activity (`workflow_run`) and on Codex result comments (`issue_comment`)', () => {
        expect(Object.keys(wf.on)).toEqual(['workflow_run', 'issue_comment']);
        expect(wf.on.issue_comment.types).toEqual(['created', 'edited']);
        expect(wf.on.workflow_run.workflows).toEqual(['CI - Test Audit', 'Review Event']);
        expect(wf.on.workflow_run.types).toEqual(['completed']);
    });
    // Codex P1 4233038867: review events run the workflow FILE from the PR merge commit, so a candidate could rewrite a
    // review-triggered qualification and fabricate its result. `workflow_run` definitions always come from the default branch.
    it('CASUALTY (Codex P1 4233038867): never subscribes to a PR-controlled event; the PR and head come from the workflow_run', () => {
        // `issue_comment`, like `workflow_run`, always runs the default-branch definition, so it is not PR-controlled.
        const prControlled = ['pull_request', 'pull_request_target', ...REVIEW_EVENTS];
        expect(Object.keys(wf.on).filter((e) => prControlled.includes(e))).toEqual([]);
        const env = Object.values(wf.jobs)[0].env;
        expect(env.PR_NUMBER).toBe('${{ github.event.workflow_run.pull_requests[0].number || github.event.issue.number }}');
        expect(env.EXPECTED_HEAD_SHA).toBe('${{ github.event.workflow_run.head_sha }}');
    });
    // Codex P1 4233588262: a clean Codex result is a top-level PR comment; only the bot's comments on a PR start the job, and
    // the head it qualifies is the PR's LIVE head from the API, never a value carried by the comment.
    it('CASUALTY (Codex P1 4233588262): a Codex result comment re-qualifies the live head; other comments start nothing', () => {
        const job = Object.values(wf.jobs)[0];
        expect(job.if).toMatch(/github\.event\.issue\.pull_request/);
        expect(job.if).toMatch(/github\.event\.comment\.user\.login == 'chatgpt-codex-connector\[bot\]'/);
        expect(job.env.PR_NUMBER).toContain('github.event.issue.number');
        const resolve = job.steps.find((s) => s.name === 'Resolve the live head for a Codex result comment');
        expect(resolve?.if).toBe("${{ github.event_name == 'issue_comment' }}");
        expect(resolve?.run).toMatch(/gh api "repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}" --jq \.head\.sha/);
        expect(JSON.stringify(job.steps)).not.toMatch(/github\.event\.comment\.body/);
        expect(JSON.stringify(wf)).not.toMatch(/github\.event\.pull_request\./);
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
    it('CASUALTY (Codex P1 4224002123): runs TRUSTED default-branch scripts, never the candidate\'s, and keeps no credentials', () => {
        // Review events check out the PR merge ref by default, so a fork/untrusted PR could rewrite the qualification scripts
        // to fabricate a receipt. The live PR head is still read through the API; only the code that judges it is trusted.
        const checkout = steps.find((s) => String(s.uses ?? '').startsWith('actions/checkout@'));
        expect(checkout?.with?.ref).toBe('${{ github.event.repository.default_branch }}');
        expect(checkout?.with?.['persist-credentials']).toBe(false);
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
        pr: 1573, liveHeadSha: HEAD, liveBaseSha: BASE, expectedHeadSha: HEAD, runs, jobsByRun, headContainsBase: true, workflowUnchanged: true, ...extra,
    });

    // Codex Security P2 4233624706: a PR runs its own ci.yml, so same-named no-op jobs would pass a name-only check.
    it('CASUALTY (Codex P2 4233624706): a head whose ci.yml differs from the base holds, however green its jobs', () => {
        expect([evaluate([run()], { 100: jobs() }, { workflowUnchanged: false }).reasons,
            evaluate([run()], { 100: jobs() }, { workflowUnchanged: undefined }).reasons])
            .toEqual([[ENGINEERING_HOLD.WORKFLOW_MODIFIED], [ENGINEERING_HOLD.WORKFLOW_MODIFIED]]);
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
