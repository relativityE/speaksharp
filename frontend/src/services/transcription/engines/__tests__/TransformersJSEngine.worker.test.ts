// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/TestFlags', () => ({
    ENV: {
        isE2E: false,
        isTest: false,
        debug: false,
    },
}));

vi.mock('@/lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

type FakeWorkerMode = 'ready' | 'silent';

let fakeWorkerMode: FakeWorkerMode = 'ready';
const fakeWorkerInstances: FakeWorker[] = [];

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn((message: { id: number; type: string }) => {
        if (fakeWorkerMode === 'silent') return;

        queueMicrotask(() => {
            this.onmessage?.({
                data: { id: message.id, type: 'ready' },
            } as MessageEvent);
        });
    });
    terminate = vi.fn();

    constructor() {
        fakeWorkerInstances.push(this);
    }
}

describe('TransformersJSEngine worker message contract', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        fakeWorkerMode = 'ready';
        fakeWorkerInstances.length = 0;
        vi.stubGlobal('Worker', FakeWorker);
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('contract: init resolves when the worker responds with ready', async () => {
        const { TransformersJSEngine } = await import('../TransformersJSEngine');
        const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const result = await engine.init();

        expect(result.isOk).toBe(true);
        expect(fakeWorkerInstances).toHaveLength(1);
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'init', isE2E: false }),
            [],
        );

        await engine.destroy();
    });

    it('contract: init fails instead of hanging forever when the worker never responds', async () => {
        vi.useFakeTimers();
        fakeWorkerMode = 'silent';
        const { TransformersJSEngine, TRANSFORMERS_WORKER_REQUEST_TIMEOUT_MS } = await import('../TransformersJSEngine');
        const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const initPromise = engine.init();
        await vi.advanceTimersByTimeAsync(TRANSFORMERS_WORKER_REQUEST_TIMEOUT_MS);
        const result = await initPromise;

        expect(result.isOk).toBe(false);
        expect((result as { isOk: false; error: Error }).error.message).toContain('worker request timed out');
        expect(fakeWorkerInstances[0]?.terminate).toHaveBeenCalled();
    });
});
