// @vitest-environment node
/**
 * #1258 (PM ruling) — the repeat-take row no longer forbids the honest "Finishing up your last session" wait. It asserts the
 * fence instead: the action stays disabled while the wait shows, the gate clears, and recording begins, each within 15 s.
 * Controls: a delayed gate that clears (PASS), a gate that fails and is retried (PASS once it clears, FAIL if the action was
 * enabled during the wait), and a gate that never completes (FAIL).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const soft = vi.hoisted(() => ({ calls: [] as Array<{ actual: unknown; message?: string }> }));
vi.mock('@playwright/test', () => {
    const expect = Object.assign(() => ({ toBe: () => undefined }), {
        soft: (actual: unknown, message?: string) => { soft.calls.push({ actual, message }); return { toBe: () => undefined }; },
    });
    return { expect, test: {} };
});
import {
    REPEAT_START_ROW, RwtReceipt, practiceAgainRows, repeatStartVerdict, type PracticeAgainEvidence,
} from '../live/helpers/rwtJourney';

const ev = (over: Partial<PracticeAgainEvidence>): PracticeAgainEvidence => ({
    analyticsActionOpened: true, sameSetPending: null, reviewReached: true, afterActionEnabledMs: 40, holdSeen: false,
    afterStartMs: 900, stopped: true, liveTracksAfterStop: 0, reason: null, savedSessionId: 'take-2', actionBefore: null,
    actionAfter: null, saveTakePersisted: true, saveTakeNewSession: true, startFailure: null, enabledWhileHolding: false,
    stopToSaveMs: 1_200, saveToGateClearMs: 40, pressToWarmupDoneMs: 700, pressToRecordingMs: 900, ...over,
});
const rowOf = (receipt: RwtReceipt) => receipt.rows.find((r) => r.step === REPEAT_START_ROW) as
    { verdict: string; detail: string; evidence?: Record<string, unknown> };

describe('repeatStartVerdict — the fence, not the absence of the wait', () => {
    afterEach(() => { soft.calls.length = 0; });

    it('no wait: offered at once and recording began → PASS', () => {
        expect(repeatStartVerdict(ev({})).status).toBe('PASS');
    });

    it('DELAYED gate: "Finishing up" shown with the action fenced, cleared after 6 s, recording began → PASS', () => {
        const v = repeatStartVerdict(ev({ holdSeen: true, afterActionEnabledMs: 6_000, saveToGateClearMs: 6_100 }));
        expect(v.status).toBe('PASS');
        expect(v.detail).toMatch(/fenced/);
    });

    it('FAILED-then-RETRIED gate that clears within 15 s → PASS; the same retry with the action enabled during the wait → FAIL', () => {
        expect(repeatStartVerdict(ev({ holdSeen: true, afterActionEnabledMs: 11_000 })).status).toBe('PASS');
        const leaked = repeatStartVerdict(ev({ holdSeen: true, enabledWhileHolding: true, afterActionEnabledMs: 11_000 }));
        expect(leaked.status).toBe('FAIL');
        expect(leaked.detail).toMatch(/enabled while/);
    });

    it('NEVER-COMPLETING gate: the action was not enabled within 15 s → FAIL (stuck gate)', () => {
        const v = repeatStartVerdict(ev({ holdSeen: true, afterActionEnabledMs: null, afterStartMs: null, reason: 'the review\'s repeat action was not enabled within 15 s' }));
        expect(v.status).toBe('FAIL');
        expect(v.detail).toMatch(/gate did not clear/);
    });

    it('the gate cleared but recording did not begin, or began after 15 s → FAIL', () => {
        expect(repeatStartVerdict(ev({ afterStartMs: null, reason: 'the repeat action did not begin recording' })).detail)
            .toBe('the repeat action did not begin recording');
        expect(repeatStartVerdict(ev({ afterStartMs: 15_000 })).status).toBe('FAIL');
    });

    it('the row carries the four timings and keeps FAIL loud', () => {
        const pass = new RwtReceipt('unit');
        practiceAgainRows(pass, 'open_mic', ev({ holdSeen: true, afterActionEnabledMs: 6_000 }));
        expect(rowOf(pass).verdict).toBe('PASS');
        expect(rowOf(pass).evidence).toMatchObject({
            stopToSaveMs: 1_200, saveToGateClearMs: 40, pressToWarmupDoneMs: 700, pressToRecordingMs: 900, enabledWhileHolding: false,
        });
        expect(soft.calls.some((c) => c.actual === 'FAIL')).toBe(false);

        const fail = new RwtReceipt('unit');
        practiceAgainRows(fail, 'focus_points', ev({ sameSetPending: true, holdSeen: true, enabledWhileHolding: true }));
        expect(rowOf(fail).verdict).toBe('FAIL');
        expect(soft.calls.some((c) => c.actual === 'FAIL' && String(c.message).startsWith(`${REPEAT_START_ROW}:`))).toBe(true);
    });
});
