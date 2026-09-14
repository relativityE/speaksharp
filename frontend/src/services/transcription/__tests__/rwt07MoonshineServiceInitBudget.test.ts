/**
 * RWT-07 / NEW-01 — a cold Moonshine acquisition that is still making progress must not be cut off by
 * the service's strategy-init value.
 *
 * Driven through the REAL `TranscriptionService.initiateDownload()` (the user-driven setup path) into a
 * REAL `MoonshineStreamingEngine`, so the value under test is the one the service actually hands the
 * engine — not a value a unit test chose. Only the model loader is a double: it takes 20 s, the order
 * of a real cold transfer of the pinned medium assets, and then succeeds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import type { MoonshineTranscriber } from '../engines/MoonshineStreamingEngine';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

const COLD_TRANSFER_MS = 20_000;
/** Read when the loader is CALLED, so each test sets its own transfer time before setup begins. */
let transferMs = COLD_TRANSFER_MS;

vi.mock('../ModelManager', () => ({
    ModelManager: {
        isModelDownloaded: vi.fn(async () => true),
        getModelSizeMB: vi.fn(() => 318),
    },
}));

const noop = vi.fn();

describe('RWT-07 a progressing cold Moonshine load reaches READY through the real service', () => {
    let service: TranscriptionService;
    let received: Array<number | undefined>;
    let innerResult: Result<void, Error> | null;
    let loaderSettled: boolean;

    const policy: TranscriptionPolicy = {
        allowPrivate: true, allowNative: false, allowFallback: false,
        preferredMode: 'private', executionIntent: 'test',
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        received = [];
        innerResult = null;
        loaderSettled = false;
        transferMs = COLD_TRANSFER_MS;
        await setupStrictZero();
        const { MoonshineStreamingEngine } = await import('../engines/MoonshineStreamingEngine');
        const transcriber = { transcribe: vi.fn(), createStream: vi.fn(), close: vi.fn() } as unknown as MoonshineTranscriber;
        const moonshine = new MoonshineStreamingEngine({
            candidateId: 'moonshine:streaming-medium',
            modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: () => new Promise<MoonshineTranscriber>((resolve) => {
                setTimeout(() => { loaderSettled = true; resolve(transcriber); }, transferMs);
            }),
        });

        // The strategy forwards the service's value unchanged, exactly as PrivateWhisper → PrivateSTT →
        // initMoonshineEngine do on main.
        class ForwardingStrategy extends STTEngine {
            public readonly type = 'moonshine-streaming' as const;
            protected async onInit(timeoutMs?: number) {
                received.push(timeoutMs);
                innerResult = await moonshine.init(timeoutMs);
                return innerResult;
            }
            protected async onStart() {}
            protected async onStop() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok(''); }
            public override async getTranscript() { return ''; }
            override async checkAvailability() {
                return { isAvailable: true } as Awaited<ReturnType<STTEngine['checkAvailability']>>;
            }
        }

        const ServiceClass = (await import('../TranscriptionService')).default;
        const registry = (await import('../STTRegistry')).sttRegistry;
        const strategy = new ForwardingStrategy();
        registry.register('private', () => strategy);
        registry.register('transformers-js', () => strategy);
        service = new ServiceClass({
            onTranscriptUpdate: noop, onModelLoadProgress: noop, onReady: noop,
            onStatusChange: noop, onModeChange: noop, session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn(async () => 'tok'),
            policy,
        } as never);
        vi.useFakeTimers();
    });

    afterEach(async () => {
        vi.useRealTimers();
        if (service && !service.isServiceDestroyed()) await service.destroy();
        vi.restoreAllMocks();
    });

    it('CASUALTY: the load that finishes at 20 s is adopted, not failed at 5 s', async () => {
        const setup = service.initiateDownload('private');
        await vi.advanceTimersByTimeAsync(COLD_TRANSFER_MS + 1);
        await setup;

        expect(loaderSettled, 'the double really did take the full transfer time').toBe(true);
        expect(received.length, 'the service initialised the strategy').toBeGreaterThan(0);
        expect(innerResult?.isOk,
            `moonshine init was given ${String(received[0])} ms and must not fail a transfer still in flight`)
            .toBe(true);
        const state = (service as unknown as { fsm: { getState: () => string } }).fsm.getState();
        expect(state).toBe('READY');
    });

    it('POSITIVE CONTROL: the same harness reaches READY when the load beats the cutoff', async () => {
        // Proves the casualty's red is the budget, not a harness that can never reach READY.
        transferMs = 4_000;
        const setup = service.initiateDownload('private');
        await vi.advanceTimersByTimeAsync(transferMs + 1);
        await setup;

        expect(loaderSettled).toBe(true);
        expect(innerResult?.isOk).toBe(true);
        const state = (service as unknown as { fsm: { getState: () => string } }).fsm.getState();
        expect(state).toBe('READY');
    });
});
