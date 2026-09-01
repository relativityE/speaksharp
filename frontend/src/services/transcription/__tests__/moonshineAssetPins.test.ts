/**
 * #1402 P1 #4 and #6 — the pins DECIDE what runs, and progress is measured in bytes.
 *
 * The previous test proved a declared pin table had URLs and hashes. It could not prove the loader used
 * them, and it did not: `Transcriber.load({ language, modelArch, onProgress })` resolves the model
 * through the vendor's CDN catalog, so the executing bytes were whatever the catalog served while our
 * metadata went on reporting the committed digest. A re-publish, a stale edge cache or a substituted
 * response would each have produced a session labelled with a digest nothing had checked.
 *
 * These tests use the real verification path with a fetch double, because the property under test is
 * "wrong bytes are refused", and that is only meaningful if the refusal is performed by the code that
 * ships.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    AssetPinViolation, fetchVerifiedAsset, fetchVerifiedAssets, pinnedAssetsFor, pinnedTotalBytes,
} from '../moonshineAssetPins';

const MODEL = 'medium-streaming-en';

/** Bytes whose SHA-256 we compute for real, so the double cannot accidentally agree with itself. */
const bodyOf = (length: number, fill = 7) => new Uint8Array(length).fill(fill);

const respondWith = (body: Uint8Array, ok = true, status = 200) => ({
    ok, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
}) as unknown as Response;

async function realDigest(bytes: Uint8Array): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the committed pins decide which bytes may execute', () => {
    it('POSITIVE CONTROL: bytes matching length AND digest are accepted', async () => {
        const body = bodyOf(1024);
        const asset = { file: 'encoder.ort', url: 'https://x/encoder.ort', bytes: 1024, sha256: await realDigest(body) };
        await expect(fetchVerifiedAsset(asset, async () => respondWith(body))).resolves.toBeInstanceOf(Uint8Array);
    });

    it('CASUALTY: SUBSTITUTED bytes of the correct length are refused', async () => {
        // The severe case, and the one a length check alone would wave through: something served a
        // payload of exactly the right size with different content. Matching length with a different
        // digest is substitution, not corruption, so it must never degrade to a warning.
        const body = bodyOf(1024, 9);
        const asset = { file: 'encoder.ort', url: 'https://x/encoder.ort', bytes: 1024, sha256: await realDigest(bodyOf(1024, 7)) };
        await expect(fetchVerifiedAsset(asset, async () => respondWith(body)))
            .rejects.toThrow(AssetPinViolation);
    });

    it('CASUALTY: a different byte COUNT is refused', async () => {
        const body = bodyOf(999);
        const asset = { file: 'encoder.ort', url: 'https://x/encoder.ort', bytes: 1024, sha256: await realDigest(body) };
        await expect(fetchVerifiedAsset(asset, async () => respondWith(body)))
            .rejects.toThrow(/served 999 bytes, pin commits 1024/);
    });

    it('CASUALTY: a non-OK response from the pinned URL is refused, never treated as empty', async () => {
        const asset = { file: 'encoder.ort', url: 'https://x/encoder.ort', bytes: 4, sha256: 'irrelevant' };
        await expect(fetchVerifiedAsset(asset, async () => respondWith(bodyOf(0), false, 404)))
            .rejects.toThrow(/HTTP 404/);
    });

    it('CASUALTY: an unpinned model id cannot be fetched at all', async () => {
        // Falling through to "no pins, so nothing to check" would make the whole mechanism opt-in.
        expect(() => pinnedAssetsFor('a-model-nobody-pinned')).toThrow(/refusing to fetch unpinned bytes/);
    });

    it('CASUALTY: one bad component fails the whole set — no partial model is assembled', async () => {
        const assets = pinnedAssetsFor(MODEL);
        const fetchImpl = vi.fn(async (url: string) => {
            const asset = assets.find((a) => a.url === url)!;
            // Every component is served at its committed LENGTH but with content that cannot match.
            return respondWith(bodyOf(asset.bytes));
        });
        await expect(fetchVerifiedAssets(assets, fetchImpl as unknown as typeof fetch))
            .rejects.toThrow(AssetPinViolation);
    });

    it('the pinned components are keyed by the canonical filename the runtime expects', () => {
        const files = pinnedAssetsFor(MODEL).map((a) => a.file);
        // The runtime keys in-memory buffers by these exact names; a path or a URL here would load
        // nothing while looking correct.
        expect(files).toEqual([
            'adapter.ort', 'cross_kv.ort', 'decoder_kv.ort', 'encoder.ort',
            'frontend.ort', 'streaming_config.json', 'tokenizer.bin',
        ]);
        for (const f of files) expect(f).not.toContain('/');
    });
});

describe('download progress is normalised from BYTES', () => {
    it('CASUALTY: byte counts are never reported as if they were a fraction', async () => {
        // The runtime's callback is `(loaded, total, file)` in BYTES; it was wired to a handler
        // expecting 0..1 and then multiplied by 100. The first component alone reported 365,129,600%.
        const seen: number[] = [];
        const assets = pinnedAssetsFor(MODEL);
        const fetchImpl = vi.fn(async (url: string) => {
            const asset = assets.find((a) => a.url === url)!;
            const body = bodyOf(asset.bytes);
            return respondWith(body);
        });
        await fetchVerifiedAssets(assets, fetchImpl as unknown as typeof fetch, (_f, loaded) => {
            seen.push(loaded / pinnedTotalBytes(MODEL));
        }).catch(() => { /* digests will not match; progress is what is under test */ });

        for (const fraction of seen) {
            expect(fraction).toBeGreaterThan(0);
            expect(fraction, 'a fraction above 1 is a byte count in disguise').toBeLessThanOrEqual(1);
        }
    });

    it('the denominator is the pinned total, not a runtime-supplied one', () => {
        // The runtime's `total` is optional and absent for some components, so dividing by it yields
        // Infinity or NaN exactly when the download is largest.
        expect(pinnedTotalBytes(MODEL)).toBe(304_690_919);
    });
});
