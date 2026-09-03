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
    cacheResult: CacheResult;
    /** Did bytes cross the network? Distinct from cacheResult: a partial hit still downloads. */
    networkUsed: boolean;
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

/**
 * Called once the authenticated identity is established (or definitively absent, for a signed-out
 * visitor). Until then, acquisition events wait: an event classified before identity settles is
 * attributed to anonymous traffic, and a returning user's cold and warm loads land under different
 * identities — which is exactly the per-user question this telemetry exists to answer.
 */
export function markIdentitySettled(): void {
    if (identitySettled) return;
    identitySettled = true;
    const queued = pendingEvents;
    pendingEvents = [];
    for (const e of queued) emitNow(e.name, e.props);
}

/** Test seam: reset the module between cases. */
export function __resetAcquisitionTelemetry(): void {
    pendingEvents = [];
    identitySettled = false;
}

export function __pendingCount(): number { return pendingEvents.length; }

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

const subjectProps = (s: AcquisitionSubject) => ({
    candidate_id: s.candidateId,
    model_identity: s.modelIdentity,
    asset_pin_digest: s.assetPinDigest,
    release_id: s.releaseId,
    trigger: s.trigger,
});

export function recordAcquisitionStart(subject: AcquisitionSubject, cacheResult: CacheResult): void {
    emit('private_model_acquisition_start', { ...subjectProps(subject), cache_result: cacheResult });
}

export function recordAcquisitionSuccess(subject: AcquisitionSubject, outcome: AcquisitionOutcome): void {
    emit('private_model_acquisition_success', {
        ...subjectProps(subject),
        cache_result: outcome.cacheResult,
        network_used: outcome.networkUsed,
        network_bytes: outcome.networkBytes,
        asset_count: outcome.assetCount,
        // Separated deliberately: a cached load still initialises, and conflating the two is what made
        // the previous number unusable.
        download_ms: outcome.downloadMs,
        init_ms: outcome.downloadMs === null ? null : Math.max(0, outcome.totalMs - outcome.downloadMs),
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
