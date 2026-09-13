/**
 * #1259 — THE TRIGGER, THROUGH THE REAL SERVICE.
 *
 * The trigger-wiring assertion used to read `TranscriptionService.ts` as TEXT. That is the same weak
 * proof this whole branch has been correcting: source text shows a call site exists, not that the
 * value reaches the event, and not that the two branches are reachable at all.
 *
 * These drive the REAL `TranscriptionService` entry points — `warmUp()` for a background pulse and
 * `initiateDownload()` for a user act — through the real strategy, and read the trigger the strategy
 * was actually given. The three cases are the ones that exist in production:
 *
 *   - a cached warm-up ACQUIRES, and must be labelled `warmup`;
 *   - a user-driven setup must be labelled `explicit-setup`;
 *   - a cache-MISS warm-up stops at DOWNLOAD_REQUIRED and must emit no acquisition at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import type { sttRegistry as SttRegistry } from '../STTRegistry';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

/** Availability is what decides warm-up-acquires vs warm-up-stops. Controlled per test. */
let available = true;

/**
 * The triggers that reach `PrivateSTT` — the facade that actually emits the telemetry — recorded via a
 * spy on its real method. Asserting on a stand-in engine would prove only that the service called
 * SOMETHING; the value has to arrive where the event is built, which means crossing the real strategy.
 */
const triggerSeen: Array<'warmup' | 'explicit-setup'> = [];
let initCalls = 0;
/** The order events actually happened in. Naming the trigger is only useful BEFORE the load. */
const sequence: string[] = [];

class TriggerProbeEngine extends STTEngine {
    public readonly type = 'transformers-js' as const;
    protected async onInit() { initCalls += 1; sequence.push('init'); return Result.ok(undefined); }
    protected async onStart() {}
    protected async onStop() {}
    protected async onDestroy() {}
    async transcribe() { return Result.ok('test'); }
    public override async getTranscript() { return 'test'; }
    /** The gate the service consults before deciding to acquire or stop. */
    override async checkAvailability() {
        return (available
            ? { isAvailable: true }
            : { isAvailable: false, reason: 'CACHE_MISS' }) as Awaited<ReturnType<STTEngine['checkAvailability']>>;
    }
}

vi.mock('../ModelManager', () => ({
    ModelManager: {
        isModelDownloaded: vi.fn(async () => available),
        getModelSizeMB: vi.fn(() => 100),
    },
}));

const noop = vi.fn();

describe('#1259 the acquisition trigger is named by the real service', () => {
    let service: TranscriptionService;
    let ServiceClass: typeof import('../TranscriptionService').default;
    let registry: typeof SttRegistry;

    const policy: TranscriptionPolicy = {
        allowPrivate: true, allowNative: false, allowFallback: false,
        preferredMode: 'private', executionIntent: 'test',
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        triggerSeen.length = 0;
        sequence.length = 0;
        initCalls = 0;
        available = true;
        await setupStrictZero();
        const { PrivateSTT } = await import('../engines/PrivateSTT');
        vi.spyOn(PrivateSTT.prototype, 'setAcquisitionTrigger').mockImplementation(function (
            this: unknown, t: 'warmup' | 'explicit-setup',
        ) { triggerSeen.push(t); sequence.push('trigger'); });
        ServiceClass = (await import('../TranscriptionService')).default;
        registry = (await import('../STTRegistry')).sttRegistry;
        const engine = new TriggerProbeEngine();
        registry.register('private', () => engine);
        registry.register('transformers-js', () => engine);
        service = new ServiceClass({
            onTranscriptUpdate: noop, onModelLoadProgress: noop, onReady: noop,
            onStatusChange: noop, onModeChange: noop, session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn(async () => 'tok'),
            policy,
        } as never);
    });

    afterEach(async () => {
        if (service && !service.isServiceDestroyed()) await service.destroy();
        vi.restoreAllMocks();
    });

    it('CASUALTY: a CACHED background warm-up acquires and is labelled `warmup`', async () => {
        // The reachable warm-up acquisition: the model is already there, so the pulse proceeds and
        // initialises it. Labelling this `explicit-setup` folds the cheapest loads into the population
        // that measures what a user actually waits through.
        available = true;
        await service.warmUp('private');
        expect(initCalls, 'a cached warm-up really does initialise').toBeGreaterThan(0);
        expect(triggerSeen, 'the service must name it a warm-up').toContain('warmup');
        expect(triggerSeen).not.toContain('explicit-setup');
    });

    it('CASUALTY: a USER-DRIVEN setup is labelled `explicit-setup`', async () => {
        available = true;
        await service.initiateDownload('private');
        expect(initCalls).toBeGreaterThan(0);
        expect(triggerSeen).toContain('explicit-setup');
        expect(triggerSeen).not.toContain('warmup');
    });

    it('CASUALTY: the trigger is named BEFORE the load, not after it', async () => {
        // Setting it afterwards is the same as not setting it: the acquisition events are built during
        // initialisation, so a trigger that arrives later labels nothing and the event carries the
        // default. The call site existing is not enough — its position is the property.
        available = true;
        await service.initiateDownload('private');
        expect(sequence).toContain('trigger');
        expect(sequence).toContain('init');
        expect(sequence.indexOf('trigger'),
            'a trigger set after init labels a load that has already been reported')
            .toBeLessThan(sequence.indexOf('init'));
    });

    it('CASUALTY: a cache-MISS warm-up stops and acquires NOTHING', async () => {
        // It transitions to DOWNLOAD_REQUIRED and returns before initialising, so there is no
        // acquisition to label and no event to emit. A trigger recorded here would describe a load that
        // never happened.
        available = false;
        await service.warmUp('private');
        expect(initCalls, 'a cache-miss warm-up must not initialise the model').toBe(0);
        expect(triggerSeen, 'and must not label an acquisition that did not occur').toEqual([]);
    });
});
