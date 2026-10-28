// @vitest-environment jsdom
/**
 * #1258 RWT round 2 finding A (run 38876581848): the next-take prewarm warms a FRESH service while the saved review is on
 * screen. That service published its warm-up to the page — `data-model-status=loading` and an `initializing` status — so
 * MicCard disabled Start and read "Downloading private transcription…" for a model that was already cached.
 *
 * A background preparation is invisible until a Start claims the service: nothing is published while it warms, and the
 * claim publishes the service's CURRENT state once. A service that is not in background preparation is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTStrategyFactory } from '../STTStrategyFactory';
import { Result } from '../modes/types';
import type { NavigateFunction } from 'react-router-dom';
import type { SttStatus } from '@/types/transcription';
import { toast } from '@/lib/toast';

vi.mock('../STTStrategyFactory');
vi.mock('@/lib/toast', () => ({
    toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

type BackgroundCapable = { setBackgroundPreparation?: (on: boolean) => void };

describe('#1258 finding A — a background next-take preparation does not publish its warm-up', () => {
    let statusUpdates: SttStatus[];
    let modelStatuses: string[];
    let observer: MutationObserver;

    const makeService = () => new TranscriptionService({
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        onStatusChange: (s: SttStatus) => statusUpdates.push(s),
        session: null,
        navigate: vi.fn() as unknown as NavigateFunction,
        getAssemblyAIToken: vi.fn(),
    });

    beforeEach(() => {
        vi.clearAllMocks();
        statusUpdates = [];
        modelStatuses = [];
        document.documentElement.setAttribute('data-model-status', 'idle');
        observer?.disconnect();
        observer = new MutationObserver(() => {
            modelStatuses.push(document.documentElement.getAttribute('data-model-status') ?? '');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-model-status'] });
        vi.mocked(STTStrategyFactory.create).mockReturnValue({
            checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
            init: vi.fn().mockResolvedValue(Result.ok(undefined)),
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            terminate: vi.fn().mockResolvedValue(undefined),
            getEngineType: vi.fn().mockReturnValue('mock'),
        } as unknown as ReturnType<typeof STTStrategyFactory.create>);
    });

    const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

    it('RED: while preparing in the background, the page sees no `loading` model status and no status update', async () => {
        const service = makeService();
        (service as unknown as BackgroundCapable).setBackgroundPreparation?.(true);
        // Construction projects the fresh service's IDLE ("Ready") — the same page state the retired take left behind.
        // What must not reach the page is the WARM-UP, so only updates from here are the subject.
        statusUpdates = [];
        modelStatuses = [];
        await service.warmUp('private');
        await settle();
        expect(modelStatuses, 'the page never reads the warm-up as loading').not.toContain('loading');
        expect(statusUpdates.map((s) => s.type), 'no warm-up status reaches the page').toEqual([]);
        expect(document.documentElement.getAttribute('data-model-status')).toBe('idle');
    });

    it('the Start that claims it publishes the CURRENT state once', async () => {
        const service = makeService();
        (service as unknown as BackgroundCapable).setBackgroundPreparation?.(true);
        await service.warmUp('private');
        await settle();
        statusUpdates = [];
        (service as unknown as BackgroundCapable).setBackgroundPreparation?.(false);
        expect(document.documentElement.getAttribute('data-model-status')).toBe(
            ({ READY: 'ready', IDLE: 'idle', DOWNLOAD_REQUIRED: 'download-required' } as Record<string, string>)[service.getState()] ?? 'loading',
        );
        expect(statusUpdates.length).toBe(1);
    });

    it('control: a foreground warm-up (no background preparation) still publishes as before', async () => {
        const service = makeService();
        await service.warmUp('private');
        await settle();
        expect(modelStatuses.length, 'the ordinary path still publishes').toBeGreaterThan(0);
        expect(statusUpdates.length).toBeGreaterThan(0);
    });
});

/**
 * Sam's advisory review 6215165137 on 93d36c855 — every OTHER door to the page stays shut while preparing in the
 * background: the cached-init ready/failed store writes and toast (with its delayed progress clear), the strategy's
 * errors, and the direct availability statuses. The claim hands the user the genuine latest outcome, never swallowed.
 */
describe('#1258 finding A — no other publication escapes a background preparation (review 6215165137)', () => {
    type Callbacks = { onError?: (e: Error) => void; onReady?: () => void };
    let captured: Callbacks | null;
    let onError: ReturnType<typeof vi.fn>;
    let statusUpdates: SttStatus[];

    const strategy = (over: Record<string, unknown> = {}) => ({
        checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
        init: vi.fn().mockResolvedValue(Result.ok(undefined)),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        terminate: vi.fn().mockResolvedValue(undefined),
        getEngineType: vi.fn().mockReturnValue('transformers-js'),
        ...over,
    });
    const make = (over: Record<string, unknown> = {}) => {
        vi.mocked(STTStrategyFactory.create).mockImplementation(((_mode: unknown, callbacks: Callbacks) => {
            captured = callbacks;
            return strategy(over);
        }) as unknown as typeof STTStrategyFactory.create);
        return new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onStatusChange: (s: SttStatus) => statusUpdates.push(s),
            onError,
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn(),
            policy: { allowNative: false, allowPrivate: true, preferredMode: 'private', allowFallback: false, executionIntent: 'test' },
        } as unknown as ConstructorParameters<typeof TranscriptionService>[0]);
    };
    const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
    const background = (s: TranscriptionService, on: boolean) => (s as unknown as BackgroundCapable).setBackgroundPreparation?.(on);
    /** Construction projects the fresh service's IDLE ("Ready") — the state the retired take already left. The subject is
     *  everything AFTER the service enters background preparation, so the page is re-set to the review's own status. */
    const enterBackground = async (s: TranscriptionService) => {
        background(s, true);
        (await store()).setSTTStatus(FOREGROUND);
    };
    const FOREGROUND = { type: 'idle', message: 'review on screen' } as SttStatus;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useRealTimers();
        captured = null;
        onError = vi.fn();
        statusUpdates = [];
        const { useSessionStore } = await import('@/stores/useSessionStore');
        useSessionStore.getState().setSTTStatus(FOREGROUND);
        useSessionStore.getState().setModelLoadingProgress(null);
    });
    const store = async () => (await import('@/stores/useSessionStore')).useSessionStore.getState();

    it('control: a FOREGROUND cached init publishes ready — status, progress and the ready toast (Private mode is live here)', async () => {
        const s = make();
        await s.warmUp('private');
        await settle();
        expect((await store()).sttStatus.type).toBe('ready');
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('RED: a cached init in the background writes no ready status, no progress and no toast; the claim publishes them once', async () => {
        const s = make();
        await enterBackground(s);
        await s.warmUp('private');
        await settle();
        expect((await store()).sttStatus, 'the review page keeps its own status').toEqual(FOREGROUND);
        expect((await store()).modelLoadingProgress).toBeNull();
        expect(toast.success, 'no "Private ready" toast after every take').not.toHaveBeenCalled();
        background(s, false);
        expect((await store()).sttStatus.type, 'the claim publishes the genuine ready state').toBe('ready');
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('RED: a FAILED init in the background writes no init-failed status; the claim publishes the failure (never swallowed)', async () => {
        const s = make({ init: vi.fn().mockResolvedValue(Result.err(new Error('model load failed'))) });
        await enterBackground(s);
        await s.warmUp('private');
        await settle();
        expect((await store()).sttStatus).toEqual(FOREGROUND);
        background(s, false);
        expect((await store()).sttStatus.type, 'the claiming Start sees the genuine failure').toBe('init-failed');
    });

    it('RED: a strategy error in the background does not reach the controller; the claim delivers it', async () => {
        const s = make();
        background(s, true);
        await s.warmUp('private');
        await settle();
        const err = new Error('worker crashed');
        captured?.onError?.(err);
        expect(onError, 'no shared error/readiness reset while the review is on screen').not.toHaveBeenCalled();
        background(s, false);
        expect(onError).toHaveBeenCalledWith(err);
    });

    it('RED: an availability CACHE_MISS in the background publishes no download prompt; the claim shows it', async () => {
        const s = make({ checkAvailability: vi.fn().mockResolvedValue({ isAvailable: false, reason: 'CACHE_MISS' }) });
        background(s, true);
        statusUpdates = [];
        await s.warmUp('private');
        await settle();
        expect(statusUpdates, 'no download-required while preparing in the background').toEqual([]);
        background(s, false);
        expect(statusUpdates.map((u) => u.type)).toContain('download-required');
    });

    it('disposal: a background preparation that is destroyed unclaimed publishes nothing, then or later', async () => {
        const s = make({ init: vi.fn().mockResolvedValue(Result.err(new Error('model load failed'))) });
        await enterBackground(s);
        await s.warmUp('private');
        await settle();
        await s.destroy();
        await settle();
        expect((await store()).sttStatus).toEqual(FOREGROUND);
        expect(onError).not.toHaveBeenCalled();
    });

    it('RED: a background instance never schedules the delayed progress clear that would erase ANOTHER instance\'s progress', async () => {
        vi.useFakeTimers();
        const s = make();
        background(s, true);
        await s.warmUp('private');
        await vi.advanceTimersByTimeAsync(0);
        (await store()).setModelLoadingProgress(100); // the foreground owner's own progress
        await vi.advanceTimersByTimeAsync(6_000);
        expect((await store()).modelLoadingProgress, 'the background instance did not clear it').toBe(100);
        vi.useRealTimers();
    });
});
