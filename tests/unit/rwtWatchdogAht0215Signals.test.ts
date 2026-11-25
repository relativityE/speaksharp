// @vitest-environment node
/**
 * AHT-02..15 run on 2026-11-12 (served release 5ffbbb93). The fail-early watchdog stopped AHT-04, 05, 06, 12, 13 and 14 on
 * the fault each scenario injects on purpose. Every signal below is the exact `RWT_FAIL_EARLY` line those runs logged. Each
 * allowance is paired with the nearby signal it must NOT excuse (Sam's review: unrelated errors and stale presentations).
 */
import { describe, expect, it } from 'vitest';
import { JourneyWatchdog, PRESENTATION_GRACE_MS, WATCH_PROFILES, fatalSignalOf, presentedFailureOf, watchProfileFor, type StateRecord, type WatchProfile } from '../live/helpers/rwtWatchdog';

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
        for (const code of ['network', 'integrity', 'storage', 'timeout', 'unsupported', 'release_uncertain', 'unknown']) {
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
        // J7.c (Sam 1795522438 finding 1): the late-presentation wait is the offline-download profile's only; save-retry trips at once.
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

    // J7.c run 45364395660: offline-sent events reach the tap after reconnect, out of order. The cold Start's presentation
    // arrived before the FAILED it presents and was judged unbound mid-Retry.
    const OFFLINE = 'adverse-mic-model-offline-mid-download';
    const coldFailed = () => state('ENGINE_INITIALIZING', 'FAILED', 'start_model_unavailable');

    it('J7.c: the presentation arrives first; its FAILED arrives on the next scan inside the wait; bound, it passes', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, batch: 1 }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 2 }, coldFailed()));
        expect(await w.tick(now + 2_700)).toBeNull();
        expect(await w.tick(now + PRESENTATION_GRACE_MS * 3), 'settled: nothing left to trip later').toBeNull();
    });

    it('J7.c NEGATIVE: the late FAILED never comes: it trips at the deadline, not before', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now), 'arrived: the wait starts now').toBeNull();
        expect(await w.tick(now + PRESENTATION_GRACE_MS - 1)).toBeNull();
        expect(await w.tick(now + PRESENTATION_GRACE_MS)).toMatchObject({ kind: 'recording_failed', fields: { to_state: 'FAILED_VISIBLE', presentationDisposition: 'grace_expired',
            firstSeenGapMs: 'unknown', sameRequest: 'unknown', causalCaptureGapMs: 'unknown' } });
    });

    it('J7.c distinguishes a tied cross-request transport arrival without claiming causal order', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        const now = Date.now();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick(now)).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 6 }, coldFailed()));
        expect(await w.tick(now + 50)).toBeNull();
        const result = await w.tick(now + PRESENTATION_GRACE_MS);
        expect(result).toMatchObject({ kind: 'recording_failed', fields: { presentationDisposition: 'grace_expired',
            firstSeenGapMs: -50, sameRequest: false, causalCaptureGapMs: 'unknown', retryAdmissionOrigin: 'unknown' } });
        expect(JSON.stringify(result)).not.toMatch(/boot-a|attempt-1|batch/i);
    });

    it('J7.c proves signed arrival versus capture for a coded predecessor that arrives too late to rescue the verdict', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        const now = Date.now();
        h.tap.events.push(sent(h.page, { capturedAt: t + 2, batch: 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick(now)).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 6 }, coldFailed()));
        const result = await w.tick(now + PRESENTATION_GRACE_MS);
        expect(result).toMatchObject({ kind: 'recording_failed', fields: { presentationDisposition: 'grace_expired',
            firstSeenGapMs: -PRESENTATION_GRACE_MS, sameRequest: false, causalCaptureGapMs: 2 } });
    });

    it('J7.c NEGATIVE: the late FAILED carries a code the scenario does not allow: it trips when it arrives', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t }, state('RECORDING', 'FAILED', 'session_save_failed')));
        expect(await w.tick(now + 100)).toMatchObject({ kind: 'recording_failed', fields: { failure_code: 'session_save_failed' } });
    });

    it('J7.c NEGATIVE: a later-arriving transition captured between the late pair keeps it unbound: it trips', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        h.tap.events.push(sent(h.page, { capturedAt: t }, coldFailed()));
        h.tap.events.push(sent(h.page, { capturedAt: t + 2 }, state('FAILED', 'READY')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        expect(await w.tick(now + PRESENTATION_GRACE_MS)).toMatchObject({ kind: 'recording_failed', fields: { to_state: 'FAILED_VISIBLE', presentationDisposition: 'grace_expired' } });
    });

    it('J7.c NEGATIVE: outside the fault phase nothing waits: an unbound presentation trips at once', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE);
        w.setFaultPhase(false);
        await new Promise((r) => setTimeout(r, 5));
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toMatchObject({ kind: 'recording_failed', fields: { presentationDisposition: 'unbound_outside_fault' } });
    });

    it('J7.c NEGATIVE: a real Retry failure is never masked by a waiting presentation: it trips the moment it arrives', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, attempt: 'cold' }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        w.setFaultPhase(false); // the network is back; the Retry is strict
        await new Promise((r) => setTimeout(r, 5));
        w.noteRetryAdmission();
        h.tap.events.push(sent(h.page, { capturedAt: Date.now() + 5, attempt: 'retry' }, state('ENGINE_INITIALIZING', 'FAILED', 'start_model_unavailable')));
        expect(await w.tick(now + 50)).toMatchObject({ kind: 'recording_failed', fields: { failure_code: 'start_model_unavailable', presentationDisposition: 'unexpected_failed_transition',
            capturedVsRetryAdmissionMs: expect.any(Number), retryAdmissionOrigin: 'consent_confirmed_before_retry',
            firstSeenGapMs: 'unknown', sameRequest: 'unknown', causalCaptureGapMs: 'unknown', sameObservedFaultAttempt: 'unknown' } });
    });

    it.each([false, true])('J7.c observes allowed preparing other (second allowed attempt: %s)', async (secondAttempt) => {
        const h = harness(); const w = watchdog(h, OFFLINE);
        const t = Date.now();
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'cold' }, state('ENGINE_INITIALIZING', 'FAILED', 'other')));
        if (secondAttempt) h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'other-cold' }, coldFailed()));
        expect(await w.tick(t)).toBeNull();
        w.setFaultPhase(false);
        const capturedAt = Date.now() + 5;
        h.tap.events.push(sent(h.page, { capturedAt, attempt: 'cold' }, coldFailed()));
        expect(await w.tick(capturedAt)).toMatchObject({ kind: 'recording_failed', fields: {
            sameObservedFaultAttempt: secondAttempt ? 'unknown' : true,
        } });
    });

    it('J7.c does not count a disallowed non-preparing other as an observed fault attempt', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE);
        const t = Date.now();
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'cold' }, state('RECORDING', 'FAILED', 'other')));
        expect(await w.tick(t)).toMatchObject({ kind: 'recording_failed', fields: {
            presentationDisposition: 'unexpected_failed_transition', failure_code: 'other', sameObservedFaultAttempt: 'unknown',
        } });
    });

    it.each([null, 'cold'] as const)('J7.c fatal after Retry with reported attempt %s does not prove a Start origin', async (attempt) => {
        const h = harness(); const w = watchdog(h, OFFLINE);
        const t = Date.now();
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'cold' }, coldFailed()));
        expect(await w.tick(t)).toBeNull();
        w.setFaultPhase(false);
        w.noteRetryAdmission();
        const capturedAt = Date.now() + 5;
        h.tap.events.push(sent(h.page, { capturedAt, attempt }, coldFailed()));
        const result = await w.tick(capturedAt);
        expect(result).toMatchObject({ kind: 'recording_failed', fields: {
            presentationDisposition: 'unexpected_failed_transition', retryAdmissionOrigin: 'consent_confirmed_before_retry',
            sameObservedFaultAttempt: attempt === null ? 'unknown' : true, causalCaptureGapMs: 'unknown',
        } });
        expect(JSON.stringify(result)).not.toMatch(/"cold"|accepted.?start/i);
    });

    it('J7.c null-attempt TERMINATED does not interpose in proven same-attempt capture order', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'cold', batch: 5 }, coldFailed()));
        h.tap.events.push(sent(h.page, { capturedAt: t + 1, attempt: null, batch: 6 }, state('FAILED', 'TERMINATED')));
        h.tap.events.push(sent(h.page, { capturedAt: t + 2, attempt: 'cold', batch: 7 }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        expect(await w.tick(now + PRESENTATION_GRACE_MS)).toBeNull();
    });

    it('J7.c NEGATIVE (cutoff): a matching FAILED first seen AFTER the deadline never rescues the row', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, batch: 1 }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 2 }, coldFailed()));
        expect(await w.tick(now + PRESENTATION_GRACE_MS + 1)).toMatchObject({ kind: 'recording_failed', fields: { to_state: 'FAILED_VISIBLE' } });
    });

    it('J7.c NEGATIVE (cutoff): a matching FAILED first seen exactly AT the deadline never rescues the row', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, batch: 1 }, state('FAILED', 'FAILED_VISIBLE')));
        const now = Date.now();
        expect(await w.tick(now)).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 2 }, coldFailed()));
        expect(await w.tick(now + PRESENTATION_GRACE_MS)).toMatchObject({ kind: 'recording_failed', fields: { to_state: 'FAILED_VISIBLE' } });
    });

    it('J7.c NEGATIVE (cutoff): first seen after the deadline but before finalization still FAILs the row at finalization', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, batch: 1 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick(Date.now() - PRESENTATION_GRACE_MS * 2), 'seen long ago: its deadline has passed').toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t, batch: 2 }, coldFailed()));
        const rows: { verdict: string; evidence?: unknown }[] = [];
        await w.record({ row: (_s: string, verdict: string, _d: string, evidence?: unknown) => { rows.push({ verdict, evidence }); } } as never);
        expect(rows).toEqual([expect.objectContaining({ verdict: 'FAIL', evidence: expect.objectContaining({ kind: 'recording_failed' }) })]);
    });

    it.each(['save-retry-recovery-request-lost', 'save-retry-recovery-response-lost', 'abandon-and-two-tabs-navigate-away', 'adverse-mic-model-download-fails'])(
        'J7.c NEGATIVE (scope): %s does not wait: an unbound in-fault presentation trips at once', async (suite) => {
            const h = harness(); const w = watchdog(h, suite); const t = Date.now() + 10;
            h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
            expect(await w.tick()).toMatchObject({ kind: 'recording_failed', fields: { to_state: 'FAILED_VISIBLE' } });
        });

    it('J7.c scope: only the offline-download profile carries the late-presentation wait', () => {
        expect(Object.entries(WATCH_PROFILES).filter(([, p]) => p.bindLatePresentation).map(([k]) => k)).toEqual(['adverse-mic-model-offline-mid-download']);
    });

    it('J7.c NEGATIVE: still waiting at finalization is a FAIL row, never a PASS', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t + 5 }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toBeNull();
        const rows: { verdict: string; evidence?: unknown }[] = [];
        await w.record({ row: (_s: string, verdict: string, _d: string, evidence?: unknown) => { rows.push({ verdict, evidence }); } } as never);
        expect(rows).toEqual([expect.objectContaining({ verdict: 'FAIL', evidence: expect.objectContaining({ kind: 'recording_failed', presentationDisposition: 'finalized_unbound' }) })]);
    });

    it('J7.c withdraws an excused pair on intervening capture and emits distinct evidence', async () => {
        const h = harness(); const w = watchdog(h, OFFLINE); const t = Date.now() + 10;
        h.tap.events.push(sent(h.page, { capturedAt: t, attempt: 'synthetic-cold' }, coldFailed()));
        h.tap.events.push(sent(h.page, { capturedAt: t + 5, attempt: 'synthetic-cold' }, state('FAILED', 'FAILED_VISIBLE')));
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sent(h.page, { capturedAt: t + 2, attempt: 'synthetic-cold' }, state('FAILED', 'READY')));
        const result = await w.tick();
        expect(result).toMatchObject({ kind: 'recording_failed', fields: { presentationDisposition: 'pair_invalidated',
            sameObservedFaultAttempt: true, to_state: 'FAILED_VISIBLE' } });
        expect(JSON.stringify(result)).not.toContain('synthetic-cold');
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
