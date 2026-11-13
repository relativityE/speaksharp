/**
 * Where the wait after Stop goes, on Private Whisper.
 *
 * `recording_terminated` reports Stop to `stopTranscription()` resolving. PostHog shows it grows with
 * take length (about 4s for takes under 15s, about 14s for 15s to 3min), but one interval cannot say
 * whether the time is the drain of an in-flight live decode, the utterance preprocessing, or the
 * whole-utterance model decode. PrivateWhisper already measures all three into
 * `window.__PRIVATE_TIMING__`; this sends them as three `stage_latency` rows beside the chain.
 *
 * Diagnostics only: it reads, never gates, and emits nothing it cannot attribute to THIS stop.
 */
import { emitStageLatency } from './journeyEvents';

export interface FinalizeTimingLike {
    finalizeWaitMs: number | null;
    finalizePrepMs: number | null;
    finalizeDecodeMs: number | null;
    updatedAtMs: number;
}

export function readPrivateTimingSummary(): FinalizeTimingLike | null {
    if (typeof window === 'undefined') return null;
    const t = (window as unknown as { __PRIVATE_TIMING__?: FinalizeTimingLike }).__PRIVATE_TIMING__;
    return t ?? null;
}

/**
 * Emit the three finalize intervals for the stop that started at `stopEntryPerfMs`.
 *
 * OVERLAP: the controller refuses a new Start while a stop is still finalizing
 * (StartRefusedFinalizationError), so only one Whisper take can be finalizing when this runs.
 *
 * FRESHNESS: the summary is page-global. A non-Whisper engine never writes it, so after a Whisper take
 * it still holds that take's numbers. A summary last published before this stop began belongs to an
 * earlier take, and is dropped rather than misattributed.
 */
export function emitFinalizeBreakdown(
    timing: FinalizeTimingLike | null,
    stopEntryPerfMs: number | null,
    stoppingMode: string | null,
): number {
    // Only a Private Whisper stop writes these numbers. Any other engine's stop gets none, even if the
    // page still holds a recent Whisper summary.
    if (stoppingMode !== 'private') return 0;
    if (!timing || stopEntryPerfMs === null) return 0;
    if (!Number.isFinite(timing.updatedAtMs) || timing.updatedAtMs < stopEntryPerfMs) return 0;
    let emitted = 0;
    const rows: Array<['stop_finalize_wait' | 'stop_finalize_prep' | 'stop_finalize_decode', number | null]> = [
        ['stop_finalize_wait', timing.finalizeWaitMs],
        ['stop_finalize_prep', timing.finalizePrepMs],
        ['stop_finalize_decode', timing.finalizeDecodeMs],
    ];
    for (const [stage, ms] of rows) {
        // null means "not measured" (for example no whole-utterance commit): nothing is sent, and it is
        // never turned into a 0. A measured 0 is a real value and IS sent.
        if (ms === null || !Number.isFinite(ms) || ms < 0) continue;
        emitStageLatency(stage, ms);
        emitted += 1;
    }
    return emitted;
}
