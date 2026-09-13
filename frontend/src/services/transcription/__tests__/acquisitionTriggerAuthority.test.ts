// @vitest-environment jsdom
/**
 * #1259 — WHY DID THIS LOAD HAPPEN?
 *
 * `acquisitionTrigger` was declared and never assigned, so every acquisition reported `explicit-setup`
 * and `warmup` was an impossible category. That is not a cosmetic gap: a background warm-up that finds
 * the model already cached DOES proceed and initialise it, and those are the cheapest loads there are.
 * Folding them into the explicit population makes setup look faster than what a user who presses
 * "Set up Private" actually waits through — and setup duration is a launch decision.
 *
 * A warm-up on a cache MISS stops at DOWNLOAD_REQUIRED and never acquires, so it emits nothing. The
 * cache-HIT warm-up is the real, reachable case, and it is the one these cover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';
import { sttRegistry } from '@/services/transcription/STTRegistry';
import { CANDIDATES } from '@/services/transcription/candidateRegistry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetAcquisitionTelemetry, markIdentitySettled } from '@/services/transcription/modelAcquisitionTelemetry';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anon'), __loaded: true },
}));
vi.mock('@/services/transcription/candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return { ...actual, effectiveCandidate: () => ({ candidate: CANDIDATES['v2:base.en'], fallbackCause: null }) };
});

const captured = () => (posthog.capture as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
const anyAcquisition = () => captured().filter((c) => String(c[0]).startsWith('private_model_acquisition')).map((c) => c[1]);
async function drain() {
    for (let i = 0; i < 50 && analyticsBuffer.queue.length > 0; i += 1) await new Promise((r) => setTimeout(r, 0));
}

const fakeEngine = () => ({
    init: vi.fn(async () => ({ isOk: true as const, data: undefined })),
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    transcribe: vi.fn(async () => ''),
    getMetadata: () => ({ engineVersion: 'test', modelName: 'test', deviceType: 'browser' }),
});

type PrivateAccess = {
    initSelectedEngine: (t: string) => Promise<{ isOk: boolean }>;
    setAcquisitionTrigger: (t: 'warmup' | 'explicit-setup') => void;
    publishResolvedIdentity: () => void;
};

async function loadWith(trigger?: 'warmup' | 'explicit-setup') {
    sttRegistry.clear();
    sttRegistry.register('transformers-js', fakeEngine as never);
    const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
    stt.publishResolvedIdentity = () => {};
    // The service names the trigger before init — exactly as `initializeStrategy` does.
    if (trigger) stt.setAcquisitionTrigger(trigger);
    await stt.initSelectedEngine('transformers-js');
    await drain();
    return anyAcquisition();
}

beforeEach(() => {
    vi.clearAllMocks();
    __resetAcquisitionTelemetry();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    analyticsBuffer.resetIdentity();
    markIdentitySettled();
    (globalThis as unknown as { caches: unknown }).caches = { match: async () => undefined };
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((() => []) as typeof performance.getEntriesByType);
});

describe('#1259 the acquisition trigger names the real reason', () => {
    it('CASUALTY: a real user-driven setup reports `explicit-setup`', async () => {
        const events = await loadWith('explicit-setup');
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) expect(e.trigger).toBe('explicit-setup');
    });

    it('CASUALTY: a real background warm-up reports `warmup`', async () => {
        // This was unreachable: the field was never assigned, so a cached warm-up load was published as
        // an explicit setup and made the setup population look faster than it is.
        const events = await loadWith('warmup');
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) expect(e.trigger).toBe('warmup');
    });

    it('defaults to `explicit-setup` when no caller named a reason', async () => {
        // A load nobody labelled is the user-facing one by default; the safe direction is to count it
        // in the population whose duration we hold ourselves to.
        const events = await loadWith();
        for (const e of events) expect(e.trigger).toBe('explicit-setup');
    });

    // THE SOURCE-TEXT WIRING ASSERTION THAT USED TO LIVE HERE IS GONE.
    //
    // It read `TranscriptionService.ts` as a string and checked that a call site existed. That is the
    // weak proof this branch has been correcting throughout: text shows a line is present, not that the
    // value reaches the event, not that both branches are reachable, and not that it happens before the
    // load. It would have passed while the service's optional call landed on a strategy that had no such
    // method and silently no-opped — which is exactly what was happening.
    //
    // Replaced by execution through the real authority:
    //   - `acquisitionTriggerService.test.ts`        — real TranscriptionService: cached warm-up,
    //     user-driven setup, cache-miss warm-up that acquires nothing, and the before-init ordering.
    //   - `privateWhisperTriggerForwarding.test.ts`  — the REAL PrivateWhisper hop to the facade.
});
