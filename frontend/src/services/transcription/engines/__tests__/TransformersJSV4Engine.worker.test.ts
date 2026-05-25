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

type FakeWorkerMode = 'ready' | 'silent' | 'transcribe-result' | 'transcribe-error';

let fakeWorkerMode: FakeWorkerMode = 'ready';
const fakeWorkerInstances: FakeWorker[] = [];

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn((message: { id: number; type: string }) => {
        if (fakeWorkerMode === 'silent') return;

        queueMicrotask(() => {
            if (message.type === 'transcribe' && fakeWorkerMode === 'transcribe-result') {
                this.onmessage?.({
                    data: {
                        id: message.id,
                        type: 'result',
                        transcript: 'v4 worker transcript',
                        latencyMs: 37,
                        audioLengthSeconds: 1,
                        resultShape: 'text',
                    },
                } as MessageEvent);
                return;
            }

            if (message.type === 'transcribe' && fakeWorkerMode === 'transcribe-error') {
                this.onmessage?.({
                    data: {
                        id: message.id,
                        type: 'error',
                        errorName: 'Error',
                        errorMessage: 'v4 worker transcription failed',
                    },
                } as MessageEvent);
                return;
            }

            if (message.type === 'destroy') {
                this.onmessage?.({
                    data: { id: message.id, type: 'destroyed' },
                } as MessageEvent);
                return;
            }

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

describe('TransformersJSV4Engine worker message contract', () => {
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

    it('contract: init resolves when the v4 worker responds with ready', async () => {
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const result = await engine.init();

        expect(result.isOk).toBe(true);
        expect(fakeWorkerInstances).toHaveLength(1);
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'init', isE2E: false }),
            [],
        );

        await engine.destroy();
    });

    it('contract: init fails instead of hanging forever when the v4 worker never responds', async () => {
        vi.useFakeTimers();
        fakeWorkerMode = 'silent';
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const { PRIV_STT_V4 } = await import('../../sttConstants');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const initPromise = engine.init();
        await vi.advanceTimersByTimeAsync(PRIV_STT_V4.WORKER_REQUEST_TIMEOUT_MS);
        const result = await initPromise;

        expect(result.isOk).toBe(false);
        expect((result as { isOk: false; error: Error }).error.message).toContain('worker request timed out');
        expect(fakeWorkerInstances[0]?.terminate).toHaveBeenCalled();
    });

    it('contract: transcribe resolves with the v4 worker transcript result', async () => {
        fakeWorkerMode = 'transcribe-result';
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result).toEqual(expect.objectContaining({
            isOk: true,
            data: 'v4 worker transcript',
        }));
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'transcribe', audio: expect.any(Float32Array) }),
            expect.any(Array),
        );

        await engine.destroy();
    });

    it('contract: transcribe returns an error when the v4 worker reports failure', async () => {
        fakeWorkerMode = 'transcribe-error';
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result.isOk).toBe(false);
        expect((result as { isOk: false; error: Error }).error.message).toContain('v4 worker transcription failed');

        await engine.destroy();
    });
});
