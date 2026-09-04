/**
 * #1259s — MODEL ACQUISITION, MEASURED AT THE ASSET BOUNDARY.
 *
 * WHAT WAS WRONG. Setup telemetry recorded one total duration. It could not say whether bytes crossed
 * the network, could not separate download from initialisation, and could not prove cache use at all.
 * The only available inference was "it was fast, so it must have been cached" — which is not a
 * measurement. A warm profile on a slow machine and a cold profile on a fast one are indistinguishable
 * that way, and the number would have been quoted as if it meant something.
 *
 * SO CACHE RESULT COMES FROM THE CACHE. Before a load begins we ask the real Cache Storage whether the
 * candidate's pinned assets are present, and classify hit / miss / partial from what is actually there.
 * When the boundary cannot be inspected — no Cache Storage, an engine whose library owns its own cache
 * and exposes nothing — the result is `unobservable`. That is an honest answer and a useful one; a
 * guessed `hit` is neither.
 *
 * IDENTITY MUST SETTLE FIRST (#1401). Model setup starts during page initialisation, before the
 * authenticated identity is established. An event classified then is attributed to anonymous traffic,
 * and per-user download behaviour becomes unreadable: the same person's cold and warm loads land under
 * different identities. Events are therefore held until identity settles, then emitted.
 *
 * CONTENT-FREE BY CONSTRUCTION. No transcript, no audio, no asset contents, no URL (a pinned asset URL
 * can carry a path that identifies a build), no raw user id, no free-form error text. Errors are reduced
 * to a bounded code.
 */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type {
    MeasurementCompleteness, MeasurementReasonCode,
} from './acquisitionNetworkObservation';
import logger from '@/lib/logger';

/** What the cache boundary actually reported. `unobservable` is a real answer, never a stand-in for a guess. */
export type CacheResult = 'hit' | 'miss' | 'partial' | 'unobservable';

/** Why the load began. A warm-up and a user pressing "Set up Private" are different populations. */
export type AcquisitionTrigger = 'warmup' | 'explicit-setup';

/** Bounded failure vocabulary. A raw message could carry a URL, a path, or user text. */
export type AcquisitionErrorCode =
    | 'network'
    | 'integrity'
    | 'unsupported'
    | 'aborted'
    | 'storage'
    | 'timeout'
    | 'unknown';

export interface AcquisitionSubject {
    /** Resolved candidate id, e.g. `moonshine:streaming-medium`. */
    candidateId: string;
    /** Immutable model identity — the pinned version/arch, never a mutable tag. */
    modelIdentity: string;
    /** Digest identifying the exact pinned asset set. Identity, not location. */
    assetPinDigest: string | null;
    releaseId: string | null;
    trigger: AcquisitionTrigger;
}

export interface AcquisitionOutcome {
    /**
     * HOW MUCH OF THE DOWNLOAD THESE NUMBERS COVER.
     *
     * Carried end to end, because the consumer cannot recover it. Without this a v4 load whose requests
     * were partly redirected out of the declared scope published real bytes and a real duration that
     * covered an unknown fraction — and PostHog had no way to tell that from a complete, fast download.
     * A small number that looks complete is worse than no number: it argues for the wrong model.
     */
    completeness: MeasurementCompleteness;
    /** Bounded code only. The free-form reason never leaves the process. */
    reasonCode: MeasurementReasonCode | null;
    /** Requests in the acquisition window that fell outside the declared scope. Content-free count. */
    outOfScopeCount: number | null;
    cacheResult: CacheResult;
    /**
     * Did bytes cross the wire? MEASURED at the fetch boundary, never predicted from the cache probe.
     * `null` means the boundary could not say — a cross-origin response without Timing-Allow-Origin
     * hides its size — and null is the honest answer there. Defaulting to false would report every
     * unmeasurable download as a cache hit.
     */
    networkUsed: boolean | null;
    networkBytes: number | null;
    assetCount: number | null;
    /** Time spent fetching assets. Null when the boundary could not be observed. */
    downloadMs: number | null;
    /** Whole acquisition, download + initialisation. Always measurable. */
    totalMs: number;
}

/** The pinned assets a candidate needs, as identity — never as a printable location. */
export interface PinnedAssetRef { file: string; url: string; bytes?: number }

/**
 * Ask the REAL cache whether this candidate's assets are present.
 *
 * Returns `unobservable` rather than guessing whenever the boundary cannot be inspected: no Cache
 * Storage, a throwing `caches.match`, or an engine that keeps its assets somewhere we do not own.
 */
export async function probeCache(
    assets: readonly PinnedAssetRef[],
    cacheStorage: CacheStorage | undefined = typeof caches !== 'undefined' ? caches : undefined,
): Promise<CacheResult> {
    if (!cacheStorage || assets.length === 0) return 'unobservable';
    try {
        let present = 0;
        for (const asset of assets) {
            const match = await cacheStorage.match(asset.url);
            if (match) present += 1;
        }
        if (present === 0) return 'miss';
        if (present === assets.length) return 'hit';
        return 'partial';
    } catch {
        // An inspectable-looking boundary that throws is NOT a miss. Reporting `miss` here would
        // manufacture a download that may never have happened.
        return 'unobservable';
    }
}

/** Events are held until the authenticated identity settles, then flushed in order. */
type Pending = { name: string; props: Record<string, unknown> };
let pendingEvents: Pending[] = [];
let identitySettled = false;
let discardedOnTransition = 0;
let settledIdentity: string | null = null;

/**
 * Called once the authenticated identity is established (or definitively absent, for a signed-out
 * visitor). Until then, acquisition events wait: an event classified before identity settles is
 * attributed to anonymous traffic, and a returning user's cold and warm loads land under different
 * identities — which is exactly the per-user question this telemetry exists to answer.
 */
export function markIdentitySettled(identity: string | null = null): void {
    // THE EPOCH LIVES HERE, WITH THE QUEUE IT GOVERNS.
    //
    // It was previously tracked by a React ref in the provider, which a remount resets to null — so a
    // queue accumulated under one account could be released under the next one as though it were a
    // first authentication. The module that holds the events is the only thing that reliably knows
    // which account they were waiting for.
    if (identitySettled && settledIdentity === identity) return;
    if (settledIdentity !== null && settledIdentity !== identity) {
        // A DIFFERENT account is settling. Whatever is still queued was waiting for the previous one,
        // and an event attributed to the wrong account is worse than a missing one: it looks like data.
        discardedOnTransition += pendingEvents.length;
        pendingEvents = [];
    }
    settledIdentity = identity;
    identitySettled = true;
    const queued = pendingEvents;
    pendingEvents = [];
    for (const e of queued) emitNow(e.name, e.props);
}

/** Which identity the queue was last released under. Test seam; never emitted. */
export function __settledIdentity(): string | null { return settledIdentity; }

/**
 * #1259s — an account transition retires the previous settlement.
 *
 * Without this, an acquisition beginning after a sign-out or account switch would be released under the
 * identity that had already settled — attributing one person's model download to another.
 */
export function resetIdentitySettlement(): void {
    identitySettled = false;
    settledIdentity = null;
    // AND THE QUEUE GOES WITH IT. Clearing only the flag left account A's queued events in place to be
    // flushed the moment account B settled, which is the misattribution this function exists to prevent
    // rather than a smaller version of it. An event that cannot be attributed to the right account must
    // not be attributed to the wrong one, so it is dropped and counted.
    discardedOnTransition += pendingEvents.length;
    pendingEvents = [];
}

/** How many queued events an account transition discarded. Test seam; never emitted. */
export function __discardedCount(): number { return discardedOnTransition; }

/** Test seam: reset the module between cases. */
export function __resetAcquisitionTelemetry(): void {
    pendingEvents = [];
    identitySettled = false;
    discardedOnTransition = 0;
    settledIdentity = null;
}

export function __pendingCount(): number { return pendingEvents.length; }

/**
 * Test seam: re-open the queue under the CURRENT epoch, as a load still in flight when the account
 * changes would be. Deliberately does not touch `settledIdentity` — the epoch is what is under test.
 */
export function __queueForCurrentEpoch(): void {
    identitySettled = false;
    pendingEvents.push({ name: 'private_model_acquisition_start', props: { outcome: 'queued' } });
}

function emitNow(name: string, props: Record<string, unknown>): void {
    try {
        analyticsBuffer.push(name as never, props as never);
    } catch (err) {
        // TELEMETRY MUST NEVER BLOCK READINESS. A model the user can speak into is worth more than a
        // record that they did; a throwing analytics transport must not become a failed setup.
        logger.warn({ err }, '[modelAcquisition] telemetry emit failed; model readiness is unaffected');
    }
}

function emit(name: string, props: Record<string, unknown>): void {
    if (!identitySettled) { pendingEvents.push({ name, props }); return; }
    emitNow(name, props);
}

/**
 * THE SUBJECT IS NAMED UNDER ITS OWN KEYS, not the envelope's.
 *
 * `candidate_id`, `engine`, `runtime_version` and `asset_digest` belong to the analytics ENVELOPE: the
 * send boundary strips them from producer props and supplies what the engine actually RESOLVED, so a
 * caller cannot claim a model it did not run. That rule is right, and it is fatal here — during a cold
 * load nothing has resolved yet, so an acquisition event that named its subject `candidate_id` had that
 * value replaced with the ambient one, which is null before the first load and STALE during a switch.
 * The two facts are genuinely different: the envelope says what this tab is running, and these keys say
 * what was being fetched. They are reported separately so neither can overwrite the other.
 */
const subjectProps = (s: AcquisitionSubject) => ({
    acquired_candidate_id: s.candidateId,
    model_identity: s.modelIdentity,
    asset_pin_digest: s.assetPinDigest,
    release_id: s.releaseId,
    trigger: s.trigger,
});

export function recordAcquisitionStart(subject: AcquisitionSubject, cacheResult: CacheResult): void {
    emit('private_model_acquisition_start', { ...subjectProps(subject), cache_result: cacheResult });
}

export function recordAcquisitionSuccess(subject: AcquisitionSubject, outcome: AcquisitionOutcome): void {
    // THE COMPLETE FIELDS ARE NEVER OVERLOADED.
    //
    // `network_bytes` and `download_ms` mean "this is the whole download". A partial observation carries
    // real numbers over an unknown fraction, so it is published under explicitly partial names instead —
    // a consumer that only knows the complete fields sees null and correctly concludes it does not know,
    // rather than averaging a redirected v4 load into the fleet as a fast one.
    const complete = outcome.completeness === 'complete';
    const partial = outcome.completeness === 'partial';

    emit('private_model_acquisition_success', {
        ...subjectProps(subject),
        cache_result: outcome.cacheResult,
        measurement_completeness: outcome.completeness,
        measurement_reason_code: outcome.reasonCode,
        out_of_scope_count: outcome.outOfScopeCount,

        // Observed, or null. Never the registry's configured component count: expected inventory is not
        // an observation, and substituting it is how an unmeasured load looked measured.
        asset_count: outcome.assetCount,
        // `network_used` is an observation in its own right — a non-zero transfer proves the wire
        // whether or not every request was matched — so it survives a partial measurement.
        network_used: outcome.networkUsed,

        network_bytes: complete ? outcome.networkBytes : null,
        download_ms: complete ? outcome.downloadMs : null,
        // Separated deliberately: a cached load still initialises, and conflating the two is what made
        // the original number unusable. Only derivable when the download figure is the whole download.
        //
        // `init_ms` is everything in the acquisition that was NOT the observed download — which includes
        // the cache inspection, since `total_ms` now spans it. That is the honest reading: the probe is
        // setup work the user waits through, and it is not transfer time.
        init_ms: complete && outcome.downloadMs !== null
            ? Math.max(0, outcome.totalMs - outcome.downloadMs)
            : null,

        partial_network_bytes: partial ? outcome.networkBytes : null,
        partial_download_ms: partial ? outcome.downloadMs : null,

        // Always measurable: this is wall time around the whole acquisition, not a network figure.
        total_ms: outcome.totalMs,
        outcome: 'success',
    });
}

export function recordAcquisitionFailure(
    subject: AcquisitionSubject,
    cacheResult: CacheResult,
    errorCode: AcquisitionErrorCode,
    totalMs: number,
): void {
    emit('private_model_acquisition_failure', {
        ...subjectProps(subject),
        cache_result: cacheResult,
        error_code: errorCode,
        total_ms: totalMs,
        outcome: 'failure',
    });
}

/**
 * Reduce any thrown value to a bounded code. A raw message may contain an asset URL, a filesystem path,
 * or text the user typed, none of which may enter telemetry.
 */
export function classifyAcquisitionError(err: unknown): AcquisitionErrorCode {
    const name = err instanceof Error ? `${err.name} ${err.message}`.toLowerCase() : String(err ?? '').toLowerCase();
    if (name.includes('abort')) return 'aborted';
    if (name.includes('timeout') || name.includes('timed out')) return 'timeout';
    if (name.includes('integrity') || name.includes('sha-256') || name.includes('digest')) return 'integrity';
    if (name.includes('quota') || name.includes('storage')) return 'storage';
    if (name.includes('unsupported') || name.includes('not supported')) return 'unsupported';
    if (name.includes('network') || name.includes('fetch') || name.includes('http')) return 'network';
    return 'unknown';
}
