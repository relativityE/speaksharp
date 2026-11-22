"use strict";
// J8's live adapters, proven offline: a recording process runner stands in for pnpm, and a fake admin listing for the lookup.
// Nothing here starts a process, reads a credential or touches a live service.
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const live = require('../j8-live-adapters.cjs');

const RELEASE = 'e'.repeat(40);
const EXPECTATION = { requestSha256: 'a'.repeat(64), attemptSha256: 'b'.repeat(64), product: 'coaching', configuredModel: 'm', outcome: 'ok' };

/** A runner that answers from a queue of { status, stdout } and records every call; a sleep that records its waits. */
function harness(answers, extra = {}) {
    const calls = [];
    const waits = [];
    const run = (command, args, opts) => { calls.push({ command, args, env: opts.env, cwd: opts.cwd, timeout: opts.timeout }); return answers.shift() ?? { status: 1, stdout: '' }; };
    const adapters = live.j8LiveAdapters({ repoRoot: '/repo', baseEnv: { PATH: '/bin', INHERITED: 'x' }, run, sleep: async (ms) => { waits.push(ms); }, ...extra });
    return { adapters, calls, waits };
}
const evidenceLine = (o) => `noise\n${live.EVIDENCE_PREFIX}${JSON.stringify({ gate: 'TELEMETRY-READBACK-COMPLETENESS', release_sha: RELEASE, journey_id: 'journey-final-b',
    boot_id: 'boot-1', traffic_type: 'canary', stages_declared: ['share_feedback'], attempts_declared: [], ...o })}\n`;
const receiptLine = (o) => `noise\n${'COACHING_DIAGNOSTIC_RECEIPT '}${JSON.stringify(o)}\n`;
const qualifyArgs = (over = {}) => ({ journeyId: 'journey-final-b', stages: ['share_feedback'], attemptIds: [], firstDownload: false, release: RELEASE, ...over });

describe('J8 live adapters', () => {
    it('qualify runs the reviewed readback CLI per journey, canary, with the stages and attempts bound in env', async () => {
        const h = harness([{ status: 0, stdout: evidenceLine({ verdict: 'QUALIFIED', attempts_declared: ['att-1', 'att-2'] }) }]);
        const r = await h.adapters.qualify(qualifyArgs({ attemptIds: ['att-1', 'att-2'], firstDownload: true }));
        expect(r.status).toBe(0);
        expect(r.evidence).toEqual({ verdict: 'QUALIFIED', release_sha: RELEASE, journey_id: 'journey-final-b', boot_id: 'boot-1', traffic_type: 'canary',
            stages_declared: ['share_feedback'], attempts_declared: ['att-1', 'att-2'] });
        expect(h.calls.length).toBe(1);
        const c = h.calls[0];
        expect(c.command).toBe('pnpm');
        expect(c.args).toEqual(['-s', 'telemetry:readback-qualification', '--release-sha', RELEASE, '--journey-id', 'journey-final-b', '--traffic-type', 'canary']);
        expect(c.env.QUALIFICATION_STAGES).toBe('share_feedback');
        expect(c.env.QUALIFICATION_ATTEMPT_IDS).toBe('att-1,att-2');
        expect(c.env.TELEMETRY_READBACK_ACQUISITION_RECEIPT).toBe('1');
        expect(c.env.INHERITED).toBe('x');
        expect(c.cwd).toBe('/repo');
    });

    it('waits for ingestion once per run, then retries only non-final codes, with 3 a final FAIL', async () => {
        const h = harness([{ status: 1, stdout: '' }, { status: 1, stdout: '' }, { status: 0, stdout: '' }, { status: 3, stdout: '' }]);
        expect((await h.adapters.qualify(qualifyArgs())).status).toBe(0);
        expect((await h.adapters.qualify(qualifyArgs({ journeyId: 'journey-a' }))).status).toBe(3);
        expect(h.calls.length).toBe(4);
        expect(h.waits).toEqual([live.INGESTION_WAIT_MS, live.RETRY_WAIT_MS, live.RETRY_WAIT_MS]);
    });

    it('three non-final answers are a HOLD code, never retried past three, and a thrown or signalled run is not a pass', async () => {
        const h = harness([{ status: 2, stdout: '' }, { status: null, stdout: '' }, { status: 1, stdout: '' }]);
        const r = await h.adapters.qualify(qualifyArgs());
        expect(r.status === 0 || r.status === 3).toBe(false);
        expect(r.evidence).toBe(null);
        expect(h.calls.length).toBe(live.ATTEMPTS);
        const thrown = live.j8LiveAdapters({ run: () => { throw new Error('spawn'); }, sleep: async () => {} });
        expect(await thrown.qualify(qualifyArgs())).toEqual({ status: 1, evidence: null });
        // A run killed at its deadline is never final, even if it reported a code.
        const killed = harness([{ status: 0, stdout: evidenceLine({ verdict: 'QUALIFIED' }), timedOut: true }, { status: 2 }, { status: 2 }]);
        expect((await killed.adapters.qualify(qualifyArgs())).status).toBe(2);
        expect(killed.calls.every((c) => c.timeout === live.READBACK_TIMEOUT_MS)).toBe(true);
    });

    it('a malformed release, journey, stage or attempt is refused before any process starts', async () => {
        for (const bad of [{ release: 'abc' }, { release: RELEASE.toUpperCase() }, { journeyId: 'a b' }, { journeyId: '' }, { stages: [] },
            { stages: ['share feedback'] }, { stages: 'share_feedback' }, { attemptIds: ['x;y'] }, { attemptIds: null }]) {
            const h = harness([{ status: 0, stdout: '' }]);
            expect(await h.adapters.qualify(qualifyArgs(bad))).toEqual({ status: 1, evidence: null });
            expect(h.calls.length).toBe(0);
        }
    });

    it('the readback\'s own evidence is kept only when it is the one gate line and agrees with a final exit code', () => {
        expect(live.readbackEvidence(evidenceLine({ verdict: 'QUALIFIED' }), 0).verdict).toBe('QUALIFIED');
        expect(live.readbackEvidence(evidenceLine({ verdict: 'FAIL' }), 3).verdict).toBe('FAIL');
        expect(live.readbackEvidence(evidenceLine({ verdict: 'QUALIFIED' }), 3)).toBe(null);
        expect(live.readbackEvidence(evidenceLine({ verdict: 'HOLD' }), 1)).toBe(null);
        expect(live.readbackEvidence(evidenceLine({ verdict: 'QUALIFIED' }) + evidenceLine({ verdict: 'QUALIFIED' }), 0)).toBe(null);
        expect(live.readbackEvidence(evidenceLine({ verdict: 'QUALIFIED', gate: 'OTHER' }), 0)).toBe(null);
        expect(live.readbackEvidence('nothing', 0)).toBe(null);
        expect(live.readbackEvidence(`${live.EVIDENCE_PREFIX}{not json`, 0)).toBe(null);
    });

    it('coaching keeps only the CLI\'s own bound receipt whose verdict agrees with its exit code', async () => {
        const bound = { verdict: 'PASS', reasons: [], release: RELEASE, expected: EXPECTATION };
        const h = harness([{ status: 0, stdout: receiptLine(bound) }]);
        expect(await h.adapters.coaching({ journeyId: 'journey-final-b', expectation: EXPECTATION, release: RELEASE })).toEqual(bound);
        expect(h.calls[0].env.TELEMETRY_READBACK_COACHING_DIAGNOSTIC).toBe('1');
        expect(JSON.parse(h.calls[0].env.COACHING_DIAGNOSTIC_EXPECTATION)).toEqual(EXPECTATION);
        expect(h.calls[0].args.includes('journey-final-b')).toBe(true);
        expect(live.boundCoachingReceipt(receiptLine({ ...bound, verdict: 'FAIL' }), 3)).toEqual({ ...bound, verdict: 'FAIL' });
    });

    it('a coaching receipt that disagrees with its exit code, is missing, doubled, unbound or unparsable is null (an UNBOUND HOLD upstream)', async () => {
        const bound = { verdict: 'PASS', reasons: [], release: RELEASE, expected: EXPECTATION };
        expect(live.boundCoachingReceipt(receiptLine(bound), 3)).toBe(null);
        expect(live.boundCoachingReceipt(receiptLine(bound), 1)).toBe(null);
        expect(live.boundCoachingReceipt('nothing here', 0)).toBe(null);
        expect(live.boundCoachingReceipt(receiptLine(bound) + receiptLine(bound), 0)).toBe(null);
        expect(live.boundCoachingReceipt(receiptLine({ ...bound, release: undefined }), 0)).toBe(null);
        expect(live.boundCoachingReceipt(receiptLine({ ...bound, expected: null }), 0)).toBe(null);
        expect(live.boundCoachingReceipt(receiptLine({ ...bound, reasons: 'none' }), 0)).toBe(null);
        expect(live.boundCoachingReceipt('COACHING_DIAGNOSTIC_RECEIPT {not json', 0)).toBe(null);
        const h = harness([{ status: 0, stdout: receiptLine(bound) }]);
        expect(await h.adapters.coaching({ journeyId: 'journey-final-b', expectation: null, release: RELEASE })).toBe(null);
        expect(h.calls.length).toBe(0);
    });

    it('runSpec runs exactly the J8 live spec on the deployed-live project with the entry\'s admission env, and reports its exit code', async () => {
        const h = harness([{ status: 0, stdout: '' }, { status: 1, stdout: '' }, { status: null, stdout: '' }, { status: 0, stdout: '', timedOut: true }]);
        const env = { RWT_J8_RUNNER_ADMISSION: '/evidence/j8-admission.json', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '2' };
        expect(await h.adapters.runSpec({ env })).toEqual({ exitCode: 0, timedOut: false, admissionFile: '/evidence/j8-admission.json', runId: '1', runAttempt: '2' });
        const c = h.calls[0];
        expect(c.args).toEqual(['exec', 'playwright', 'test', live.SPEC, `--config=${live.LIVE_CONFIG}`, `--project=${live.LIVE_PROJECT}`, '--reporter=line']);
        expect(c.env.RWT_J8_RUNNER_ADMISSION).toBe('/evidence/j8-admission.json');
        expect(c.env.GITHUB_RUN_ATTEMPT).toBe('2');
        expect(c.env.VITE_USE_LIVE_DB).toBe('true');
        expect(c.timeout).toBe(live.SPEC_TIMEOUT_MS);
        expect((await h.adapters.runSpec({ env })).exitCode).toBe(1);
        expect((await h.adapters.runSpec({ env })).exitCode).toBe(null);
        expect(await h.adapters.runSpec({ env })).toEqual({ exitCode: null, timedOut: true, admissionFile: '/evidence/j8-admission.json', runId: '1', runAttempt: '2' });
        expect((await h.adapters.runSpec({})).exitCode).toBe(null);
        expect((await h.adapters.runSpec({ env: null })).exitCode).toBe(null);
        expect(h.calls.length).toBe(4);
    });

    it('the spec\'s admission env wins over an inherited value of the same name', async () => {
        const h = live.j8LiveAdapters({ baseEnv: { RWT_J8_RUNNER_ADMISSION: '/stale', GITHUB_RUN_ATTEMPT: '9' },
            run: (c, a, o) => { h.seen = o.env; return { status: 0 }; }, sleep: async () => {} });
        await h.runSpec({ env: { RWT_J8_RUNNER_ADMISSION: '/fresh', GITHUB_RUN_ATTEMPT: '1' } });
        expect(h.seen.RWT_J8_RUNNER_ADMISSION).toBe('/fresh');
        expect(h.seen.GITHUB_RUN_ATTEMPT).toBe('1');
    });

    it('lookup is the complete exact-email listing: zero only on a complete listing, and absent without an admin listing', async () => {
        const email = 'rwt-journey-feedback-boundary-1795300000000-1@tests.example.com';
        const page = (users) => async () => ({ data: { users }, error: null });
        const zero = live.j8LiveAdapters({ listUsers: page([{ id: 'u1', email: 'other@tests.example.com' }]), run: () => ({ status: 0 }), sleep: async () => {} });
        expect((await zero.lookup({ email, runOwnedPrefix: 'rwt-journey-' })).lookup).toBe('zero');
        const one = live.j8LiveAdapters({ listUsers: page([{ id: 'u2', email }]), run: () => ({ status: 0 }), sleep: async () => {} });
        expect((await one.lookup({ email, runOwnedPrefix: 'rwt-journey-' })).lookup).toBe('one');
        const failing = live.j8LiveAdapters({ listUsers: async () => ({ data: null, error: { message: 'x' } }), run: () => ({ status: 0 }), sleep: async () => {} });
        expect((await failing.lookup({ email, runOwnedPrefix: 'rwt-journey-' })).lookup).toBe('unreadable');
        expect(live.j8LiveAdapters({ run: () => ({ status: 0 }), sleep: async () => {} }).lookup).toBe(undefined);
    });

    it('a listing that never finishes is cut off at the lookup deadline and is unreadable, never zero', async () => {
        const email = 'rwt-journey-feedback-boundary-1795300000000-1@tests.example.com';
        const hung = live.j8LiveAdapters({ listUsers: () => new Promise(() => {}), lookupTimeoutMs: 30, run: () => ({ status: 0 }), sleep: async () => {} });
        expect((await hung.lookup({ email, runOwnedPrefix: 'rwt-journey-' })).lookup).toBe('unreadable');
        const threw = live.j8LiveAdapters({ listUsers: () => { throw new Error('x'); }, run: () => ({ status: 0 }), sleep: async () => {} });
        expect((await threw.lookup({ email, runOwnedPrefix: 'rwt-journey-' })).lookup).toBe('unreadable');
    });

    it('the process runner kills a process at its deadline and reports no exit code', async () => {
        const run = live.spawnRunner();
        const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { env: process.env, cwd: __dirname, timeout: 200 });
        expect({ status: r.status, timedOut: r.timedOut }).toEqual({ status: null, timedOut: true });
        const ok = await run(process.execPath, ['-e', 'console.log("hi"); process.exit(3)'], { env: process.env, cwd: __dirname, timeout: 10_000 });
        expect({ status: ok.status, timedOut: ok.timedOut, out: ok.stdout.trim() }).toEqual({ status: 3, timedOut: false, out: 'hi' });
    });
});
