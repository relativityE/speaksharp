// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STTEngine } from '@/contracts/STTEngine';
import { Result } from '../../modes/types';
import { sttRegistry, type EngineFactory } from '../../STTRegistry';
import type { CandidateId } from '../../candidateRegistry';
import { PrivateSTT } from '../PrivateSTT';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

type WhisperKind = 'transformers-js' | 'transformers-js-v4';
class ControlledWhisper extends STTEngine {
    readonly load = deferred<Result<void, Error>>();
    readonly entered = deferred<void>();
    loading = false;
    constructor(readonly type: WhisperKind) { super(); }
    readonly beginLoad = vi.fn(() => {
        this.loading = true;
        this.entered.resolve(undefined);
        return this.load.promise;
    });
    protected onInit = this.beginLoad;
    readonly onStart = vi.fn(async () => {});
    readonly onStop = vi.fn(async () => {});
    readonly onPause = vi.fn(async () => {});
    readonly onResume = vi.fn(async () => {});
    readonly onDestroy = vi.fn(async () => { this.loading = false; });
    readonly transcribe = vi.fn(async (_audio: Float32Array) => Result.ok('fixture segment'));
}

let children: ControlledWhisper[];
let facades: PrivateSTT[];
let attempts: Array<Promise<Result<void, Error>>>;

function mount(kind: WhisperKind, candidateId: CandidateId) {
    const first = new ControlledWhisper(kind);
    const second = new ControlledWhisper(kind);
    children.push(first, second);
    const queue = [first, second];
    const factory = vi.fn<EngineFactory>(() => {
        const engine = queue.shift();
        if (!engine) throw new Error('Unexpected extra Whisper acquisition');
        return engine;
    });
    sttRegistry.register(kind, factory);
    const facade = new PrivateSTT({ forceEngine: kind, evaluatorCandidateId: candidateId,
        evaluatorBackend: 'wasm', onReady: vi.fn(), onTranscriptUpdate: vi.fn() });
    facades.push(facade);
    return { facade, first, second, factory };
}
function initialize(facade: PrivateSTT) {
    const attempt = facade.init();
    attempts.push(attempt);
    return attempt;
}

beforeEach(() => {
    children = []; facades = []; attempts = [];
    sttRegistry.clear();
    window.localStorage.clear();
    vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
});
afterEach(async () => {
    // Also settle the unfixed implementation, so the negative control fails assertions without hanging.
    for (const child of children) child.load.resolve(Result.err(new Error('fixture cleanup')));
    await Promise.allSettled(attempts);
    await Promise.allSettled(facades.map(facade => facade.terminate()));
    await Promise.allSettled(children.map(child => child.terminate()));
    sttRegistry.clear();
    vi.unstubAllEnvs();
});

describe.each([
    ['transformers-js', 'v2:base.en'],
    ['transformers-js-v4', 'v4:base:q4'],
] as const)('%s pending acquisition ownership', (kind, candidateId) => {
    it('initializes, starts, decodes and retires the selected child normally', async () => {
        const { facade, first, factory } = mount(kind, candidateId);
        const pending = initialize(facade);
        await first.entered.promise;
        first.load.resolve(Result.ok(undefined));
        expect((await pending).isOk).toBe(true);
        expect(facade.getMetadata().candidateId).toBe(candidateId);
        await facade.start();
        expect(first.onStart).toHaveBeenCalledOnce();
        expect(await facade.transcribe(new Float32Array([0.25]))).toEqual(Result.ok('fixture segment'));
        await facade.terminate();
        expect(first.onDestroy).toHaveBeenCalledOnce();
        expect(factory).toHaveBeenCalledOnce();
    });

    it.each(['destroy', 'terminate'] as const)('%s releases a loading child before retirement resolves', async (operation) => {
        const { facade, first } = mount(kind, candidateId);
        const pending = initialize(facade);
        await first.entered.promise;
        await facade[operation]();
        const loadingAfterRetirement = first.loading;
        const releasesAtRetirement = first.onDestroy.mock.calls.length;
        first.load.resolve(Result.ok(undefined));
        expect((await pending).isOk).toBe(false);
        expect(loadingAfterRetirement).toBe(false);
        expect(releasesAtRetirement).toBe(1);
        expect(first.onDestroy).toHaveBeenCalledOnce();
        await expect(facade.start()).rejects.toThrow(/not initialized/);
    });

    it('releases A before B starts and a stale completion cannot retire B', async () => {
        const { facade, first, second } = mount(kind, candidateId);
        const old = initialize(facade);
        await first.entered.promise;
        await facade.terminate();
        const loadingBeforeReplacement = first.loading;
        const fresh = initialize(facade);
        await second.entered.promise;
        second.load.resolve(Result.ok(undefined));
        expect((await fresh).isOk).toBe(true);
        first.load.resolve(Result.ok(undefined));
        expect((await old).isOk).toBe(false);
        expect(loadingBeforeReplacement).toBe(false);
        expect(first.onDestroy).toHaveBeenCalledOnce();
        expect(second.onDestroy).not.toHaveBeenCalled();
        await facade.start();
        expect(second.onStart).toHaveBeenCalledOnce();
    });

    it('releases a rejected init and permits a clean next acquisition', async () => {
        const { facade, first, second } = mount(kind, candidateId);
        const pending = initialize(facade);
        await first.entered.promise;
        first.load.reject(new Error('worker load rejected'));
        expect(await pending).toMatchObject({ isOk: false, error: expect.objectContaining({ message: 'worker load rejected' }) });
        expect(first.onDestroy).toHaveBeenCalledOnce();
        expect(first.loading).toBe(false);
        const fresh = initialize(facade);
        await second.entered.promise;
        second.load.resolve(Result.ok(undefined));
        expect((await fresh).isOk).toBe(true);
        await facade.start();
        expect(second.onStart).toHaveBeenCalledOnce();
    });

    it('releases a Result failure without retrying its cleanup', async () => {
        const { facade, first } = mount(kind, candidateId);
        const pending = initialize(facade);
        await first.entered.promise;
        first.load.resolve(Result.err(new Error('worker init refused')));
        expect(await pending).toMatchObject({ isOk: false, error: expect.objectContaining({ message: 'worker init refused' }) });
        await facade.terminate();
        expect(first.onDestroy).toHaveBeenCalledOnce();
        expect(first.loading).toBe(false);
    });

    it('a reused static child has fresh shutdown proof and waits for its current retirement', async () => {
        const { facade, first, factory } = mount(kind, candidateId);
        factory.mockImplementation(() => first);
        first.load.resolve(Result.err(new Error('CACHE_MISS')));
        expect((await initialize(facade)).isOk).toBe(false);
        expect(first.onDestroy).toHaveBeenCalledOnce();
        first.beginLoad.mockImplementationOnce(() => {
            first.loading = true;
            return Promise.resolve(Result.ok(undefined));
        });
        expect((await initialize(facade)).isOk).toBe(true);
        const release = deferred<void>();
        first.onDestroy.mockImplementationOnce(async () => { await release.promise; first.loading = false; });
        let settled = false;
        const retiring = facade.terminate().then(() => { settled = true; });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const settledBeforeCurrentRelease = settled;
        const callsBeforeCurrentRelease = first.onDestroy.mock.calls.length;
        release.resolve(undefined);
        await retiring;
        expect(settledBeforeCurrentRelease).toBe(false);
        expect(callsBeforeCurrentRelease).toBe(2);
        expect(first.loading).toBe(false);
    });

    it('an old continuation cannot release or untrack a new pending lifetime of the same object', async () => {
        const { facade, first, factory } = mount(kind, candidateId);
        factory.mockImplementation(() => first);
        const old = initialize(facade);
        await first.entered.promise;
        await facade.terminate();
        const newLoad = deferred<Result<void, Error>>();
        first.beginLoad.mockImplementationOnce(() => { first.loading = true; return newLoad.promise; });
        const fresh = initialize(facade);
        await vi.waitFor(() => expect(first.beginLoad).toHaveBeenCalledTimes(2));
        first.load.resolve(Result.ok(undefined));
        expect((await old).isOk).toBe(false);
        expect(first.onDestroy).toHaveBeenCalledOnce();
        expect(first.loading).toBe(true);
        await facade.terminate();
        const releasedNewLifetime = first.onDestroy.mock.calls.length;
        newLoad.resolve(Result.ok(undefined));
        expect((await fresh).isOk).toBe(false);
        expect(releasedNewLifetime).toBe(2);
        expect(first.loading).toBe(false);
    });

    it.each(['rejection', 'result failure'] as const)('retains and reports uncertain release after init %s', async (outcome) => {
        const { facade, first, second, factory } = mount(kind, candidateId);
        first.onDestroy.mockRejectedValueOnce(new Error('worker release stuck'));
        const pending = initialize(facade);
        await first.entered.promise;
        const failure = new Error('worker init refused');
        if (outcome === 'rejection') first.load.reject(failure); else first.load.resolve(Result.err(failure));
        expect(await pending).toMatchObject({ isOk: false,
            error: expect.objectContaining({ message: expect.stringMatching(/worker init refused.*release uncertain.*worker release stuck/) }) });
        second.load.resolve(Result.ok(undefined));
        expect(await initialize(facade)).toMatchObject({ isOk: false,
            error: expect.objectContaining({ message: expect.stringContaining('release uncertain') }) });
        expect(factory).toHaveBeenCalledOnce();
        expect(first.onDestroy).toHaveBeenCalledOnce();
    });

    it('does not start a child constructed across a cancellation boundary', async () => {
        const { facade, first, factory } = mount(kind, candidateId);
        let retirement: Promise<void> | undefined;
        factory.mockImplementationOnce(() => {
            retirement = facade.terminate();
            return first;
        });
        first.load.resolve(Result.ok(undefined));
        expect((await initialize(facade)).isOk).toBe(false);
        await retirement;
        expect(first.beginLoad).not.toHaveBeenCalled();
        expect(first.onDestroy).toHaveBeenCalledOnce();
    });
});
