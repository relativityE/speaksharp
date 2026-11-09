// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';

const { mockPipeline, mockXenovaPipeline } = vi.hoisted(() => ({
    mockPipeline: vi.fn(),
    // The v2 (Xenova) main-thread engine, for the late-pipeline fence shared with v4 (review of 38253831).
    mockXenovaPipeline: vi.fn(),
}));

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

vi.mock('@huggingface/transformers', () => ({
    pipeline: mockPipeline,
    env: {},
    LogLevel: {
        ERROR: 'error',
        INFO: 'info',
    },
}));
vi.mock('@xenova/transformers', () => ({
    pipeline: mockXenovaPipeline,
    env: { backends: { onnx: { wasm: {} } } },
}));
vi.mock('../../capabilitySnapshot', () => ({ captureCapabilities: vi.fn(async () => Object.freeze({ webgpuAvailable: true, capturedAt: '2026-10-30T00:00:00Z', reason: 'detected' })) }));
vi.mock('posthog-js', () => ({ default: { isFeatureEnabled: vi.fn() } }));

type FakeWorkerMode = 'ready' | 'silent' | 'transcribe-result' | 'transcribe-error';

let fakeWorkerMode: FakeWorkerMode = 'ready';
// When set, the fake worker emits a 'loaded' message (carrying this resolved device) before 'ready',
// exactly like the real worker — so we can assert the engine publishes window.__PRIVATE_V4_RUNTIME__.
let fakeLoadedDevice: string | null = 'requested';
let fakeLoadedModel: string | null = null;
const fakeWorkerInstances: FakeWorker[] = [];

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn((message: { id: number; type: string; model?: string; device?: string; decodeOptions?: unknown }) => {
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

            if (message.type === 'init' && fakeLoadedDevice) {
                this.onmessage?.({
                    data: { id: message.id, type: 'loaded', loadTimeMs: 5, model: fakeLoadedModel ?? message.model, device: fakeLoadedDevice === 'requested' ? message.device ?? 'wasm-default' : fakeLoadedDevice },
                } as MessageEvent);
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
    // Guaranteed restore: one test removes Worker support to reach the main-thread branch, and an
    // assertion throwing before an inline restore would leave every later worker test on the wrong path.
    const RealWorker = globalThis.Worker;
    afterEach(() => { (globalThis as { Worker?: unknown }).Worker = RealWorker; });

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.mocked(posthog.isFeatureEnabled).mockReset().mockReturnValue(false);
        mockPipeline.mockReset();
        window.localStorage.clear();
        fakeWorkerMode = 'ready';
        fakeLoadedDevice = 'requested';
        fakeLoadedModel = null;
        delete (window as typeof window & { __PRIVATE_V4_RUNTIME__?: unknown }).__PRIVATE_V4_RUNTIME__;
        fakeWorkerInstances.length = 0;
        vi.stubGlobal('Worker', FakeWorker);
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        );
    });

    afterEach(() => {
        delete (window as typeof window & { __PRIVATE_STT_DECODE_OPTIONS__?: unknown }).__PRIVATE_STT_DECODE_OPTIONS__;
        delete (window as typeof window & { __PRIVATE_V4_RUNTIME__?: unknown }).__PRIVATE_V4_RUNTIME__;
        window.localStorage.clear();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('binds an internal evaluator attempt to the selected v4 model and variant', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: 'v4:base:q4', v4Variant: 'base_q4',
        } as never);

        const result = await engine.init();

        expect(result.isOk).toBe(true);
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'init', model: 'onnx-community/whisper-base.en',
                attempt: expect.objectContaining({ candidateId: 'v4:base:q4' }),
            }),
            [],
        );
        await engine.destroy();
    });

    it('refuses evaluator selection outside an internal build before worker init', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'false');
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: 'v4:base:q4', v4Variant: 'base_q4',
        } as never);

        const result = await engine.init();

        expect(result.isOk).toBe(false);
        expect(fakeWorkerInstances).toHaveLength(0);
    });

    it.each([
        ['v4:base:q4', 'base_q4', 'wasm'], ['v4:base:q4', 'base_q4', 'webgpu'],
        ['v4:distil:q4', 'distil_q4', 'wasm'], ['v4:distil:q4', 'distil_q4', 'webgpu'],
    ] as const)('threads declared evaluator backend %s/%s/%s into worker initialization', async (candidateId, variant, backend) => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: candidateId, v4Variant: variant, evaluatorBackend: backend,
        } as never);
        try {
            expect((await engine.init()).isOk).toBe(true);
            expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'init', device: backend }), [],
            );
        } finally { await engine.destroy(); }
    });

    it.each([
        ['v4:base:q4', 'wasm'], ['v4:base:q4', 'webgpu'],
        ['v4:distil:q4', 'wasm'], ['v4:distil:q4', 'webgpu'],
    ] as const)('threads the local evaluator page backend for %s/%s', async (candidateId, backend) => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        vi.resetModules();
        await import('../../../../benchmark/model-evaluator-local');
        try {
            // This positive backend-propagation scenario explicitly permits cold acquisition.
            await window.__MODEL_EVALUATOR__!.initialize(candidateId, backend, true);
            expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'init', device: backend }), [],
            );
        } finally { await window.__MODEL_EVALUATOR__?.dispose(); }
    });

    it('rejects an invalid evaluator backend before worker creation', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: 'v4:base:q4', v4Variant: 'base_q4', evaluatorBackend: 'cpu',
        } as never);
        expect((await engine.init()).isOk).toBe(false);
        expect(fakeWorkerInstances).toHaveLength(0);
    });

    it('rejects an invalid page backend before engine creation', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        vi.resetModules();
        await import('../../../../benchmark/model-evaluator-local');
        await expect(window.__MODEL_EVALUATOR__!.initialize('v4:base:q4', 'cpu' as never))
            .rejects.toThrow('unsupported model evaluator backend');
        expect(fakeWorkerInstances).toHaveLength(0);
    });

    it('does not apply evaluator backend options to an ordinary product attempt', async () => {
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ evaluatorBackend: 'webgpu' } as never);
        try {
            expect((await engine.init()).isOk).toBe(true);
            expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'init', device: undefined }), [],
            );
        } finally { await engine.destroy(); }
    });

    it('refuses evaluator selection when the remote safety kill forces v2', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        vi.mocked(posthog.isFeatureEnabled).mockReturnValue(true);
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: 'v4:base:q4', v4Variant: 'base_q4',
        } as never);

        const result = await engine.init();

        expect(result.isOk).toBe(false);
        expect(fakeWorkerInstances).toHaveLength(0);
    });

    it('refuses an evaluator candidate whose loaded v4 variant differs', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: 'v4:distil:q4', v4Variant: 'base_q4',
        } as never);

        const result = await engine.init();

        expect(result.isOk).toBe(false);
        expect(fakeWorkerInstances).toHaveLength(0);
    });

    it('refuses evaluator selection when the browser cannot use the worker path', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        (globalThis as { Worker?: unknown }).Worker = undefined;
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({
            evaluatorCandidateId: 'v4:base:q4', v4Variant: 'base_q4',
        } as never);

        const result = await engine.init();

        expect(result.isOk).toBe(false);
        expect((result as { isOk: false; error: Error }).error.message).toContain('worker path');
        expect(mockPipeline).not.toHaveBeenCalled();
        expect(fakeWorkerInstances).toHaveLength(0);
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

    it('contract: sends sanitized decode-option overrides from the browser proof hook', async () => {
        fakeWorkerMode = 'transcribe-result';
        (window as typeof window & { __PRIVATE_STT_DECODE_OPTIONS__?: unknown }).__PRIVATE_STT_DECODE_OPTIONS__ = {
            condition_on_previous_text: false,
            compression_ratio_threshold: 2.4,
            unsafe_option: 'ignored',
        };
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result.isOk).toBe(true);
        expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'transcribe',
                decodeOptions: expect.objectContaining({
                    chunk_length_s: expect.any(Number),
                    stride_length_s: expect.any(Number),
                    return_timestamps: true,
                    condition_on_previous_text: false,
                    compression_ratio_threshold: 2.4,
                }),
            }),
            expect.any(Array),
        );

        const sent = fakeWorkerInstances[0]?.postMessage.mock.calls.find(([request]) => request.type === 'transcribe')?.[0];
        expect(sent?.decodeOptions).not.toHaveProperty('unsafe_option');
        await engine.destroy();
    });

    it('contract: applies sanitized decode-option overrides in the v4 main-thread no-worker path', async () => {
        const mainThreadTranscriber = vi.fn()
            .mockResolvedValueOnce({ text: '' })
            .mockResolvedValueOnce({ text: 'v4 main-thread transcript' });
        mockPipeline.mockResolvedValueOnce(mainThreadTranscriber);
        // REACH THE MAIN-THREAD PATH WITHOUT A SELECTOR. This used `speaksharp.v4.noWorker`, a
        // retired localStorage channel. `shouldUseWorker()` also requires Worker support, so removing
        // it exercises the same branch through a REAL condition (a browser without workers) rather
        // than through an override that no longer exists.
        (globalThis as { Worker?: unknown }).Worker = undefined;
        (window as typeof window & { __PRIVATE_STT_DECODE_OPTIONS__?: unknown }).__PRIVATE_STT_DECODE_OPTIONS__ = {
            condition_on_previous_text: false,
            no_repeat_ngram_size: 3,
            unsafe_option: 'ignored',
        };
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const init = await engine.init();
        const result = await engine.transcribe(new Float32Array(16000));

        expect(init.isOk).toBe(true);
        expect(result).toEqual(expect.objectContaining({
            isOk: true,
            data: 'v4 main-thread transcript',
        }));
        expect(fakeWorkerInstances).toHaveLength(0);
        const transcribeOptions = mainThreadTranscriber.mock.calls[mainThreadTranscriber.mock.calls.length - 1]?.[1] as Record<string, unknown>;
        expect(transcribeOptions).toEqual(expect.objectContaining({
            condition_on_previous_text: false,
            no_repeat_ngram_size: 3,
            return_timestamps: true,
        }));
        expect(transcribeOptions).not.toHaveProperty('unsafe_option');

        await engine.destroy();
    });

    // Elon/Sam review of 38253831 (P2): the main-thread pipeline() cannot be aborted, so a destroy during the load let it
    // publish itself afterwards, undisposed, possibly over the transcriber of the lifetime that followed.
    it('a main-thread pipeline completing after teardown is disposed and never replaces the successor', async () => {
        (globalThis as { Worker?: unknown }).Worker = undefined;
        let resolveFirst!: (value: unknown) => void;
        mockPipeline.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });
        const stale = engine.init();
        await vi.waitFor(() => expect(mockPipeline).toHaveBeenCalledTimes(1));
        await engine.destroy();
        const successor = Object.assign(vi.fn(async () => ({ text: '' })), { dispose: vi.fn(async () => undefined) });
        mockPipeline.mockResolvedValueOnce(successor);
        expect((await engine.init()).isOk).toBe(true);
        const late = Object.assign(vi.fn(async () => ({ text: '' })), { dispose: vi.fn(async () => undefined) });
        resolveFirst(late);
        expect((await stale).isOk).toBe(false);
        await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledTimes(1));
        expect((engine as unknown as { transcriber: unknown }).transcriber).toBe(successor);
        expect(successor.dispose).not.toHaveBeenCalled();
        await engine.destroy();
    });

    // The same fence on the v2 (Xenova) main-thread engine, which happy-dom always runs on the main thread.
    describe('v2 main-thread pipeline completing after teardown', () => {
        const latePipeline = () => Object.assign(vi.fn(async () => ({ text: '' })), { dispose: vi.fn(async () => undefined) });
        // Reach the main-thread branch through the real condition (no Worker support), as the v4 cases above do.
        beforeEach(() => { mockXenovaPipeline.mockReset(); (globalThis as { Worker?: unknown }).Worker = undefined; });

        it('is disposed and never published when the engine was destroyed during the load', async () => {
            let resolveLoad!: (value: unknown) => void;
            mockXenovaPipeline.mockImplementationOnce(() => new Promise(resolve => { resolveLoad = resolve; }));
            const { TransformersJSEngine } = await import('../TransformersJSEngine');
            const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });
            const init = engine.init();
            await vi.waitFor(() => expect(mockXenovaPipeline).toHaveBeenCalledTimes(1));
            await engine.destroy();
            const late = latePipeline();
            resolveLoad(late);
            expect((await init).isOk).toBe(false);
            await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledTimes(1));
            expect((engine as unknown as { transcriber: unknown }).transcriber).toBeNull();
        });

        it('cannot replace the transcriber of the lifetime that followed the teardown', async () => {
            let resolveFirst!: (value: unknown) => void;
            mockXenovaPipeline.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
            const { TransformersJSEngine } = await import('../TransformersJSEngine');
            const engine = new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });
            const stale = engine.init();
            await vi.waitFor(() => expect(mockXenovaPipeline).toHaveBeenCalledTimes(1));
            await engine.destroy();
            const successor = latePipeline();
            mockXenovaPipeline.mockResolvedValueOnce(successor);
            expect((await engine.init()).isOk).toBe(true);
            const late = latePipeline();
            resolveFirst(late);
            expect((await stale).isOk).toBe(false);
            await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledTimes(1));
            expect((engine as unknown as { transcriber: unknown }).transcriber).toBe(successor);
            expect(successor.dispose).not.toHaveBeenCalled();
            await engine.destroy();
        });
    });

    // Independent review of 12552563 (P3): v4's progress floor survived teardown, so a re-init of the same engine reported no
    // worker progress until it passed the previous run's highest value (none at all after a run that reached 100).
    it('v4: a re-init reports worker progress from the start again', async () => {
        (globalThis as { Worker?: unknown }).Worker = undefined;
        const onModelLoadProgress = vi.fn();
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onModelLoadProgress, onTranscriptUpdate: vi.fn() });
        const report = (value: number) => (engine as unknown as { reportModelProgress(p: number): void }).reportModelProgress(value);
        report(100);
        expect(onModelLoadProgress).toHaveBeenCalledWith(100);
        await engine.destroy();
        mockPipeline.mockResolvedValueOnce(Object.assign(vi.fn(async () => ({ text: '' })), { dispose: vi.fn(async () => undefined) }));
        expect((await engine.init()).isOk).toBe(true);
        onModelLoadProgress.mockClear();
        report(40);
        expect(onModelLoadProgress).toHaveBeenCalledWith(40);
        await engine.destroy();
    });

    // Sam's review of c1585147: two races the post-pipeline fence alone missed, on both engines.
    // (1) A teardown inside the earlier `import(...)` await let the stale attempt capture the NEW generation, pass the
    //     fence and publish over the successor. (2) A stale load failing late ran the shared failure cleanup, tearing
    //     down state the successor owned. The attempt's generation is now captured at loadModel entry.
    describe('a stale main-thread attempt never touches its successor (both engines)', () => {
        type Engine = { init(): Promise<{ isOk: boolean }>; destroy(): Promise<void> };
        const engines: Array<{ name: string; mock: typeof mockPipeline; make: () => Promise<Engine> }> = [
            { name: 'v2', mock: mockXenovaPipeline, make: async () => {
                const { TransformersJSEngine } = await import('../TransformersJSEngine');
                return new TransformersJSEngine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() }) as unknown as Engine;
            } },
            { name: 'v4', mock: mockPipeline, make: async () => {
                const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
                return new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() }) as unknown as Engine;
            } },
        ];
        const pipe = () => Object.assign(vi.fn(async () => ({ text: '' })), { dispose: vi.fn(async () => undefined) });
        beforeEach(() => { mockXenovaPipeline.mockReset(); (globalThis as { Worker?: unknown }).Worker = undefined; });

        for (const { name, mock, make } of engines) {
            it(`${name}: a teardown during the module import cannot let the stale load publish over the successor`, async () => {
                const pending: Array<(value: unknown) => void> = [];
                mock.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
                const engine = await make();
                const stale = engine.init();          // suspends inside `await import(...)`
                await engine.destroy();               // teardown before the stale attempt reaches pipeline()
                const successorInit = engine.init();
                await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
                await new Promise(resolve => setTimeout(resolve, 25)); // let a stale attempt reach pipeline() too, if it can
                const pipes = pending.map(() => pipe());
                for (let i = pending.length - 1; i >= 0; i--) pending[i](pipes[i]); // the successor's load settles first
                expect((await successorInit).isOk).toBe(true);
                expect((await stale).isOk).toBe(false);
                const successor = pipes[pipes.length - 1];
                await vi.waitFor(() => expect((engine as unknown as { transcriber: unknown }).transcriber).toBe(successor));
                await new Promise(resolve => setTimeout(resolve, 25));
                expect((engine as unknown as { transcriber: unknown }).transcriber).toBe(successor);
                expect(successor.dispose).not.toHaveBeenCalled();
                for (const other of pipes.slice(0, -1)) expect(other.dispose).toHaveBeenCalledTimes(1);
                // Review of 29c088e4: the stale attempt stops right after the import, so it never starts a download.
                expect(mock).toHaveBeenCalledTimes(1);
                await engine.destroy();
            });

            it(`${name}: a stale load that fails late leaves the successor's state alone`, async () => {
                let rejectStale!: (error: unknown) => void;
                mock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStale = reject; }));
                const engine = await make();
                const stale = engine.init();
                await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
                await engine.destroy();
                const successor = pipe();
                mock.mockResolvedValueOnce(successor);
                expect((await engine.init()).isOk).toBe(true);
                // Successor-owned state the shared failure cleanup would clear.
                const state = engine as unknown as { transcriber: unknown; runtimeEvidence: unknown; activeLoadRequestId: unknown; pendingWorkerRequests: Map<number, unknown> } & Record<string, unknown>;
                const evidence = { marker: 'successor' };
                state.runtimeEvidence = evidence;
                // Elon's review of c1585147: the successor's verified-fetch hook (v2 restorePackageFetch, v4 restoreAssetFetch).
                const hookField = name === 'v2' ? 'restorePackageFetch' : 'restoreAssetFetch';
                const successorHook = vi.fn();
                state[hookField] = successorHook;
                state.activeLoadRequestId = 7;
                const request = { resolve: vi.fn(), reject: vi.fn(), timeoutId: setTimeout(() => undefined, 60_000) };
                state.pendingWorkerRequests.set(7, request);
                rejectStale(new Error('stale load failed late'));
                expect((await stale).isOk).toBe(false);
                expect(state.transcriber).toBe(successor);
                expect(state.runtimeEvidence).toBe(evidence);
                expect(state.activeLoadRequestId).toBe(7);
                expect(state.pendingWorkerRequests.get(7)).toBe(request);
                expect(request.reject).not.toHaveBeenCalled();
                expect(state[hookField]).toBe(successorHook);
                expect(successorHook).not.toHaveBeenCalled();
                state[hookField] = null;
                clearTimeout(request.timeoutId);
                state.pendingWorkerRequests.clear();
                await engine.destroy();
            });

            // Elon's review of c1585147: a worker attempt superseded while its worker started must not report ready.
            it(`${name}: a worker start-up that completes after teardown reports nothing ready`, async () => {
                const onReady = vi.fn();
                const onModelLoadProgress = vi.fn();
                const { TransformersJSEngine } = await import('../TransformersJSEngine');
                const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
                const Ctor = (name === 'v2' ? TransformersJSEngine : TransformersJSV4Engine) as unknown as new (o: unknown) => Engine;
                const engine = new Ctor({ onReady, onModelLoadProgress, onTranscriptUpdate: vi.fn() });
                const seam = engine as unknown as { shouldUseWorker: () => boolean; initWorker: () => Promise<void> };
                vi.spyOn(seam, 'shouldUseWorker').mockReturnValue(true);
                let finishStale!: () => void;
                vi.spyOn(seam, 'initWorker')
                    .mockImplementationOnce(() => new Promise<void>(resolve => { finishStale = resolve; }))
                    .mockResolvedValueOnce(undefined);
                const stale = engine.init();
                await vi.waitFor(() => expect(seam.initWorker).toHaveBeenCalledTimes(1));
                await engine.destroy();
                expect((await engine.init()).isOk).toBe(true);
                const readyCalls = onReady.mock.calls.length;
                const progressCalls = onModelLoadProgress.mock.calls.length;
                finishStale();
                expect((await stale).isOk).toBe(false);
                expect(onReady).toHaveBeenCalledTimes(readyCalls);
                expect(onModelLoadProgress).toHaveBeenCalledTimes(progressCalls);
                await engine.destroy();
            });

            // Review of 29c088e4: the un-abortable download's progress callback keeps firing after teardown.
            it(`${name}: a stale download reports no progress after teardown, even once the successor is ready`, async () => {
                let report!: (data: unknown) => void;
                let finishStale!: (value: unknown) => void;
                mock.mockImplementationOnce((_task: unknown, _model: unknown, options: { progress_callback: (data: unknown) => void }) => {
                    report = options.progress_callback;
                    return new Promise(resolve => { finishStale = resolve; });
                });
                const onModelLoadProgress = vi.fn();
                const { TransformersJSEngine } = await import('../TransformersJSEngine');
                const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
                const Ctor = (name === 'v2' ? TransformersJSEngine : TransformersJSV4Engine) as unknown as new (o: unknown) => Engine;
                const engine = new Ctor({ onReady: vi.fn(), onModelLoadProgress, onTranscriptUpdate: vi.fn() });
                const stale = engine.init();
                await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
                await engine.destroy();
                mock.mockResolvedValueOnce(pipe());
                expect((await engine.init()).isOk).toBe(true);
                onModelLoadProgress.mockClear();
                report({ progress: 42 });
                expect(onModelLoadProgress).not.toHaveBeenCalled();
                finishStale(pipe());
                expect((await stale).isOk).toBe(false);
                await engine.destroy();
            });

            // Review of 29c088e4: the worker's progress during the teardown round trip belongs to no live attempt.
            it(`${name}: worker progress arriving while teardown awaits the worker is not reported`, async () => {
                (globalThis as { Worker?: unknown }).Worker = FakeWorker as unknown as typeof Worker;
                fakeWorkerMode = 'silent';
                const onModelLoadProgress = vi.fn();
                const onReady = vi.fn();
                const { TransformersJSEngine } = await import('../TransformersJSEngine');
                const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
                const Ctor = (name === 'v2' ? TransformersJSEngine : TransformersJSV4Engine) as unknown as new (o: unknown) => Engine;
                const engine = new Ctor({ onReady, onModelLoadProgress, onTranscriptUpdate: vi.fn() });
                vi.spyOn(engine as unknown as { shouldUseWorker: () => boolean }, 'shouldUseWorker').mockReturnValue(true);
                const stale = engine.init();
                await vi.waitFor(() => expect(fakeWorkerInstances[0]?.postMessage).toHaveBeenCalledTimes(1));
                const worker = fakeWorkerInstances[0];
                const destroying = engine.destroy();
                await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2)); // the destroy request is out
                const initId = worker.postMessage.mock.calls[0][0].id;
                const destroyId = worker.postMessage.mock.calls[1][0].id;
                const progressBefore = onModelLoadProgress.mock.calls.length;
                worker.onmessage?.({ data: { id: initId, type: 'progress', progress: 55 } } as MessageEvent);
                expect(onModelLoadProgress).toHaveBeenCalledTimes(progressBefore);
                worker.onmessage?.({ data: { id: initId, type: 'ready' } } as MessageEvent);
                worker.onmessage?.({ data: { id: destroyId, type: 'destroyed' } } as MessageEvent);
                await destroying;
                expect((await stale).isOk).toBe(false);
                expect(onReady).not.toHaveBeenCalled();
            });

            // Elon's review of 12552563 (P3): teardown released the published main-thread pipeline by dropping the reference only.
            it(`${name}: teardown disposes the published main-thread pipeline, and a failing dispose does not fail teardown`, async () => {
                const { TransformersJSEngine } = await import('../TransformersJSEngine');
                const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
                const Ctor = (name === 'v2' ? TransformersJSEngine : TransformersJSV4Engine) as unknown as new (o: unknown) => Engine;
                const engine = new Ctor({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });
                const published = pipe();
                mock.mockResolvedValueOnce(published);
                expect((await engine.init()).isOk).toBe(true);
                await engine.destroy();
                expect(published.dispose).toHaveBeenCalledTimes(1);
                expect((engine as unknown as { transcriber: unknown }).transcriber).toBeNull();
                const failing = Object.assign(vi.fn(async () => ({ text: '' })), { dispose: vi.fn(async () => { throw new Error('dispose failed'); }) });
                mock.mockResolvedValueOnce(failing);
                expect((await engine.init()).isOk).toBe(true);
                await expect(engine.destroy()).resolves.toBeUndefined();
                expect(failing.dispose).toHaveBeenCalledTimes(1);
                mock.mockResolvedValueOnce(pipe());
                expect((await engine.init()).isOk).toBe(true); // a failed dispose leaves no sticky teardown failure
                await engine.destroy();
            });

            // Elon's review of c1585147: a teardown during the post-publish warm-up.
            it(`${name}: a teardown during warm-up leaves nothing ready for the attempt that follows`, async () => {
                const onReady = vi.fn();
                const { TransformersJSEngine } = await import('../TransformersJSEngine');
                const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
                const Ctor = (name === 'v2' ? TransformersJSEngine : TransformersJSV4Engine) as unknown as new (o: unknown) => Engine;
                const engine = new Ctor({ onReady, onTranscriptUpdate: vi.fn() });
                let finishWarmUp!: (value: unknown) => void;
                const warming = Object.assign(vi.fn(() => new Promise(resolve => { finishWarmUp = resolve; })), { dispose: vi.fn(async () => undefined) });
                mock.mockResolvedValueOnce(warming);
                const stale = engine.init();
                await vi.waitFor(() => expect(warming).toHaveBeenCalledTimes(1)); // warm-up is running
                await engine.destroy();
                const successor = pipe();
                mock.mockResolvedValueOnce(successor);
                expect((await engine.init()).isOk).toBe(true);
                const readyCalls = onReady.mock.calls.length;
                finishWarmUp({ text: '' });
                expect((await stale).isOk).toBe(false);
                expect(onReady).toHaveBeenCalledTimes(readyCalls);
                expect((engine as unknown as { transcriber: unknown }).transcriber).toBe(successor);
                await engine.destroy();
            });
        }
    });

    it.each(['missing', 'wrong-model', 'wrong-backend'] as const)('refuses ready with %s runtime evidence', async (mode) => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        if (mode === 'missing') fakeLoadedDevice = null;
        if (mode === 'wrong-model') fakeLoadedModel = 'unrequested/model';
        if (mode === 'wrong-backend') fakeLoadedDevice = 'webgpu';
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ evaluatorCandidateId: 'v4:base:q4', v4Variant: 'base_q4', evaluatorBackend: 'wasm' } as never);
        try {
            expect((await engine.init()).isOk).toBe(false);
        } finally { await engine.destroy(); }
    });

    it('publishes window.__PRIVATE_V4_RUNTIME__ with the resolved WASM device/backend on worker load', async () => {
        fakeLoadedDevice = 'wasm-default';
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        const result = await engine.init();

        expect(result.isOk).toBe(true);
        const runtime = (window as typeof window & {
            __PRIVATE_V4_RUNTIME__?: { resolvedDevice?: string; backend?: string; modelId?: string; modelSource?: string };
        }).__PRIVATE_V4_RUNTIME__;
        expect(runtime).toBeDefined();
        expect(runtime?.resolvedDevice).toBe('wasm-default');
        expect(runtime?.backend).toBe('wasm');
        expect(runtime?.modelId).toBe('onnx-community/whisper-base.en');
        expect(runtime?.modelSource).toBe('hf');

        await engine.destroy();
    });

    it('marks __PRIVATE_V4_RUNTIME__ backend as webgpu when the worker resolves to WebGPU', async () => {
        fakeLoadedDevice = 'webgpu';
        const { TransformersJSV4Engine } = await import('../TransformersJSV4Engine');
        const engine = new TransformersJSV4Engine({ onReady: vi.fn(), onTranscriptUpdate: vi.fn() });

        await engine.init();

        const runtime = (window as typeof window & {
            __PRIVATE_V4_RUNTIME__?: { resolvedDevice?: string; backend?: string };
        }).__PRIVATE_V4_RUNTIME__;
        expect(runtime?.resolvedDevice).toBe('webgpu');
        expect(runtime?.backend).toBe('webgpu');

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
