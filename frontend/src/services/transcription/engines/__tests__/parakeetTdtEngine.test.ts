// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParakeetTdtEngine } from '../ParakeetTdtEngine';
import { CANDIDATES } from '../../candidateRegistry';
import { requiredParakeetFiles, type ParakeetTdtOptions, type ParakeetWorkerReply,
    type ParakeetWorkerRequest } from '../parakeet/contracts';

const acquire = vi.hoisted(() => vi.fn<typeof import('../../moonshineAssetPins')['fetchVerifiedAssets']>());
vi.mock('../../moonshineAssetPins', () => ({ fetchVerifiedAssets: acquire }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

const descriptor = CANDIDATES['parakeet:tdt-v3:int8'];
function options(): ParakeetTdtOptions {
    if (descriptor.execution.decode.kind !== 'parakeet-tdt') throw new Error('Missing TDT descriptor');
    return { profile: { ...descriptor.execution.decode },
        runtime: { package: 'parakeet.js', version: '1.4.4', ortVersion: '1.24.1' },
        assets: requiredParakeetFiles(descriptor.execution.decode).map(file => ({
            file, url: `https://synthetic.invalid/${file}`, bytes: 1, sha256: 'a'.repeat(64),
        })),
    };
}
const buffers = () => Object.fromEntries(requiredParakeetFiles(options().profile)
    .map(file => [file, new Uint8Array([1])]));

const workers: FakeWorker[] = [];
const urls = new Set<string>();
let replyMode: 'normal' | 'hold' | 'wrong-version' | 'post-error';
let nextUrl = 0;
let current: ParakeetTdtEngine | null;

class FakeWorker {
    readonly messages: ParakeetWorkerRequest[] = [];
    readonly transfers: Transferable[][] = [];
    onmessage: ((event: MessageEvent<ParakeetWorkerReply>) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message: ParakeetWorkerRequest, transfer: Transferable[] = []) {
        if (replyMode === 'post-error') throw new Error('postMessage refused');
        this.messages.push(message);
        this.transfers.push(transfer);
        if (replyMode === 'hold') return;
        queueMicrotask(() => this.deliver(message.type === 'init'
            ? { id: message.id, ok: true, type: 'ready', backend: 'wasm',
                ortVersion: replyMode === 'wrong-version' ? '1.30.0' : '1.24.1' }
            : { id: message.id, ok: true, type: 'transcript', text: 'TDT segment' }));
    }
    deliver(reply: ParakeetWorkerReply) { this.onmessage?.({ data: reply } as MessageEvent<ParakeetWorkerReply>); }
    terminate() { this.terminated = true; }
}

beforeEach(() => {
    acquire.mockReset(); acquire.mockResolvedValue(buffers());
    workers.length = 0; urls.clear(); replyMode = 'normal'; current = null;
    vi.stubGlobal('Worker', FakeWorker);
    // Vite resolves the worker URL against location. The shared navigation
    // fixture spreads Location, whose inherited toString requires its original receiver.
    Object.defineProperty(window.location, 'toString', { configurable: true,
        value: () => window.location.href });
    class BlobUrl extends URL {
        static createObjectURL() { const url = `blob:parakeet-${++nextUrl}`; urls.add(url); return url; }
        static revokeObjectURL(url: string) { urls.delete(url); }
    }
    vi.stubGlobal('URL', BlobUrl);
});
afterEach(async () => {
    await current?.terminate();
    vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Parakeet TDT adapter lifetime and asset authority', () => {
    it('refuses the actual incomplete model-only descriptor before acquisition', async () => {
        current = new ParakeetTdtEngine({ ...options(), assets: descriptor.assets.files!.slice(0, 4).map(file => ({
            file: file.path, url: file.url!, bytes: file.bytes, sha256: file.sha256,
        })) });
        expect(await current.checkAvailability()).toMatchObject({ isAvailable: false,
            message: expect.stringContaining('inventory is incomplete') });
        expect((await current.init()).isOk).toBe(false);
        expect(acquire).not.toHaveBeenCalled();
        expect(workers).toHaveLength(0);
    });

    it.each([{ backend: 'webgpu' }, { encoderPrecision: 'fp32' }, { decoderPrecision: 'fp16' }])(
        'refuses unsupported backend/precision %j without substitution', async (override) => {
            const input = options();
            input.profile = { ...input.profile, ...override } as unknown as ParakeetTdtOptions['profile'];
            current = new ParakeetTdtEngine(input);
            expect((await current.init()).isOk).toBe(false);
            expect(acquire).not.toHaveBeenCalled();
            expect(workers).toHaveLength(0);
        },
    );

    it('uses the complete shared verified inventory, publishes WASM evidence and transfers a PCM copy', async () => {
        const input = options();
        current = new ParakeetTdtEngine(input);
        expect(await current.init()).toEqual({ isOk: true, data: undefined });
        expect(acquire.mock.calls[0][0]).toEqual(input.assets);
        expect(workers[0].transfers[0]).toHaveLength(input.assets.length);
        expect(current.getRuntimeEvidence()).toEqual({ initSucceeded: true, backend: 'wasm',
            modelId: null, fallbackOccurred: false });
        await current.start({ sampleRate: 16000 } as never);
        await expect(current.start({ sampleRate: 48000 } as never)).rejects.toThrow('16 kHz');
        const audio = new Float32Array([0.25, -0.5]);
        expect(await current.transcribe(audio)).toEqual({ isOk: true, data: 'TDT segment' });
        const decode = workers[0].messages.find(message => message.type === 'decode');
        if (!decode || decode.type !== 'decode') throw new Error('Decode request missing');
        expect(decode.audio).toEqual(audio);
        expect(decode.audio).not.toBe(audio);
        expect(decode.audio.buffer).not.toBe(audio.buffer);
        await current.destroy();
        expect(workers[0].terminated).toBe(true);
        expect(urls.size).toBe(0);
        expect(current.getRuntimeEvidence()).toBeNull();
    });

    it('does not create a worker when shared asset verification fails', async () => {
        acquire.mockRejectedValueOnce(new Error('SHA256 mismatch'));
        current = new ParakeetTdtEngine(options());
        expect(await current.init()).toMatchObject({ isOk: false, error: expect.objectContaining({ message: 'SHA256 mismatch' }) });
        expect(workers).toHaveLength(0);
        expect(urls.size).toBe(0);
    });

    it('cancellation during asset acquisition cannot publish a late worker or ready evidence', async () => {
        const gate = deferred<Record<string, Uint8Array>>();
        const entered = deferred<void>();
        acquire.mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise; });
        current = new ParakeetTdtEngine(options());
        const pending = current.init();
        await entered.promise;
        await current.terminate();
        gate.resolve(buffers());
        expect((await pending).isOk).toBe(false);
        expect(workers).toHaveLength(0);
        expect(current.getRuntimeEvidence()).toBeNull();
    });

    it('termination aborts the actual fetch signal passed through shared acquisition', async () => {
        const entered = deferred<void>();
        const signals: AbortSignal[] = [];
        const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) throw new Error('Missing acquisition abort signal');
            signals.push(signal); entered.resolve(undefined);
            signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
        }));
        vi.stubGlobal('fetch', fetcher);
        acquire.mockImplementationOnce(async (assets, fetchImpl = fetch) => {
            await fetchImpl(assets[0].url); return buffers();
        });
        current = new ParakeetTdtEngine(options());
        const pending = current.init();
        await entered.promise;
        await current.terminate();
        expect(signals[0].aborted).toBe(true);
        expect((await pending).isOk).toBe(false);
        expect(workers).toHaveLength(0);
    });

    it('an older acquisition cannot terminate a newer successful initialization', async () => {
        const gate = deferred<Record<string, Uint8Array>>();
        const entered = deferred<void>();
        acquire.mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise; });
        current = new ParakeetTdtEngine(options());
        const older = current.init();
        await entered.promise;
        expect((await current.init()).isOk).toBe(true);
        gate.resolve(buffers());
        expect((await older).isOk).toBe(false);
        expect(workers).toHaveLength(1);
        expect(workers[0].terminated).toBe(false);
        expect(current.getRuntimeEvidence()?.initSucceeded).toBe(true);
    });

    it('rejects wrong runtime identity and retires the worker and object URL', async () => {
        replyMode = 'wrong-version';
        current = new ParakeetTdtEngine(options());
        expect((await current.init()).isOk).toBe(false);
        expect(workers[0].terminated).toBe(true);
        expect(urls.size).toBe(0);
        expect(current.getRuntimeEvidence()).toBeNull();
    });

    it('termination rejects an outstanding decode and ignores its stale completion', async () => {
        current = new ParakeetTdtEngine(options());
        await current.init();
        replyMode = 'hold';
        const pending = current.transcribe(new Float32Array([0.5]));
        const message = workers[0].messages[workers[0].messages.length - 1];
        await current.terminate();
        expect((await pending).isOk).toBe(false);
        workers[0].deliver({ id: message.id, ok: true, type: 'transcript', text: 'stale text' });
        expect(current.getRuntimeEvidence()).toBeNull();
        expect(urls.size).toBe(0);
    });

    it('a finite worker timeout retires the entire inference context', async () => {
        vi.useFakeTimers(); replyMode = 'hold';
        current = new ParakeetTdtEngine(options());
        const pending = current.init(20);
        await vi.advanceTimersByTimeAsync(20);
        expect((await pending).isOk).toBe(false);
        expect(workers[0].terminated).toBe(true);
        expect(urls.size).toBe(0);
    });

    it('a native postMessage failure cannot leave an initialized worker behind', async () => {
        replyMode = 'post-error';
        current = new ParakeetTdtEngine(options());
        expect((await current.init()).isOk).toBe(false);
        expect(workers[0].terminated).toBe(true);
        expect(urls.size).toBe(0);
    });
});
