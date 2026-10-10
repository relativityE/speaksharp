/**
 * #1259 RETURN — THE ASSETS A CANDIDATE ACTUALLY REQUESTS.
 *
 * The cache probe was always handed an empty list, so it always answered `unobservable`, so every real
 * load reported no cache result and, by derivation, no network use. The probe was correct; it was never
 * given anything to look at.
 *
 * These are the pinned asset REQUESTS for each candidate, taken from the same committed pin files the
 * registry digests, so the list a load is measured against and the list the model is identified by
 * cannot diverge. A candidate whose assets this product cannot enumerate returns an empty list WITH a
 * stated reason, and only that candidate is unobservable.
 *
 * URLs are identity here, not decoration: they are what `caches.match()` is keyed on and what Resource
 * Timing reports. They never enter telemetry — a pinned asset URL can carry a path that identifies a
 * build, so only counts, bytes and durations are ever emitted.
 */
import type { Candidate } from './candidateRegistry';
import type { PinnedAssetRef } from './modelAcquisitionTelemetry';
import selfHostedPins from './selfHostedAssetPins.json';
import moonshinePins from './moonshineAssetPins.json';
import { TRANSFORMERS_V2_WASM_ASSET_URLS } from './engines/transformersV2WasmAssets';

export interface CandidateAssetRequests {
    assets: PinnedAssetRef[];
    /** Why the list is empty, when it is. Never left unexplained, and never a silent zero. */
    unobservableReason: string | null;
}

/** A separately counted part of an acquisition, so one resource class cannot hide another's shortfall. */
export interface AcquisitionComponentGroup {
    prefixes: string[];
    minimumUniqueCount: number;
    /** Exact required identities when a loader uses a stable subset of the shipped pin inventory. */
    expectedResourceUrls?: string[];
    /** Allowed exact identities when a loader selects one of several mutually exclusive variants. */
    allowedResourceUrls?: string[];
}

interface SelfHostedPinFile { servedFrom: string; files: Array<{ path: string; bytes: number }> }
interface MoonshinePinFile { assets: Record<string, { url: string; bytes: number }> }

/** Absolute against the current origin, because that is how the loader requests it and how the cache keys it. */
function selfHostedAssets(): PinnedAssetRef[] {
    const pins = selfHostedPins as SelfHostedPinFile;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return pins.files.map((f) => ({
        file: f.path,
        url: `${origin}${pins.servedFrom}/${f.path}`,
        bytes: f.bytes,
    }));
}

function selfHostedModelPrefix(): string {
    const pins = selfHostedPins as SelfHostedPinFile;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${pins.servedFrom}/`;
}

// Real worker evidence: transformers.js' first whisper-base.en pipeline requests these seven
// model resources, not every file shipped in the pin directory. Keep exact identities so a different
// seven files cannot accidentally satisfy the cold-acquisition proof.
const V2_PIPELINE_MODEL_PATHS = [
    'config.json',
    'generation_config.json',
    'onnx/decoder_model_merged_quantized.onnx',
    'onnx/encoder_model_quantized.onnx',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
] as const;

function v2PipelineModelUrls(): string[] {
    const pins = selfHostedPins as SelfHostedPinFile;
    const available = new Set(pins.files.map((file) => file.path));
    if (V2_PIPELINE_MODEL_PATHS.some((path) => !available.has(path))) return [];
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return V2_PIPELINE_MODEL_PATHS.map((path) => `${origin}${pins.servedFrom}/${path}`);
}

function v2RuntimeAssetUrls(): string[] {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return Object.values(TRANSFORMERS_V2_WASM_ASSET_URLS).map((assetUrl) =>
        origin ? new URL(assetUrl, origin).href : assetUrl,
    );
}

function moonshineAssets(): PinnedAssetRef[] {
    const pins = moonshinePins as unknown as MoonshinePinFile;
    return Object.entries(pins.assets).map(([file, a]) => ({ file, url: a.url, bytes: a.bytes }));
}

/**
 * The asset requests for a candidate, or an explained empty list.
 *
 * v4 is deliberately unobservable: its pins live in `tests/fixtures/hf-asset-pins.json`, which is test
 * material and is not shipped to the browser. Inventing HuggingFace URLs from the model id would
 * produce a list that LOOKS measured and is actually a guess — and a guessed cache probe is the exact
 * failure this correction exists to remove. Naming the reason keeps the gap visible instead of letting
 * a zero pass for a measurement.
 *
 * PM DISPOSITION, 2026-09-03 — READ THIS BEFORE "FIXING" THE GAP.
 *
 * An honest `unobservable` is an ACCEPTABLE field result during Stage-1 internal comparison. It is NOT
 * sufficient for the candidate ultimately selected for production. Whichever model ships must report
 * candidate/model identity, total setup time, cache result, and either download duration or a directly
 * MEASURED no-download/cache-hit outcome.
 *
 * So the consequence is conditional, not permanent. If Stage 1 selects v4, cache-versus-network
 * acquisition and download duration for v4 become a PRE-MVP BLOCKER. If v4 is not selected and stays
 * internal-only, this limitation may remain documented as it is.
 *
 * THAT WORK IS NOW DONE for the download side: `acquisitionScopeFor` scopes v4 by the model REPOSITORY
 * the runtime resolves against, taken from the registry, so its worker measures real request count,
 * duration and bytes. What remains unobservable for v4 is only the PRE-load cache probe, because
 * nothing can be looked up in a cache before the load names the files it wants. Do not substitute a
 * hardcoded HuggingFace URL table for either.
 */
export function assetRequestsFor(candidate: Candidate): CandidateAssetRequests {
    if (candidate.assets.provenance === 'self_hosted') {
        return { assets: selfHostedAssets(), unobservableReason: null };
    }
    if (candidate.engine === 'moonshine-streaming') {
        return { assets: moonshineAssets(), unobservableReason: null };
    }
    return {
        assets: [],
        unobservableReason: 'asset pins for this candidate are test material and are not shipped to the browser',
    };
}

/**
 * What identifies this candidate's traffic in Resource Timing.
 *
 * These are SUBSTRINGS, not exact URLs, and deliberately so: a loader may append a query string,
 * request a range, or resolve a file this product did not pin, and those are bytes the user really
 * fetched. Counting them is more honest than ignoring them.
 *
 * For a candidate whose assets this product serves or pins, the scope is the location they are served
 * from. For a candidate loaded from a model repository — v4 — the scope is the REPOSITORY IDENTITY the
 * registry already records, because that is the boundary the runtime actually requests against. That is
 * derived from the runtime's own configuration rather than being a hand-written table of file names,
 * which would go stale the moment the loader asked for one more file.
 *
 * A repository scope does not survive every redirect: a host that answers from a CDN under a different
 * path will not contain the repository id. That is not silently dropped — the observation reports how
 * many in-window requests fell OUTSIDE the scope, so a scope that stopped matching is visible as a
 * discrepancy rather than as a smaller download.
 */
export function acquisitionScopeFor(candidate: Candidate): string[] {
    const { assets } = assetRequestsFor(candidate);
    if (assets.length > 0) {
        const prefixes = new Set<string>();
        for (const a of assets) {
            const cut = a.url.lastIndexOf('/');
            prefixes.add(cut === -1 ? a.url : a.url.slice(0, cut + 1));
        }
        // v2 runtime files are added below as exact emitted assets. Do not broaden this scope to the
        // whole ORT directory: an unrelated same-directory request must remain visible as out-of-scope.
        return [...prefixes];
    }
    // No shipped pin table: scope by the repository the runtime resolves against.
    return candidate.model.id ? [candidate.model.id] : [];
}

/**
 * Required resource classes for a complete first-use measurement.
 *
 * v2's seven model files requested by its first pipeline and one of four emitted ONNX Runtime WASM
 * variants are separate groups. Exact model identities come from a real worker observation; runtime
 * identities come from the emitted asset imports. Unknown files in the ORT directory remain out of
 * scope. The full 12-file pin inventory remains the cache-probe candidate list.
 */
export function acquisitionComponentGroupsFor(candidate: Candidate): AcquisitionComponentGroup[] {
    if (candidate.id === 'v2:base.en') {
        return [
            {
                prefixes: [selfHostedModelPrefix()],
                minimumUniqueCount: V2_PIPELINE_MODEL_PATHS.length,
                expectedResourceUrls: v2PipelineModelUrls(),
            },
            { prefixes: [], minimumUniqueCount: 1, allowedResourceUrls: v2RuntimeAssetUrls() },
        ];
    }
    const prefixes = acquisitionScopeFor(candidate);
    return candidate.assets.componentCount !== null && candidate.assets.componentCount !== undefined
        ? [{ prefixes, minimumUniqueCount: candidate.assets.componentCount }]
        : [];
}

