// @vitest-environment node
/**
 * #1258 smoke run 38654466793 (PM 6181247850) — the Practice-again SAVE take did not reach the completed-session review,
 * and one catch around mic-ready → Start → recording-started → Stop → review lost WHICH boundary failed. The producer now
 * names the sub-step being attempted, records which presses actually completed, and reads the page state BEFORE teardown.
 * The rows stay HOLD: diagnostics explain an incomplete take, they never turn it into PASS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

type Step = 'mic_ready' | 'start' | 'recording_started' | 'stop' | 'review';
/** The sub-step the scripted page fails at (null = every step succeeds), and calls made, in order. */
const script = vi.hoisted(() => ({ failAt: null as Step | null, calls: [] as string[], evaluateHangs: false }));
const fail = (step: Step) => { if (script.failAt === step) throw new Error(`scripted failure at ${step}`); };

/** `receipt.row` raises `expect.soft` for each FAIL; a stand-in that records nothing is enough here. */
vi.mock('@playwright/test', () => {
    const matchers = (target: { __kind?: string }) => ({
        toBeEnabled: async () => undefined,
        toContainText: async () => { if (target.__kind === 'mic-status') fail('mic_ready'); },
        toBeVisible: async () => { if (target.__kind === 'review') fail('review'); },
        toBe: () => undefined,
    });
    const expect = Object.assign((target: { __kind?: string }) => matchers(target), {
        soft: () => ({ toBe: () => undefined }),
        poll: (fn: () => Promise<unknown>) => ({ toBe: async (v: unknown) => { if ((await fn()) !== v) throw new Error('poll'); } }),
    });
    return { expect, test: {} };
});
vi.mock('../live/helpers/benchmark-utils', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startBenchmarkRecording: async (_p: unknown, label: string) => { script.calls.push(`start:${label}`); fail('start'); },
    expectBenchmarkRecordingStarted: async (_p: unknown, label: string) => { script.calls.push(`started:${label}`); fail('recording_started'); },
    // A scripted 'stop' failure here is a failed CLICK, so the post-click callback is not reached (the real helper's
    // click-vs-postcondition timing is exercised in rwtStopClickCallback1258.test.ts).
    stopBenchmarkRecording: async (_p: unknown, label: string, _timeout?: number, onClicked?: () => void) => {
        script.calls.push(`stop:${label}`); if (!label.endsWith('-teardown')) fail('stop'); onClicked?.();
    },
}));
vi.mock('../live/helpers/rwtStepDiagnostics', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readPracticeActionState: async () => null,
}));

const { practiceAgainEvidence, practiceAgainRows, RwtReceipt } = await import('../live/helpers/rwtJourney');

/** A scripted page: the review shell appears unless the review step fails; evaluate answers by what it reads. */
const fakePage = (): Page => ({
    goto: async (url: string) => { script.calls.push(`goto:${url}`); },
    getByTestId: (id: string) => ({ __kind: id, click: async () => undefined }),
    waitForURL: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({ __kind: 'review' }),
    getByText: () => ({ count: async () => 0 }),
    evaluate: (fn: () => unknown) => {
        const src = String(fn);
        if (src.includes('data-runtime-state')) {
            if (script.evaluateHangs) return new Promise(() => undefined);
            return Promise.resolve({ texts: [], runtimeState: 'recording', sessionState: 'during', persisted: false, modelStatus: 'ready',
                micStartPresent: false, micStartDisabled: null, recorderStopPresent: true, repeatActionPresent: false, repeatActionDisabled: null,
                controllerState: 'RECORDING', serviceState: 'RECORDING' });
        }
        if (src.includes('__rwtMicStreams__')) return Promise.resolve(0);
        if (src.includes('data-session-persisted-id')) return Promise.resolve('take-2');
        if (src.includes('data-session-persisted')) return Promise.resolve(true);
        return Promise.resolve(null);
    },
}) as unknown as Page;

beforeEach(() => { script.failAt = null; script.calls = []; script.evaluateHangs = false; });

describe('practiceAgainEvidence — the save take records the sub-step it stopped at', () => {
    it.each([
        ['mic_ready', false, false],
        ['start', false, false],
        ['recording_started', true, false],
        ['stop', true, false],
        ['review', true, true],
    ] as const)('a failure at %s is named, with only the presses that actually completed', async (step, startPressed, stopPressed) => {
        script.failAt = step;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        expect(ev).toMatchObject({
            reviewReached: false, saveTakeFailedStep: step, saveTakeStartPressed: startPressed, saveTakeStopPressed: stopPressed,
            reason: `the practice take did not reach the completed-session review (stopped at: ${step})`,
        });
        // The page state was read BEFORE teardown navigated away (closed values only).
        expect(ev.saveTakeFailure).toMatchObject({ readTimedOut: false, runtimeState: 'recording', sessionState: 'during', controllerState: 'RECORDING' });
        expect(script.calls.indexOf('goto:about:blank')).toBeGreaterThan(-1);
    });
    it('a page-state read that never settles is bounded and marked unread — the original failure stands', async () => {
        script.failAt = 'review';
        script.evaluateHangs = true;
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
            expect(ev).toMatchObject({ reviewReached: false, saveTakeFailedStep: 'review' });
            expect(ev.saveTakeFailure?.readTimedOut).toBe(true);
        } finally { vi.useRealTimers(); }
    });
    it('positive path: every step completes → the review is reached and no failed step is recorded', async () => {
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        expect(ev).toMatchObject({ reviewReached: true, saveTakeFailedStep: null, saveTakeStartPressed: true, saveTakeStopPressed: true, saveTakeFailure: null,
            savedSessionId: 'take-2', saveTakeNewSession: true });
    });
});

describe('practiceAgainRows — an incomplete save take stays HOLD and carries its sub-step', () => {
    it.each(['mic_ready', 'start', 'recording_started', 'stop', 'review'] as const)('failed at %s → both rows HOLD with the step and page state', async (step) => {
        script.failAt = step;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        const receipt = new RwtReceipt('open-mic-first-session');
        practiceAgainRows(receipt, 'open_mic', ev);
        const start = receipt.rows.find((r) => r.step === 'review Practice again starts after the gate clears')!;
        const off = receipt.rows.find((r) => r.step === 'repeated take stopped, microphone off')!;
        expect([start.verdict, off.verdict]).toEqual(['HOLD', 'HOLD']);
        for (const row of [start, off]) {
            expect(row.evidence).toMatchObject({ saveTakeFailedStep: step, saveTakeStartPressed: ev.saveTakeStartPressed,
                saveTakeStopPressed: ev.saveTakeStopPressed, runtimeState: 'recording', sessionState: 'during', startFailureReadTimedOut: false });
        }
        // Zero live tracks after teardown does NOT prove the repeated take stopped: still HOLD, never PASS.
        expect(off.evidence?.liveTracksAfterStop).toBe(0);
        expect(off.verdict).toBe('HOLD');
    });
});
