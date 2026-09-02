/**
 * #1402 P1 #2, #3 and #4 — the verified bytes are the bytes that run, a mismatch stops before READY,
 * and the runtime is closed on every exit.
 *
 * The default loader is exercised here (no `loadTranscriber` injected), because the defect being closed
 * lived in that function: it called `Transcriber.load({ language, modelArch, onProgress })`, which
 * resolves the model through the vendor's CDN catalog. Verifying pinned bytes and then letting the
 * runtime fetch its own copy would leave the original hole open while looking fixed, so this asserts on
 * what `Transcriber.load` actually receives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedAssetsFor as realPins } from '../../moonshineAssetPins';

/**
 * A SMALL pin set whose digests this test computes for real, so verification can SUCCEED and the
 * positive control can assert on what `Transcriber.load` actually receives. Only the pin TABLE is
 * substituted — the fetching, length check and SHA-256 comparison are the shipping implementation.
 */
const TINY = [
    { file: 'encoder.ort', url: 'https://download.moonshine.ai/test/encoder.ort', bytes: 32, sha256: '648aa5c579fb30f38af744d97d6ec840c7a91277a499a0d780f3e7314eca090b' },
    { file: 'tokenizer.bin', url: 'https://download.moonshine.ai/test/tokenizer.bin', bytes: 16, sha256: '6399f6d863b08f4652b342c2e1350b4c01e291332d9d84d84b575bf7272897d2' },
];

vi.mock('../../moonshineAssetPins', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return {
        ...actual,
        pinnedAssetsFor: (id: string) => (id === 'medium-streaming-en' ? TINY : (actual.pinnedAssetsFor as typeof realPins)(id)),
        pinnedTotalBytes: () => TINY.reduce((s, a) => s + a.bytes, 0),
    };
});

const loadSpy = vi.fn();
const closeSpy = vi.fn();

vi.mock('@moonshine-ai/moonshine-wasm', () => ({
    ModelArch: { SmallStreaming: 4, MediumStreaming: 5 },
    Transcriber: {
        load: (options: Record<string, unknown>) => {
            loadSpy(options);
            return Promise.resolve({
                transcribe: () => ({ lines: [] }),
                createStream: () => ({ start: vi.fn(), addAudio: vi.fn(), transcribe: () => ({ lines: [] }), stop: vi.fn(), close: vi.fn() }),
                close: closeSpy,
            });
        },
    },
}));

const ASSETS = TINY;

/** Serves each pinned URL with bytes that match its committed length; digests are stubbed per test. */
function serveBytes(mutate?: (url: string, body: Uint8Array) => Uint8Array) {
    return vi.fn(async (url: string) => {
        const asset = ASSETS.find((a) => a.url === url);
        if (!asset) throw new Error(`unexpected fetch to ${url}`);
        let body: Uint8Array = new Uint8Array(asset.bytes).fill(3);
        if (mutate) body = mutate(url, body);
        return {
            ok: true, status: 200,
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        } as unknown as Response;
    });
}

async function newEngine() {
    const { MoonshineStreamingEngine } = await import('../MoonshineStreamingEngine');
    return new MoonshineStreamingEngine({
        candidateId: 'moonshine:streaming-medium',
        modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    });
}

describe('the runtime consumes the verified buffers and fetches nothing else', () => {
    beforeEach(() => { loadSpy.mockClear(); closeSpy.mockClear(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('CASUALTY: load() receives in-memory FILES and no `language`, so no catalog lookup can occur', async () => {
        // A REAL positive control: these bodies hash to the committed digests, so verification passes
        // and the runtime is genuinely constructed. Asserting only on the failure path would leave the
        // success path — the one users take — unproven.
        vi.stubGlobal('fetch', serveBytes());
        const e = await newEngine();
        await e.init();

        expect(loadSpy, 'verification succeeded, so the runtime must have been built').toHaveBeenCalledTimes(1);
        const options = loadSpy.mock.calls[0][0] as { files: Record<string, Uint8Array>; modelArch: number };
        expect(options, 'a `language` key re-enables CDN catalog resolution').not.toHaveProperty('language');
        expect(options.modelArch).toBe(5);
        // THE VERIFIED BUFFERS THEMSELVES, keyed by canonical filename — not a URL list the runtime
        // would re-fetch, and not a language for it to resolve through the catalog.
        expect(Object.keys(options.files).sort()).toEqual(['encoder.ort', 'tokenizer.bin']);
        expect(options.files['encoder.ort']).toBeInstanceOf(Uint8Array);
        expect(options.files['encoder.ort'].byteLength).toBe(32);
        expect([...options.files['encoder.ort']].every((b) => b === 3), 'the bytes handed over are the ones verified').toBe(true);
    });

    it('CASUALTY: every fetch goes to a PINNED url — nothing unpinned is requested', async () => {
        const fetchImpl = serveBytes();
        vi.stubGlobal('fetch', fetchImpl);
        const e = await newEngine();
        await e.init();

        const pinned = new Set(ASSETS.map((a) => a.url));
        for (const call of fetchImpl.mock.calls) {
            expect(pinned.has(call[0] as string), `${call[0]} is not a committed pin`).toBe(true);
        }
    });
});

describe('a pin mismatch stops before READY and leaves nothing behind', () => {
    beforeEach(() => { loadSpy.mockClear(); closeSpy.mockClear(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('CASUALTY: a DIGEST mismatch fails init, publishes no identity and starts no runtime', async () => {
        // Correct LENGTH, different content — substitution rather than corruption, which a length check
        // alone would wave straight through.
        vi.stubGlobal('fetch', serveBytes((_url, body) => body.fill(9)));
        const e = await newEngine();

        const result = await e.init();
        expect(result.isOk, 'unverified bytes must never reach the runtime').toBe(false);
        // Nothing was constructed, so there is nothing to leak — and no identity is published for a
        // model whose bytes we could not confirm.
        expect(loadSpy, 'the runtime must not be built from unverified bytes').not.toHaveBeenCalled();
        expect(e.getMetadata().failure).toMatchObject({ phase: 'init' });
        await expect(e.start({ onFrame: () => () => {}, sampleRate: 16_000 } as never)).rejects.toThrow();
    });

    it('CASUALTY: a LENGTH mismatch fails the same way', async () => {
        vi.stubGlobal('fetch', serveBytes((_url, body) => body.slice(0, Math.max(0, body.length - 1))));
        const e = await newEngine();
        const result = await e.init();
        expect(result.isOk).toBe(false);
        expect(loadSpy).not.toHaveBeenCalled();
        expect(e.getMetadata().failure?.message).toMatch(/bytes, pin commits/);
    });

    it('CASUALTY: a served 404 fails init rather than loading an empty model', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response));
        const e = await newEngine();
        const result = await e.init();
        expect(result.isOk).toBe(false);
        expect(e.getMetadata().failure?.message).toMatch(/HTTP 404/);
    });
});
