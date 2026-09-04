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

export interface CandidateAssetRequests {
    assets: PinnedAssetRef[];
    /** Why the list is empty, when it is. Never left unexplained, and never a silent zero. */
    unobservableReason: string | null;
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
 * The sanctioned way to close it is to observe the loader's ACTUAL runtime boundary — not to write a
 * fixed URL list. `assetOriginPrefixes` already scopes Resource Timing, and the registry knows v4's
 * model repository id, so a prefix derived from that id would measure real requests without pinning
 * anything. That yields download duration, asset count and network use for v4; only the PRE-load cache
 * probe would remain unobservable, because nothing can be looked up before the load names it. Do not
 * substitute a hardcoded HuggingFace URL table for that work.
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
 * The URL prefixes that identify this candidate's traffic in Resource Timing.
 *
 * Matching by prefix rather than by exact URL on purpose: a loader may append a query string, request a
 * range, or resolve a file this product did not pin. Counting those is more honest than ignoring them,
 * because they are bytes the user really fetched.
 */
export function assetOriginPrefixes(candidate: Candidate): string[] {
    const { assets } = assetRequestsFor(candidate);
    const prefixes = new Set<string>();
    for (const a of assets) {
        const cut = a.url.lastIndexOf('/');
        prefixes.add(cut === -1 ? a.url : a.url.slice(0, cut + 1));
    }
    return [...prefixes];
}
