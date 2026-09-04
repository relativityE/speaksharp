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

    it('CASUALTY: the SERVICE wires the trigger from its explicit-init authority', async () => {
        // The setter existing is not the same as anything calling it. `initializeStrategy` already knows
        // whether this is a user act or a background pulse; without passing that through, the setter is
        // as inert as the field was.
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const src = readFileSync(
            resolve(process.cwd(), 'frontend/src/services/transcription/TranscriptionService.ts'), 'utf8');
        expect(src, 'the service must name the trigger before initialising the strategy')
            .toMatch(/setAcquisitionTrigger\?\.\(isExplicitInit \? 'explicit-setup' : 'warmup'\)/);
        const wireAt = src.indexOf('setAcquisitionTrigger');
        const initAt = src.indexOf('this.strategy.init(STT_CONFIG.STRATEGY_INIT_TIMEOUT_MS', wireAt);
        expect(initAt, 'and it must do so BEFORE init, or the load is already labelled wrong')
            .toBeGreaterThan(wireAt);
    });
});
