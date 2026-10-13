// @vitest-environment node
/**
 * #1258 alpha run 38298685079 — the review's repeat Start and a fresh next Start both failed to begin recording, and
 * the helper's catch swallowed WHY. A Start that does not begin now records a content-free refusal class and page state,
 * and the rows stay FAIL: the diagnostics explain a failure, they never soften it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

/** `receipt.row` raises Playwright's `expect.soft` for every FAIL: capture it, so a FAIL row is asserted, not swallowed. */
const soft = vi.hoisted(() => ({ calls: [] as Array<{ actual: unknown; message?: string }> }));
vi.mock('@playwright/test', () => {
    const expect = Object.assign(() => ({ toBe: () => undefined }), {
        soft: (actual: unknown, message?: string) => { soft.calls.push({ actual, message }); return { toBe: () => undefined }; },
    });
    return { expect, test: {} };
});
import {
    RwtReceipt, classifyStartRefusal, nextStartRows, practiceAgainRows, readStartFailureState, startFailureEvidence,
    type PracticeAgainEvidence, type StartFailureState,
} from '../live/helpers/rwtJourney';
import { interpretAcquireResult } from '../../frontend/src/services/recordingLeasePolicy';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The product's own copy, read from source so a wording change cannot silently turn a class into `none_visible`. */
const ENGINE_UNCONFIRMED = (() => {
    const src = readFileSync(path.join(ROOT, 'frontend/src/hooks/useSessionLifecycle.ts'), 'utf8');
    const m = src.match(/ENGINE_RETIRE_UNCONFIRMED_MESSAGE =\s*'((?:\\'|[^'])*)'/);
    if (!m) throw new Error('ENGINE_RETIRE_UNCONFIRMED_MESSAGE not found');
    return m[1].replace(/\\'/g, "'");
})();
const leaseBlocked = interpretAcquireResult({ acquired: false, reason: 'held_by_other', holder_label: 'your other tab' } as never);
const LEASE_BLOCKED = 'message' in leaseBlocked ? String(leaseBlocked.message) : '';
/** The controller's refusal while a previous recording is unresolved (#1600 review 6133231405). */
const PRIOR_UNSAVED = (() => {
    const src = readFileSync(path.join(ROOT, 'frontend/src/services/SpeechRuntimeController.ts'), 'utf8');
    const m = src.match(/refuseStart\('(Finish saving your previous recording[^']*)'\)/);
    if (!m) throw new Error('prior-unsaved refusal copy not found');
    return m[1];
})();
const FINISHING_UP = (() => {
    const src = readFileSync(path.join(ROOT, 'frontend/src/services/progress/progressStartGate.ts'), 'utf8');
    const m = src.match(/'(Finishing up your last session[^']*)'/);
    if (!m) throw new Error('Progress hold copy not found');
    return m[1];
})();

describe('classifyStartRefusal — closed enum from the product copy', () => {
    it('names each known refusal from the product strings', () => {
        expect(classifyStartRefusal([ENGINE_UNCONFIRMED])).toBe('engine_unconfirmed');
        expect(LEASE_BLOCKED).toMatch(/A recording is active on/);
        expect(classifyStartRefusal([LEASE_BLOCKED])).toBe('lease_blocked');
        expect(classifyStartRefusal([FINISHING_UP])).toBe('finishing_up');
        expect(classifyStartRefusal(['Could not start recording. Please try again.'])).toBe('start_error');
        expect(classifyStartRefusal([PRIOR_UNSAVED])).toBe('prior_unsaved');
    });
    it('reports none_visible when no refusal copy is on the page', () => {
        expect(classifyStartRefusal([])).toBe('none_visible');
        expect(classifyStartRefusal(['Mic ready on this device', 'Session saved.'])).toBe('none_visible');
    });
    it('prefers the engine refusal over a generic error shown alongside it', () => {
        expect(classifyStartRefusal(['Could not start recording.', ENGINE_UNCONFIRMED])).toBe('engine_unconfirmed');
    });
});

describe('readStartFailureState — classifies in memory and drops the text', () => {
    afterEach(() => { vi.useRealTimers(); });
    const raw = {
        texts: [ENGINE_UNCONFIRMED, 'secret transcript words that must never be recorded'],
        runtimeState: 'READY', sessionState: 'after', persisted: true, modelStatus: 'ready',
        micStartPresent: false, micStartDisabled: null, recorderStopPresent: false, repeatActionPresent: true, repeatActionDisabled: false,
        controllerState: 'READY', serviceState: 'STOPPED',
    };
    it('returns the class and state, never the status text', async () => {
        const page = { evaluate: async () => raw } as unknown as Page;
        const state = await readStartFailureState(page);
        expect(state.refusalClass).toBe('engine_unconfirmed');
        expect(state.readTimedOut).toBe(false);
        expect(state.runtimeState).toBe('READY');
        expect(JSON.stringify(state)).not.toContain('secret transcript');
        expect(JSON.stringify(state)).not.toContain('could not confirm');
        expect('texts' in state).toBe(false);
    });
    it('a read that never answers is reported as timed out, not as a clean page', async () => {
        vi.useFakeTimers();
        const page = { evaluate: () => new Promise(() => {}) } as unknown as Page;
        const pending = readStartFailureState(page);
        await vi.advanceTimersByTimeAsync(5_000);
        const state = await pending;
        expect(state.readTimedOut).toBe(true);
        expect(state.refusalClass).toBeNull();
    });
});

const failedStart: StartFailureState = {
    refusalClass: 'engine_unconfirmed', runtimeState: 'READY', sessionState: 'after', persisted: true, modelStatus: 'ready',
    micStartPresent: false, micStartDisabled: null, recorderStopPresent: false, repeatActionPresent: true, repeatActionDisabled: false,
    controllerState: 'READY', serviceState: 'STOPPED', readTimedOut: false,
};
const rowOf = (receipt: RwtReceipt, step: string) => {
    const row = receipt.rows.find((r) => r.step === step);
    if (!row) throw new Error(`row ${step} missing`);
    return row as { verdict: string; evidence?: Record<string, unknown> };
};

describe('rows keep FAIL and carry the diagnostics', () => {
    afterEach(() => { soft.calls.length = 0; });
    const softFailed = (step: string) => soft.calls.some((c) => c.actual === 'FAIL' && String(c.message).startsWith(`${step}:`));
    const ev = (over: Partial<PracticeAgainEvidence>): PracticeAgainEvidence => ({
        analyticsActionOpened: true, sameSetPending: null, reviewReached: true, afterActionEnabledMs: 4, holdSeen: false,
        afterStartMs: null, stopped: false, liveTracksAfterStop: 0, reason: 'the repeat action did not begin recording',
        savedSessionId: 'take-2', actionBefore: null, actionAfter: null,
        saveTakePersisted: false, saveTakeNewSession: true, startFailure: failedStart, ...over,
    });

    it('the review repeat Start that did not begin is FAIL, with the refusal class and the take-2 save binding', () => {
        const receipt = new RwtReceipt('unit');
        practiceAgainRows(receipt, 'open_mic', ev({}));
        const row = rowOf(receipt, 'review Practice again starts, no hold');
        expect(row.verdict).toBe('FAIL');
        expect(row.evidence).toMatchObject({
            refusalClass: 'engine_unconfirmed', runtimeState: 'READY', controllerState: 'READY', serviceState: 'STOPPED',
            saveTakePersisted: false, saveTakeNewSession: true, startFailureReadTimedOut: false,
        });
        expect(softFailed('review Practice again starts, no hold')).toBe(true);
    });

    it('an unreadable page stays FAIL and says the diagnostic timed out', () => {
        const receipt = new RwtReceipt('unit');
        practiceAgainRows(receipt, 'open_mic', ev({ startFailure: { ...failedStart, refusalClass: null, runtimeState: null, readTimedOut: true } }));
        const row = rowOf(receipt, 'review Practice again starts, no hold');
        expect(row.verdict).toBe('FAIL');
        expect(row.evidence).toMatchObject({ refusalClass: null, startFailureReadTimedOut: true });
        expect(softFailed('review Practice again starts, no hold')).toBe(true);
    });

    it('a Start that began still PASSes, with every diagnostic field null', () => {
        const receipt = new RwtReceipt('unit');
        practiceAgainRows(receipt, 'open_mic', ev({ afterStartMs: 900, stopped: true, startFailure: null, saveTakePersisted: true }));
        const row = rowOf(receipt, 'review Practice again starts, no hold');
        expect(row.verdict).toBe('PASS');
        expect(row.evidence).toMatchObject({ refusalClass: null, startFailureReadTimedOut: null });
        expect(softFailed('review Practice again starts, no hold')).toBe(false);
    });

    it('the fresh next Start that did not begin is FAIL with its refusal class', () => {
        const receipt = new RwtReceipt('unit');
        nextStartRows(receipt, {
            holdSeen: false, nextStartMs: null, stopped: false, liveTracksAfterStop: 0,
            reason: 'the next Start did not begin recording', startFailure: { ...failedStart, refusalClass: 'lease_blocked', sessionState: 'before' },
        });
        const row = rowOf(receipt, 'next Start');
        expect(row.verdict).toBe('FAIL');
        expect(row.evidence).toMatchObject({ refusalClass: 'lease_blocked', sessionState: 'before' });
        expect(softFailed('next Start')).toBe(true);
    });

    it('evidence for no failure is all-null rather than missing', () => {
        const flat = startFailureEvidence(null);
        expect(Object.values(flat).every((v) => v === null)).toBe(true);
        expect(Object.keys(flat)).toContain('refusalClass');
    });
});
