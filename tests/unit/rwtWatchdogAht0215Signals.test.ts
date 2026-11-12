// @vitest-environment node
/**
 * AHT-02..15 run on 2026-11-12 (served release 5ffbbb93). The fail-early watchdog stopped AHT-04, 05, 06, 12, 13 and 14 on
 * the fault each scenario injects on purpose. Every signal below is the exact `RWT_FAIL_EARLY` line those runs logged. Each
 * allowance is paired with the nearby signal it must NOT excuse (Sam's review: unrelated errors and stale presentations).
 */
import { describe, expect, it } from 'vitest';
import { JourneyWatchdog, fatalSignalOf, presentedFailureOf, watchProfileFor, type StateRecord, type WatchProfile } from '../live/helpers/rwtWatchdog';

const ev = (event: string, watch: Record<string, string> = {}) => ({ event, watch, at: Date.now() });
const state = (from: string, to: string, failure_code?: string) =>
    ev('recording_state', { from_state: from, to_state: to, ...(failure_code ? { failure_code } : {}) });
const acq = (error_code?: string) => ev('private_model_acquisition_failure', error_code ? { error_code } : {});
const STRICT: WatchProfile = {};

describe('AHT-04 pending-start-navigation: only the leave\'s own abort', () => {
    const p = watchProfileFor('pending-start-navigation');
    it('an `aborted` acquisition failure after the navigation intent is the scenario', () => {
        expect(fatalSignalOf(acq('aborted'), p, false, { navigationAbortOpen: true })).toBeNull();
    });
    it('NEGATIVE: an unrelated acquisition error after the intent stays fatal', () => {
        for (const code of ['network', 'integrity', 'storage', 'timeout', 'unsupported', 'unknown']) {
            expect(fatalSignalOf(acq(code), p, false, { navigationAbortOpen: true })).toBe('model_failed');
        }
        expect(fatalSignalOf(acq(), p, false, { navigationAbortOpen: true })).toBe('model_failed');
    });
    it('NEGATIVE: an abort with no navigation intent (or after the one abort was claimed) stays fatal', () => {
        expect(fatalSignalOf(acq('aborted'), p)).toBe('model_failed');
        expect(fatalSignalOf(acq('aborted'), p, false, { navigationAbortOpen: false })).toBe('model_failed');
    });
    it('NEGATIVE: the allowance never excuses a failed Start or a FAILED transition', () => {
        expect(fatalSignalOf(ev('recording_start_failed', { runtime_state: 'INITIATING' }), p, false, { navigationAbortOpen: true })).toBe('start_failed');
        expect(fatalSignalOf(ev('session_start_latency_measured', { outcome: 'failed' }), p, false, { navigationAbortOpen: true })).toBe('start_failed');
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED', 'other'), p, false, { navigationAbortOpen: true })).toBe('recording_failed');
    });
    it('NEGATIVE: AHT-02 (focus-points-session) keeps any model failure fatal, abort included', () => {
        expect(fatalSignalOf(acq('aborted'), watchProfileFor('focus-points-session'), false, { navigationAbortOpen: true })).toBe('model_failed');
    });
});

describe('AHT-12 mic denied', () => {
    const p = watchProfileFor('adverse-mic-model-mic-denied');
    it('the denied Start (run 43156420645: ENGINE_INITIALIZING -> FAILED start_did_not_record) is the scenario', () => {
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED', 'start_did_not_record'), p, true)).toBeNull();
    });
    it('NEGATIVE: a recording during the denial still trips, and the code stays fatal for every other suite', () => {
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'RECORDING'), p, true)).toBe('recording_while_forbidden');
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED', 'start_did_not_record'), watchProfileFor('open-mic-first-session'))).toBe('recording_failed');
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED', 'other'), p)).toBe('recording_failed');
    });
});

describe('AHT-13 model download fails', () => {
    const p = watchProfileFor('adverse-mic-model-download-fails');
    it('the failed download (run 43156423671: ENGINE_INITIALIZING -> FAILED other) is the scenario', () => {
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED', 'other'), p)).toBeNull();
    });
    it('NEGATIVE: `other` out of any state but engine preparation stays fatal', () => {
        for (const from of ['RECORDING', 'STOPPING', 'INITIATING', 'READY']) {
            expect(fatalSignalOf(state(from, 'FAILED', 'other'), p)).toBe('recording_failed');
        }
        // No code at all is not `other`.
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED'), p)).toBe('recording_failed');
    });
});

describe('AHT-14 offline mid-download: NOT widened', () => {
    it('run 43156426616 (RECORDING -> FAILED session_save_failed) stays fatal: the fault landed after the download, on a recording', () => {
        expect(fatalSignalOf(state('RECORDING', 'FAILED', 'session_save_failed'), watchProfileFor('adverse-mic-model-offline-mid-download'))).toBe('recording_failed');
    });
    it('a mid-download failure out of engine preparation is the scenario', () => {
        expect(fatalSignalOf(state('ENGINE_INITIALIZING', 'FAILED', 'other'), watchProfileFor('adverse-mic-model-offline-mid-download'))).toBeNull();
    });
});

describe('AHT-05/06 save-retry: judging a code-less FAILED_VISIBLE as the failure it presents', () => {
    const p = watchProfileFor('save-retry-recovery-request-lost');
    const visible = state('FAILED', 'FAILED_VISIBLE');
    const injected = { from_state: 'STOPPING', to_state: 'FAILED', failure_code: 'session_save_failed' };
    it('presenting the injected save failure is the scenario', () => {
        expect(fatalSignalOf(visible, p, false, { presentedFailure: injected })).toBeNull();
    });
    it('NEGATIVE: unbound, it trips', () => {
        expect(fatalSignalOf(visible, p)).toBe('recording_failed');
    });
    it('NEGATIVE: presenting an unrelated failure trips', () => {
        expect(fatalSignalOf(visible, p, false, { presentedFailure: { ...injected, failure_code: 'engine_error' } })).toBe('recording_failed');
    });
    it('NEGATIVE: after Retry Save (strict profile) the same presentation trips', () => {
        expect(fatalSignalOf(visible, STRICT, false, { presentedFailure: injected })).toBe('recording_failed');
    });
    it('a FAILED_VISIBLE that carries its own code is judged by that code, never by an earlier one', () => {
        expect(fatalSignalOf(state('FAILED', 'FAILED_VISIBLE', 'engine_error'), p, false, { presentedFailure: injected })).toBe('recording_failed');
    });
});

describe('presentedFailureOf: the IMMEDIATELY preceding same-attempt transition, by capture order', () => {
    const rec = (capturedAt: number, from: string, to: string, code?: string, batch = 1, batchIndex = 0): StateRecord =>
        ({ capturedAt, batch, batchIndex, fields: { from_state: from, to_state: to, ...(code ? { failure_code: code } : {}) } });
    const failed = rec(100, 'STOPPING', 'FAILED', 'session_save_failed');
    const vis = rec(200, 'FAILED', 'FAILED_VISIBLE');

    it('binds to the FAILED right before it', () => {
        expect(presentedFailureOf(vis, [rec(10, 'READY', 'RECORDING'), rec(50, 'RECORDING', 'STOPPING'), failed])).toBe(failed.fields);
    });
    it('binds by capture order, not arrival order (an earlier-captured record arriving later changes nothing)', () => {
        expect(presentedFailureOf(vis, [failed, rec(50, 'RECORDING', 'STOPPING')])).toBe(failed.fields);
    });
    it('same millisecond, same request: the body order decides', () => {
        const f = rec(200, 'STOPPING', 'FAILED', 'session_save_failed', 7, 0);
        expect(presentedFailureOf(rec(200, 'FAILED', 'FAILED_VISIBLE', undefined, 7, 1), [f])).toBe(f.fields);
    });
    it('NEGATIVE (stale): a later transition between the FAILED and the presentation unbinds it', () => {
        expect(presentedFailureOf(vis, [failed, rec(150, 'FAILED', 'READY')])).toBeUndefined();
        expect(presentedFailureOf(vis, [failed, rec(150, 'READY', 'RECORDING'), rec(160, 'RECORDING', 'FAILED', 'engine_error')]))
            .toEqual({ from_state: 'RECORDING', to_state: 'FAILED', failure_code: 'engine_error' });
    });
    it('NEGATIVE (out of order): a record with no proven order against the presentation unbinds it', () => {
        expect(presentedFailureOf(vis, [failed, rec(200, 'X', 'Y', undefined, 9, 0)])).toBeUndefined();
    });
    it('NEGATIVE: a tie at the top, or nothing before it, is unbound', () => {
        expect(presentedFailureOf(vis, [failed, rec(100, 'STOPPING', 'FAILED', 'session_save_failed', 2, 0)])).toBeUndefined();
        expect(presentedFailureOf(vis, [])).toBeUndefined();
        expect(presentedFailureOf(vis, [rec(300, 'STOPPING', 'FAILED', 'session_save_failed')])).toBeUndefined();
    });
});

describe('JourneyWatchdog: attempt binding and the one navigation abort, end to end', () => {
    const harness = () => {
        const page = { context: () => ({ close: async () => undefined }), evaluate: async () => null };
        return { page, tap: { events: [] as object[] } };
    };
    let batch = 100;
    const sent = (page: object, o: { boot?: string; attempt?: string | null; capturedAt?: number; batch?: number; batchIndex?: number }, e: ReturnType<typeof ev>) => {
        const capturedAt = o.capturedAt ?? e.at;
        const stamped = Object.assign(e, { bootId: o.boot ?? 'boot-a', capturedAt, batch: o.batch ?? batch++, batchIndex: o.batchIndex ?? 0,
            ...(o.attempt === null ? {} : { attemptId: o.attempt ?? 'attempt-1' }) });
        Object.defineProperty(stamped, 'sourcePage', { value: page, enumerable: false });
        Object.defineProperty(stamped, 'sourceDocument', { value: 0, enumerable: false });
        Object.defineProperty(stamped, 'sourceDocumentAt', { value: 0, enumerable: false });
        return stamped;
    };
    const watchdog = (h: ReturnType<typeof harness>, suite: string) => {
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: watchProfileFor(suite), label: 'case', log: () => undefined });
        w.setFaultPhase(true);
        return w;
    };

    it('save-retry: FAILED then a code-less FAILED_VISIBLE of the same attempt passes', async () => {
        const h = harness(); const w = watchdog(h, 'save-retry-recovery-request-lost'); const t = Date.now() + 10; // inside the fault phase
        h.tap.events.push(sent(h.page, { capturedAt: t }, state('STOPPING', 'FAILED', 'session_save_failed')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toBeNull();
    });

    it('NEGATIVE: a FAILED of ANOTHER attempt does not bind', async () => {
        const h = harness(); const w = watchdog(h, 'save-retry-recovery-request-lost'); const t = Date.now() + 10; // inside the fault phase
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'attempt-1' }, state('STOPPING', 'FAILED', 'session_save_failed')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, attempt: 'attempt-2' }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toMatchObject({ kind: 'recording_failed' });
    });

    it('NEGATIVE: with no attempt id nothing binds', async () => {
        const h = harness(); const w = watchdog(h, 'save-retry-recovery-request-lost'); const t = Date.now() + 10; // inside the fault phase
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: null }, state('STOPPING', 'FAILED', 'session_save_failed')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, attempt: null }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toMatchObject({ kind: 'recording_failed' });
    });

    it('NEGATIVE (stale): an older excused FAILED does not cover a presentation after a newer transition', async () => {
        const h = harness(); const w = watchdog(h, 'save-retry-recovery-request-lost'); const t = Date.now() + 10; // inside the fault phase
        h.tap.events.push(sent(h.page, { capturedAt: t }, state('STOPPING', 'FAILED', 'session_save_failed')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 2 }, state('FAILED', 'READY')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toMatchObject({ kind: 'recording_failed' });
    });

    it('NEGATIVE (out of order): a late-arriving transition captured between an excused pair voids it and trips', async () => {
        const h = harness(); const w = watchdog(h, 'save-retry-recovery-request-lost'); const t = Date.now() + 10; // inside the fault phase
        h.tap.events.push(sent(h.page, { capturedAt: t }, state('STOPPING', 'FAILED', 'session_save_failed')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t + 2 }, state('FAILED', 'READY')));
        expect(await w.tick()).toMatchObject({ kind: 'recording_failed', fields: { to_state: 'FAILED_VISIBLE' } });
    });

    it('pending-start: one `aborted` acquisition failure after the navigation intent passes', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 1 }, acq('aborted')));
        expect(await w.tick()).toBeNull();
    });

    it('NEGATIVE: an `aborted` acquisition failure captured BEFORE the intent trips', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        const before = Date.now(); // inside the fault phase, before the intent
        await new Promise((r) => setTimeout(r, 20));
        w.markNavigationIntent(h.page);
        h.tap.events.push(sent(h.page, { capturedAt: before }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });

    it('NEGATIVE: a SECOND abort after the intent trips', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 1 }, acq('aborted')));
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 2 }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });

    it('NEGATIVE: an unrelated acquisition error after the intent trips', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 1 }, acq('network')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed', fields: { error_code: 'network' } });
    });

    it('NEGATIVE: an abort from a page other than the one that navigated trips', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        const other = { context: () => ({ close: async () => undefined }), evaluate: async () => null };
        w.setPage(other as never);
        w.markNavigationIntent(h.page);
        h.tap.events.push(sent(other, { capturedAt: Date.now() + 1 }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });

    it('an abort CAPTURED before the intent closed is still the leave\'s own, even when it is judged after the close', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        const captured = Date.now();
        await new Promise((r) => setTimeout(r, 20));
        w.closeNavigationIntent();
        h.tap.events.push(sent(h.page, { capturedAt: captured }, acq('aborted')));
        expect(await w.tick()).toBeNull();
    });

    it('NEGATIVE (security review, low 3): an abort captured AFTER the abandoned Start settled (intent closed) trips', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        w.closeNavigationIntent();
        await new Promise((r) => setTimeout(r, 20));
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });

    it('NEGATIVE: closing the intent again later never reopens or extends it', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        w.closeNavigationIntent();
        await new Promise((r) => setTimeout(r, 20));
        w.closeNavigationIntent();
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() - 5 }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });

    it('NEGATIVE (security review of v3, info 1): a second intent mark never re-arms the one excused abort', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() }, acq('aborted')));
        expect(await w.tick()).toBeNull();
        w.markNavigationIntent(h.page);
        await new Promise((r) => setTimeout(r, 5));
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });

    it('NEGATIVE: outside the fault phase the abort trips', async () => {
        const h = harness(); const w = watchdog(h, 'pending-start-navigation');
        w.markNavigationIntent(h.page);
        w.setFaultPhase(false);
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 5 }, acq('aborted')));
        expect(await w.tick()).toMatchObject({ kind: 'model_failed' });
    });
});
