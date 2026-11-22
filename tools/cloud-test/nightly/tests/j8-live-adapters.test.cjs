"use strict";
// J8's live adapters, proven offline: a recording process runner stands in for pnpm, and a fake admin listing for the lookup.
// Nothing here starts a process, reads a credential or touches a live service.
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const fs = require('node:fs');
const path = require('node:path');
const live = require('../j8-live-adapters.cjs');

const RELEASE = 'e'.repeat(40);
const EXPECTATION = { requestSha256: 'a'.repeat(64), attemptSha256: 'b'.repeat(64), product: 'coaching', configuredModel: 'm', outcome: 'ok' };

/** A runner that answers from a queue of { status, stdout } (drained unless an answer says otherwise) and records every call; a sleep that records its waits. */
function harness(answers, extra = {}) {
    const calls = [];
    const waits = [];
    const run = (command, args, opts) => { calls.push({ command, args, env: opts.env, cwd: opts.cwd, timeout: opts.timeout }); return { drained: true, ...(answers.shift() ?? { status: 1, stdout: '' }) }; };
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
        // A journey that is not a first download asks for no acquisition receipt (J8's legs never download the model).
        expect(h.calls.every((c) => c.env.TELEMETRY_READBACK_ACQUISITION_RECEIPT === '0')).toBe(true);
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

    const LISTED = (title = live.J8_TEST, describe = live.J8_DESCRIBE, file = 'live/rwt-feedback-association-boundaries.live.spec.ts') =>
        `Listing tests:\n  [deployed-live-chromium] › ${file}:753:5 › ${describe} › ${title}\nTotal: 1 test in 1 file\n`;
    const LIST_OK = { status: 0, stdout: LISTED(), drained: true };
    it('runSpec lists the selector first, then runs exactly the J8 test of the J8 spec on the deployed-live project, and reports its exit code', async () => {
        const h = harness([LIST_OK, { status: 0, stdout: '' }, LIST_OK, { status: 1, stdout: '' }, LIST_OK, { status: null, stdout: '' }, LIST_OK, { status: 0, stdout: '', timedOut: true }]);
        const env = { RWT_J8_RUNNER_ADMISSION: '/evidence/j8-admission.json', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '2' };
        expect(await h.adapters.runSpec({ env })).toEqual({ exitCode: 0, timedOut: false, drained: true, admissionFile: '/evidence/j8-admission.json', runId: '1', runAttempt: '2' });
        const selector = ['exec', 'playwright', 'test', live.SPEC, `--config=${live.LIVE_CONFIG}`, `--project=${live.LIVE_PROJECT}`, `--grep=${live.SPEC_GREP}`];
        expect(h.calls[0].args).toEqual([...selector, '--list']);
        expect(h.calls[0].timeout).toBe(live.LIST_TIMEOUT_MS);
        const c = h.calls[1];
        expect(c.args).toEqual([...selector, '--reporter=line']);
        expect(live.SPEC).toBe('tests/live/rwt-feedback-association-boundaries.live.spec.ts');
        // Sam on 27ee1856: the exact combined title, anchored at its end, so the two legacy tests in the file are never selected.
        expect(live.SPEC_GREP).toBe('RWT — Share Feedback association boundaries @live J8: one account — No session before any take, older-take feedback, No session with both takes listed$');
        expect(c.env.RWT_J8_RUNNER_ADMISSION).toBe('/evidence/j8-admission.json');
        expect(c.env.GITHUB_RUN_ATTEMPT).toBe('2');
        expect(c.env.VITE_USE_LIVE_DB).toBe('true');
        expect(c.timeout).toBe(live.SPEC_TIMEOUT_MS);
        expect((await h.adapters.runSpec({ env })).exitCode).toBe(1);
        expect((await h.adapters.runSpec({ env })).exitCode).toBe(null);
        expect(await h.adapters.runSpec({ env })).toEqual({ exitCode: null, timedOut: true, drained: true, admissionFile: '/evidence/j8-admission.json', runId: '1', runAttempt: '2' });
        expect((await h.adapters.runSpec({})).exitCode).toBe(null);
        expect((await h.adapters.runSpec({ env: null })).exitCode).toBe(null);
        expect(h.calls.length).toBe(8);
    });

    it('a spec whose process tree is not confirmed stopped says so, and an undrained list runs nothing (Sam on 65365f36)', async () => {
        const env = { RWT_J8_RUNNER_ADMISSION: '/evidence/j8-admission.json', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '2' };
        const h = harness([LIST_OK, { status: 0, stdout: '', drained: false }]);
        expect(await h.adapters.runSpec({ env })).toEqual({ exitCode: 0, timedOut: false, drained: false, admissionFile: '/evidence/j8-admission.json', runId: '1', runAttempt: '2' });
        const l = harness([{ ...LIST_OK, drained: false }, { status: 0, stdout: '' }]);
        const out = await l.adapters.runSpec({ env });
        expect({ exitCode: out.exitCode, drained: out.drained, calls: l.calls.map((x) => x.args.at(-1)) }).toEqual({ exitCode: null, drained: false, calls: ['--list'] });
        // The list, the spec and both drains end inside the entry's spec deadline, so the entry never moves on while they run.
        const entry = require('../j8-nightly-entry.cjs');
        expect(live.LIST_TIMEOUT_MS + live.SPEC_TIMEOUT_MS + 2 * live.DRAIN_TIMEOUT_MS < entry.DEADLINES.specMs).toBe(true);
    });

    it('a listing that is not exactly the J8 test runs nothing: two or three tests, another test, another file, a failed or killed list', async () => {
        const env = { RWT_J8_RUNNER_ADMISSION: '/evidence/j8-admission.json', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '2' };
        const all3 = 'Listing tests:\n'
            + `  [deployed-live-chromium] › live/rwt-feedback-association-boundaries.live.spec.ts:587:5 › ${live.J8_DESCRIBE} › feedback selected for an older take links only to that take\n`
            + `  [deployed-live-chromium] › live/rwt-feedback-association-boundaries.live.spec.ts:753:5 › ${live.J8_DESCRIBE} › ${live.J8_TEST}\n`
            + `  [deployed-live-chromium] › live/rwt-feedback-association-boundaries.live.spec.ts:994:5 › ${live.J8_DESCRIBE} › No session feedback stores no take or coaching link\n`
            + 'Total: 3 tests in 1 file\n';
        const cases = {
            'the whole file': { status: 0, stdout: all3 },
            'a legacy test': { status: 0, stdout: LISTED('No session feedback stores no take or coaching link') },
            'the J8 test and a legacy test, whatever the total says': { status: 0, stdout: LISTED().replace('Total:',
                `  [deployed-live-chromium] › live/rwt-feedback-association-boundaries.live.spec.ts:994:5 › ${live.J8_DESCRIBE} › No session feedback stores no take or coaching link\nTotal:`) },
            'another describe': { status: 0, stdout: LISTED(live.J8_TEST, 'Another describe') },
            'another file': { status: 0, stdout: LISTED(live.J8_TEST, live.J8_DESCRIBE, 'live/rwt-open-mic-first-session.live.spec.ts') },
            'no total line': { status: 0, stdout: LISTED().replace('Total: 1 test in 1 file\n', '') },
            'nothing listed': { status: 0, stdout: 'Listing tests:\nTotal: 0 tests in 0 files\n' },
            'the list failed': { status: 1, stdout: LISTED() },
            'the list was killed': { status: 0, stdout: LISTED(), timedOut: true },
            'the list\'s processes were not confirmed stopped': { status: 0, stdout: LISTED(), drained: false },
        };
        for (const [name, listed] of Object.entries(cases)) {
            const h = harness([listed, { status: 0, stdout: '' }]);
            const out = await h.adapters.runSpec({ env });
            expect({ name, exitCode: out.exitCode, calls: h.calls.map((x) => x.args.at(-1)) }).toEqual({ name, exitCode: null, calls: ['--list'] });
        }
        const thrown = live.j8LiveAdapters({ repoRoot: '/repo', baseEnv: {}, run: () => { throw new Error('spawn'); }, sleep: async () => {} });
        expect((await thrown.runSpec({ env })).exitCode).toBe(null);
    });

    it('the pinned title is the J8 test\'s own describe and title in the spec source', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', live.SPEC), 'utf8');
        expect(src.includes(`test.describe('${live.J8_DESCRIBE}', () => {`)).toBe(true);
        expect(src.includes(`test('${live.J8_TEST}', async`)).toBe(true);
        expect(live.listsOnlyJ8(LISTED())).toBe(true);
    });

    it('the spec\'s admission env wins over an inherited value of the same name', async () => {
        const h = live.j8LiveAdapters({ baseEnv: { RWT_J8_RUNNER_ADMISSION: '/stale', GITHUB_RUN_ATTEMPT: '9' },
            run: (c, a, o) => { h.seen = o.env; return a.includes('--list') ? LIST_OK : { status: 0 }; }, sleep: async () => {} });
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
        expect({ status: r.status, timedOut: r.timedOut, drained: r.drained }).toEqual({ status: null, timedOut: true, drained: true });
        const ok = await run(process.execPath, ['-e', 'console.log("hi"); process.exit(3)'], { env: process.env, cwd: __dirname, timeout: 10_000 });
        expect({ status: ok.status, timedOut: ok.timedOut, out: ok.stdout.trim(), drained: ok.drained }).toEqual({ status: 3, timedOut: false, out: 'hi', drained: true });
    });

    // Sam on 65365f36: a browser that Playwright starts sits in a process group of its own, so killing the child (or its group)
    // alone would leave it running. The runner resolves only once nothing carrying its tag is left, whether the child exits or is killed.
    const gone = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return / Z /.test(st.slice(st.lastIndexOf(')'))); } catch { return true; } };
    const grandchildScript = (pidFile, then) => `const { spawn } = require('node:child_process');
        const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); g.unref(); ${then}`;
    it('the process runner drains a grandchild in its own process group when the child is killed at its deadline', async () => {
        const pidFile = path.join(require('node:os').tmpdir(), `j8-drain-${process.pid}-a`);
        const r = await live.spawnRunner()(process.execPath, ['-e', grandchildScript(pidFile, 'setInterval(() => {}, 1000);')], { env: process.env, cwd: __dirname, timeout: 1500 });
        const pid = Number(fs.readFileSync(pidFile, 'utf8'));
        fs.rmSync(pidFile, { force: true });
        expect({ timedOut: r.timedOut, drained: r.drained, grandchildGone: gone(pid) }).toEqual({ timedOut: true, drained: true, grandchildGone: true });
    });
    it('the process runner drains a grandchild left running after the child exits on its own', async () => {
        const pidFile = path.join(require('node:os').tmpdir(), `j8-drain-${process.pid}-b`);
        const r = await live.spawnRunner()(process.execPath, ['-e', grandchildScript(pidFile, 'process.exit(0);')], { env: process.env, cwd: __dirname, timeout: 10_000 });
        const pid = Number(fs.readFileSync(pidFile, 'utf8'));
        fs.rmSync(pidFile, { force: true });
        expect({ status: r.status, drained: r.drained, grandchildGone: gone(pid) }).toEqual({ status: 0, drained: true, grandchildGone: true });
    });
    it('the drain is true only once a scan finds nothing; unreadable /proc or a process that outlives the window is false', async () => {
        let t = 0;
        const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
        const killed = [];
        let scans = 0;
        expect(await live.drainTagged('tag', { list: () => (scans++ < 2 ? [11, 12] : []), kill: (pid) => killed.push(pid), ...clock })).toBe(true);
        expect(killed).toEqual([11, 12, 11, 12]);
        expect(await live.drainTagged('tag', { list: () => null, kill: () => {}, ...clock })).toBe(false);
        t = 0;
        expect(await live.drainTagged('tag', { list: () => [13], kill: () => {}, timeoutMs: 1000, ...clock })).toBe(false);
        expect(await live.drainTagged('', { list: () => [], kill: () => {}, ...clock })).toBe(false);
        // A kill that throws (already gone) is not a failure; the next scan decides.
        let n = 0;
        expect(await live.drainTagged('tag', { list: () => (n++ ? [] : [14]), kill: () => { throw new Error('ESRCH'); }, ...clock })).toBe(true);
        // The scan matches the exact tag entry only, never a prefix or another variable.
        const procFs = { readdirSync: () => ['1', '2', '3', '4', 'self'], readFileSync: (f) => ({ '/proc/1/environ': `A=b\0${live.PROC_TAG_ENV}=tag\0`,
            '/proc/2/environ': `${live.PROC_TAG_ENV}=tag2\0`, '/proc/3/environ': `X${live.PROC_TAG_ENV}=tag\0` })[f] ?? (() => { throw new Error('EACCES'); })() };
        expect(live.taggedPids('tag', { procFs, selfPid: 99 })).toEqual([1]);
        expect(live.taggedPids('tag', { procFs: { readdirSync: () => { throw new Error('no /proc'); } } })).toBe(null);
    });
    describe('the parent recovery\'s calls (Sam on 27ee1856, route (b))', () => {
        const BINDING = { repository: 'o/r', workflow: 'o/r/.github/workflows/n.yml@refs/heads/main', runId: '7', runAttempt: '1', role: 'rwt-journey' };
        const VERDICT = 'RUN_OWNED_CLEANUP cleanup_verified residue=0 tables_verified=25';
        function admin({ user = { email: 'rwt-journey-a@t.example.com', created_at: '2026-11-22T00:00:00Z', app_metadata: { ct_run: BINDING } }, getError = null, count = 0, countError = null, journal = 0 } = {}) {
            const asked = [];
            return {
                asked,
                auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }),
                    getUserById: async () => (getError ? { data: { user: null }, error: getError } : { data: { user }, error: null }) } },
                from: (table) => ({ select: (column, opts) => ({ eq: async (c, v) => { asked.push({ table, column, opts, c, v }); return { count, error: countError }; } }) }),
                rpc: async (fn, a) => { asked.push({ fn, a }); return { data: journal, error: null }; },
            };
        }
        it('are built only over an admin client; the account is read with its email, creation time and run binding', async () => {
            expect(['readAccount', 'readResidue', 'scopedDelete'].map((k) => typeof harness([]).adapters[k])).toEqual(['undefined', 'undefined', 'undefined']);
            const { adapters } = harness([], { admin: admin() });
            expect(await adapters.readAccount('u1')).toEqual({ email: 'rwt-journey-a@t.example.com', createdAt: '2026-11-22T00:00:00Z', ctRun: BINDING });
            expect(await harness([], { admin: admin({ getError: { status: 500, message: 'x' } }) }).adapters.readAccount('u1')).toBe(null);
            expect(typeof harness([], { admin: admin() }).adapters.lookup).toBe('function');
        });
        it('reads each store as an observed count: the account by a not-found re-read, the save journal by its count function, the rest by head count', async () => {
            const gone = harness([], { admin: admin({ getError: { status: 404, code: 'user_not_found', message: 'User not found' } }) }).adapters;
            expect(await gone.readResidue({ store: 'auth:account', uid: 'u1' })).toBe(0);
            expect(await harness([], { admin: admin() }).adapters.readResidue({ store: 'auth:account', uid: 'u1' })).toBe(1);
            expect(await harness([], { admin: admin({ getError: { status: 500, message: 'down' } }) }).adapters.readResidue({ store: 'auth:account', uid: 'u1' })).toBe(null);
            const a = admin({ count: 0, journal: 0 });
            const r = harness([], { admin: a }).adapters;
            expect(await r.readResidue({ store: 'sessions:user_id', table: 'sessions', column: 'user_id', key: 'owner', uid: 'u1', email: 'X@Y.Z' })).toBe(0);
            expect(await r.readResidue({ store: 'trial_entitlements:email', table: 'trial_entitlements', column: 'email', key: 'email', uid: 'u1', email: 'X@Y.Z' })).toBe(0);
            expect(await r.readResidue({ store: 'account_save_obligations:user_id', table: 'account_save_obligations', column: 'user_id', key: 'owner', uid: 'u1' })).toBe(0);
            expect(a.asked).toEqual([{ table: 'sessions', column: 'user_id', opts: { count: 'exact', head: true }, c: 'user_id', v: 'u1' },
                { table: 'trial_entitlements', column: 'email', opts: { count: 'exact', head: true }, c: 'email', v: 'x@y.z' },
                { fn: 'count_account_save_journal_v1', a: { p_user_id: 'u1' } }]);
            for (const bad of [admin({ countError: { message: 'x' } }), admin({ count: null }), admin({ count: -1 })])
                expect(await harness([], { admin: bad }).adapters.readResidue({ store: 's:c', table: 's', column: 'c', key: 'owner', uid: 'u1' })).toBe(null);
            expect(await harness([], { admin: admin({ journal: 'x' }) }).adapters.readResidue({ store: 'j', table: 'account_save_obligations', uid: 'u1' })).toBe(null);
            expect(await r.readResidue({ store: 's:c', table: 's', column: 'c', key: 'neither', uid: 'u1' })).toBe(null);
        });
        it('the scoped delete runs the delete script bound to the checked run, and counts only on exit 0 with exactly one verified line', async () => {
            const ok = harness([{ status: 0, stdout: `noise\n${VERDICT}\n` }], { admin: admin(), clock: () => 1_000 });
            const TEN_MIN = 10 * 60_000;
            expect(await ok.adapters.scopedDelete({ uid: 'u1', email: 'rwt-journey-a@t.example.com', binding: BINDING, timeoutMs: TEN_MIN })).toEqual({ deleted: true, drained: true });
            expect(ok.calls.length).toBe(1);
            expect({ cmd: ok.calls[0].command, script: ok.calls[0].args, timeout: ok.calls[0].timeout }).toEqual({ cmd: '/repo/node_modules/.bin/tsx', script: ['/repo/scripts/rwt-j8-parent-delete.mts'], timeout: 5 * 60_000 });
            const env = ok.calls[0].env;
            expect([env.RWT_J8_DELETE_UID, env.RWT_J8_DELETE_EMAIL, env.GITHUB_REPOSITORY, env.GITHUB_WORKFLOW_REF, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.INHERITED, env.RWT_J8_DELETE_DEADLINE_AT])
                .toEqual(['u1', 'rwt-journey-a@t.example.com', BINDING.repository, BINDING.workflow, '7', '1', 'x', String(1_000 + 5 * 60_000)]);
            // Sam on 65365f36: with less of the cleanup budget left, the delete is killed early enough for the kill and the drain to end
            // inside it, and is told that deadline; with no room for the drain, it never starts.
            const short = harness([{ status: 0, stdout: `${VERDICT}\n` }], { admin: admin(), clock: () => 1_000 });
            await short.adapters.scopedDelete({ uid: 'u1', email: 'rwt-journey-a@t.example.com', binding: BINDING, timeoutMs: 2 * 60_000 });
            expect({ timeout: short.calls[0].timeout, deadline: short.calls[0].env.RWT_J8_DELETE_DEADLINE_AT })
                .toEqual({ timeout: 2 * 60_000 - live.DRAIN_TIMEOUT_MS, deadline: String(1_000 + 2 * 60_000 - live.DRAIN_TIMEOUT_MS) });
            for (const timeoutMs of [undefined, 0, -1, live.DRAIN_TIMEOUT_MS, Number.NaN]) {
                const none = harness([{ status: 0, stdout: `${VERDICT}\n` }], { admin: admin() });
                expect({ timeoutMs, r: await none.adapters.scopedDelete({ uid: 'u1', email: 'rwt-journey-a@t.example.com', binding: BINDING, timeoutMs }), calls: none.calls.length })
                    .toEqual({ timeoutMs, r: { deleted: false, drained: true }, calls: 0 });
            }
            const refused = {
                'exit 1': { status: 1, stdout: `${VERDICT}\n` }, 'no verdict line': { status: 0, stdout: 'done\n' },
                'two verdict lines': { status: 0, stdout: `${VERDICT}\n${VERDICT}\n` }, 'not-required verdict': { status: 0, stdout: 'RUN_OWNED_CLEANUP cleanup_not_required residue=0 tables_verified=0\n' },
                'killed at its deadline': { status: null, stdout: `${VERDICT}\n`, timedOut: true },
                'a verified line, but its processes were not confirmed stopped': { status: 0, stdout: `${VERDICT}\n`, drained: false },
            };
            for (const [name, answer] of Object.entries(refused)) {
                const h = harness([answer], { admin: admin() });
                expect({ name, r: await h.adapters.scopedDelete({ uid: 'u1', email: 'rwt-journey-a@t.example.com', binding: BINDING, timeoutMs: TEN_MIN }) })
                    .toEqual({ name, r: { deleted: false, drained: answer.drained !== false } });
            }
            // The delete script's own refusal past its deadline is proven in tests/unit/rwtJ8ParentDelete.test.ts (it needs tsx).
            // Missing identity or a partial binding never starts the process.
            for (const q of [{ email: 'e', binding: BINDING }, { uid: 'u1', binding: BINDING }, { uid: 'u1', email: 'e' }, { uid: 'u1', email: 'e', binding: { ...BINDING, runAttempt: '' } }]) {
                const h = harness([], { admin: admin() });
                expect(await h.adapters.scopedDelete({ ...q, timeoutMs: TEN_MIN })).toEqual({ deleted: false, drained: true });
                expect(h.calls.length).toBe(0);
            }
        });
    });
});
