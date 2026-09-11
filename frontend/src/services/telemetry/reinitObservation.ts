/**
 * #1259 F15 — repeated initialization, and WHY.
 *
 * Production already proves the repetition. In the PO's Open Mic take the engine reported setup three
 * times: 134 seconds, then 12 milliseconds, then 1 millisecond. Focus Points did the same. The
 * sub-second pairs prove the later ones were cache-served rather than re-downloads — so the cost is not
 * bandwidth, it is that the runtime tore an engine down and stood it up again, twice, inside one
 * session.
 *
 * What Production cannot say is why. `private_setup_started` carries no ordinal, no teardown cause,
 * and no interval since the engine was last ready, so three initializations are indistinguishable from
 * three unrelated sessions, and a re-init one second after readiness is indistinguishable from one
 * five minutes later.
 *
 * These three facts are what make the repetition diagnosable:
 *
 *   init_sequence                 the ordinal within this journey — 1 is a first load, 3 is a defect.
 *   ms_since_previous_ready       1ms means something tore down an engine that had just become
 *                                 usable; 300000ms is an idle reclamation working as designed.
 *   previous_teardown_cause       the reason the last engine went away, or null on a first load.
 */

let initSequence = 0;
let lastReadyAt: number | null = null;
let lastTeardownCause: string | null = null;

/** Called when an engine reaches READY. */
export function noteEngineReady(): void { lastReadyAt = Date.now(); }

/** Called when an engine is torn down, with the reason the runtime gave. */
export function noteEngineTeardown(cause: string | null): void {
    lastTeardownCause = cause;
}

/** The re-initialisation context for the acquisition about to start. */
export function nextInitContext(): {
    init_sequence: number;
    ms_since_previous_ready: number | null;
    previous_teardown_cause: string | null;
} {
    initSequence += 1;
    const delta = lastReadyAt === null ? null : Date.now() - lastReadyAt;
    return {
        init_sequence: initSequence,
        // A negative or absurd interval means the mark is stale, not that an age passed. Null is the
        // honest answer; a fabricated duration would be indistinguishable from a real measurement.
        ms_since_previous_ready: delta !== null && delta >= 0 && delta <= 86_400_000 ? delta : null,
        previous_teardown_cause: lastTeardownCause,
    };
}

/** A new journey starts a new count — ordinals are per-journey, not per-tab-lifetime. */
export function resetInitSequence(): void {
    initSequence = 0;
    lastReadyAt = null;
    lastTeardownCause = null;
}

export function __resetReinitObservationForTests(): void { resetInitSequence(); }
