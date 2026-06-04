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

type FakeWorkerMessage = { id: number; type: string; audio?: Float32Array; decodeOptions?: Record<string, unknown> };

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn((message: FakeWorkerMessage) => {
        if (fakeWorkerMode === 'silent') return;

        queueMicrotask(() => {
            if (message.type === 'transcribe' && fakeWorkerMode === 'transcribe-result') {
                this.onmessage?.({
                    data: {
                        id: message.id,
                        type: 'result',
                        transcript: 'worker transcript',
                        latencyMs: 42,
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
                        errorMessage: 'worker transcription failed',
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

    it('contract: transcribe resolves with the worker transcript result', async () => {
        fakeWorkerMode = 'transcribe-result';
        const { TransformersJSEngine } = await import('../TransformersJSEngine');
        const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result).toEqual(expect.objectContaining({
            isOk: true,
            data: 'worker transcript',
        }));
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'transcribe', audio: expect.any(Float32Array) }),
            expect.any(Array),
        );

        await engine.destroy();
    });

    it('contract: sends sanitized decode-option overrides from the browser proof hook', async () => {
        fakeWorkerMode = 'transcribe-result';
        window.__PRIVATE_STT_DECODE_OPTIONS__ = {
            condition_on_previous_text: false,
            compression_ratio_threshold: 2.4,
            unsafe_option: 'ignored',
        };
        const { TransformersJSEngine } = await import('../TransformersJSEngine');
        const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result.isOk).toBe(true);
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'transcribe',
                decodeOptions: {
                    condition_on_previous_text: false,
                    compression_ratio_threshold: 2.4,
                },
            }),
            expect.any(Array),
        );

        await engine.destroy();
    });

    it('contract: transcribe returns an error when the worker reports failure', async () => {
        fakeWorkerMode = 'transcribe-error';
        const { TransformersJSEngine } = await import('../TransformersJSEngine');
        const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result.isOk).toBe(false);
        expect((result as { isOk: false; error: Error }).error.message).toContain('worker transcription failed');

        await engine.destroy();
    });
});
