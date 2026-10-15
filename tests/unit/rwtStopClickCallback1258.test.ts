// @vitest-environment node
/**
 * #1258 Codex P2 r4278702635 (PM 6192426838) — the Practice-again save take must tell a failed Stop CLICK apart from a
 * failure AFTER the click (the recorder bar not disappearing, or the phase log rejecting). These drive the REAL
 * `stopBenchmarkRecording` with a scripted page, so the regression is the callback's timing inside that helper — and the
 * REAL `practiceAgainEvidence` on top of it (only the Start helpers are doubled). Receipt rows stay HOLD throughout.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

/** Which boundary the scripted page fails at (null = none). */
const page$ = vi.hoisted(() => ({ fail: null as null | 'click' | 'bar' | 'phase', calls: [] as string[] }));

vi.mock('@playwright/test', () => {
    const matchers = (target: { __id?: string }) => ({
        toBeEnabled: async () => undefined,
        toContainText: async () => undefined,
        toBeVisible: async () => undefined,
        toHaveCount: async () => {
            if (target.__id === 'recorder-bar') { page$.calls.push('bar-check'); if (page$.fail === 'bar') throw new Error('recorder bar still shown'); }
        },
        toBe: () => undefined,
    });
    const expect = Object.assign((target: { __id?: string }) => matchers(target), {
        soft: () => ({ toBe: () => undefined }),
        poll: (fn: () => Promise<unknown>) => ({ toBe: async (v: unknown) => { if ((await fn()) !== v) throw new Error('poll'); } }),
    });
    return { expect, test: {} };
});
vi.mock('../live/helpers/benchmark-utils', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startBenchmarkRecording: async () => undefined,
    expectBenchmarkRecordingStarted: async () => undefined,
}));
vi.mock('../live/helpers/rwtStepDiagnostics', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readPracticeActionState: async () => null,
}));

const { stopBenchmarkRecording } = await import('../live/helpers/benchmark-utils');
const { practiceAgainEvidence, practiceAgainRows, RwtReceipt } = await import('../live/helpers/rwtJourney');

/** A scripted page: `recorder-stop` click may reject; `page.evaluate` (the phase log's snapshot) may reject. */
const fakePage = (): Page => ({
    getByTestId: (id: string) => ({
        __id: id,
        click: async () => { page$.calls.push(`click:${id}`); if (id === 'recorder-stop' && page$.fail === 'click') throw new Error('click failed'); },
    }),
    goto: async () => undefined,
    url: () => 'https://example.test/session',
    waitForURL: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({ __id: 'review' }),
    getByText: () => ({ count: async () => 0 }),
    evaluate: async (fn: () => unknown, arg?: unknown) => {
        // The benchmark snapshot (collectBenchmarkPreconditionSnapshot) is the only evaluate called WITH an argument; it
        // catches its own errors, so the phase log can only reject when writing the log line fails (scripted below).
        if (arg !== undefined) return {};
        const src = String(fn);
        if (src.includes('__rwtMicStreams__')) return 0;
        if (src.includes('data-runtime-state')) return { texts: [], runtimeState: 'recording', sessionState: 'during', persisted: false, modelStatus: 'ready',
            micStartPresent: false, micStartDisabled: null, recorderStopPresent: true, repeatActionPresent: false, repeatActionDisabled: null,
            controllerState: 'RECORDING', serviceState: 'RECORDING' };
        if (src.includes('data-session-persisted-id')) return 'take-2';
        if (src.includes('data-session-persisted')) return true;
        return null;
    },
}) as unknown as Page;

beforeEach(() => {
    page$.fail = null; page$.calls = [];
    // logBenchmarkPhase writes `[STT_BENCHMARK_PHASE] …`; the 'phase' boundary makes that write reject.
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
        if (page$.fail === 'phase' && String(line).startsWith('[STT_BENCHMARK_PHASE]')) throw new Error('phase log failed');
    });
});

describe('stopBenchmarkRecording — onClicked fires exactly when the Stop click resolves', () => {
    it.each([
        ['the click rejects', 'click', false],
        ['the click succeeds, then the recorder-bar check rejects', 'bar', true],
        ['the click succeeds, then the phase log rejects', 'phase', true],
    ] as const)('%s → the helper still throws; onClicked called = %s', async (_l, fail, called) => {
        page$.fail = fail;
        const onClicked = vi.fn();
        await expect(stopBenchmarkRecording(fakePage(), 'pa-save', undefined, onClicked)).rejects.toThrow(/Benchmark stop precondition failed for pa-save/);
        expect(onClicked).toHaveBeenCalledTimes(called ? 1 : 0);
    });
    it('the successful stop path calls it once, before the postconditions', async () => {
        const order: string[] = [];
        await stopBenchmarkRecording(fakePage(), 'pa-save', undefined, () => order.push(`clicked(after ${page$.calls.join(',')})`));
        expect(order).toEqual(['clicked(after click:recorder-stop)']);
        expect(page$.calls).toEqual(['click:recorder-stop', 'bar-check']);
    });
    it('a caller that omits the callback keeps its existing success behavior', async () => {
        await expect(stopBenchmarkRecording(fakePage(), 'other-caller')).resolves.toBeUndefined();
    });
    it.each(['click', 'bar', 'phase'] as const)('a caller that omits the callback keeps its existing failure behavior (fail=%s)', async (fail) => {
        page$.fail = fail;
        await expect(stopBenchmarkRecording(fakePage(), 'other-caller')).rejects.toThrow(/Benchmark stop precondition failed for other-caller/);
    });
});

describe('practiceAgainEvidence on the REAL stop helper — the Stop flag is the click, not the settle', () => {
    it.each([
        ['click rejects', 'click', false],
        ['click ok, recorder bar stays', 'bar', true],
        ['click ok, phase log rejects', 'phase', true],
    ] as const)('%s → failed step "stop", saveTakeStopPressed=%s; both rows HOLD', async (_l, fail, pressed) => {
        page$.fail = fail;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        expect(ev).toMatchObject({ reviewReached: false, saveTakeFailedStep: 'stop', saveTakeStartPressed: true, saveTakeStopPressed: pressed });
        const receipt = new RwtReceipt('open-mic-first-session');
        practiceAgainRows(receipt, 'open_mic', ev);
        for (const step of ['review Practice again starts, no hold', 'repeated take stopped, microphone off']) {
            const row = receipt.rows.find((r) => r.step === step)!;
            expect(row.verdict).toBe('HOLD');
            expect(row.evidence).toMatchObject({ saveTakeFailedStep: 'stop', saveTakeStopPressed: pressed });
        }
    });
    it('a successful stop still reaches the review with both presses recorded', async () => {
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        expect(ev).toMatchObject({ reviewReached: true, saveTakeFailedStep: null, saveTakeStartPressed: true, saveTakeStopPressed: true });
    });
});
