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
