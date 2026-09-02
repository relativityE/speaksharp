/**
 * THE PIN SET AS AN ENFORCED CONTRACT, NOT AS METADATA.
 *
 * The registry has always carried a pin digest, and a test recomputed it from this table. That proved
 * the table was internally consistent and nothing more: the production loader called
 * `Transcriber.load({ language, modelArch, onProgress })`, which resolves the model through the vendor's
 * CDN *catalog*. The bytes that actually executed were whatever the catalog served — a re-publish, a
 * stale edge cache or a hostile response would all have run while our metadata went on reporting the
 * committed digest.
 *
 * A pin that nothing checks is a comment. These helpers turn the table into the thing that decides
 * whether a session may start: every component is fetched from its pinned URL, its length and SHA-256
 * are verified against the committed values, and only then are the buffers handed to the runtime.
 */
import PINS from './moonshineAssetPins.json';

export interface PinnedAsset {
    /** Canonical filename the runtime keys buffers by, e.g. `encoder.ort`. */
    file: string;
    url: string;
    sha256: string;
    bytes: number;
}

interface RawPin { sha256: string; bytes: number; url: string }

/**
 * The components for one model id, keyed by the canonical filename the runtime expects.
 *
 * Selected by MODEL ID rather than by index or order: the table holds several models, and picking the
 * wrong subset would load a coherent set of files for a model nobody asked for — which the digest check
 * would then happily confirm.
 */
export function pinnedAssetsFor(modelId: string): PinnedAsset[] {
    const assets = (PINS as { assets: Record<string, RawPin> }).assets;
    const mine = Object.entries(assets)
        .filter(([key]) => key.includes(modelId))
        .map(([key, pin]) => ({ file: key.split('/').pop()!, url: pin.url, sha256: pin.sha256, bytes: pin.bytes }));
    if (mine.length === 0) {
        throw new Error(`no committed asset pins for model ${modelId}; refusing to fetch unpinned bytes`);
    }
    return mine.sort((a, b) => a.file.localeCompare(b.file));
}

export function pinnedTotalBytes(modelId: string): number {
    return pinnedAssetsFor(modelId).reduce((sum, a) => sum + a.bytes, 0);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    // Hashes the VIEW, not `bytes.buffer`. A Uint8Array can be a window onto a larger buffer, so
    // hashing the underlying buffer would digest neighbouring bytes and reject a correct download.
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AssetPinViolation extends Error {}

/**
 * Fetch one pinned component and REFUSE it unless the bytes match.
 *
 * Length is checked first because it is free and catches the common corruption; the digest is what
 * actually establishes identity. Both are checked — a truncated response that happened to be handed a
 * matching digest is not a scenario worth leaving open, and the length check costs nothing.
 */
export async function fetchVerifiedAsset(
    asset: PinnedAsset,
    fetchImpl: typeof fetch = fetch,
    onBytes?: (file: string, loaded: number) => void,
): Promise<Uint8Array> {
    const response = await fetchImpl(asset.url);
    if (!response.ok) {
        throw new AssetPinViolation(`${asset.file}: HTTP ${response.status} from its pinned URL`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== asset.bytes) {
        throw new AssetPinViolation(
            `${asset.file}: served ${bytes.byteLength} bytes, pin commits ${asset.bytes}`,
        );
    }
    const digest = await sha256Hex(bytes);
    if (digest !== asset.sha256) {
        // The severe case. Matching length with a different digest means the bytes were substituted,
        // not corrupted — so this must never degrade to a warning.
        throw new AssetPinViolation(
            `${asset.file}: served digest ${digest} does not match committed ${asset.sha256}`,
        );
    }
    onBytes?.(asset.file, bytes.byteLength);
    return bytes;
}

/**
 * Fetch and verify every component for a model.
 *
 * Sequential rather than parallel, deliberately: this is ~305 MB on a connection the user has just
 * consented to spend, and saturating it with seven concurrent downloads makes progress reporting
 * meaningless and the first failure slower to surface.
 */
export async function fetchVerifiedAssets(
    assets: PinnedAsset[],
    fetchImpl: typeof fetch = fetch,
    onBytes?: (file: string, loaded: number) => void,
): Promise<Record<string, Uint8Array>> {
    const files: Record<string, Uint8Array> = {};
    for (const asset of assets) {
        files[asset.file] = await fetchVerifiedAsset(asset, fetchImpl, onBytes);
    }
    return files;
}
