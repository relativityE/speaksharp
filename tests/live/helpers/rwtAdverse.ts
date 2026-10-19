/**
 * RWT R3 (row 17) — the pure verdicts behind `rwt-adverse-mic-model`: a blocked microphone, a Private model download
 * that fails, and the network going away mid-download. Free of Playwright so every rule is unit-tested with its failing
 * controls. Inputs are content-free: states, counts and booleans.
 */
import type { TabState, Verdict } from './rwtAbandonTakeover';

export const ADVERSE_SUITE = 'adverse-mic-model';
export const ADVERSE_VARIANTS = ['mic-denied', 'download-fails', 'offline-mid-download'] as const;
export type AdverseVariant = (typeof ADVERSE_VARIANTS)[number];

/** The product's own copy for a blocked microphone (useSessionLifecycle.getStartFailureMessage). */
export const MIC_BLOCKED_COPY = 'Microphone access is blocked. Allow microphone access and try again.';
/** The Private model's own-origin assets: the only requests the download cases alter. */
export const MODEL_ASSETS = '**/models/**';
export const MODEL_FAILED_STATES = ['error', 'init-failed'] as const;

/** Blocked microphone: the denial actually applied, the page says so, and nothing records or holds a track. */
/**
 * #1593 (Sam, #1662 RETURN): the case is exercised only when the APPLICATION's acquisition was refused with a
 * NotAllowedError — what a blocked site setting does and what the product reads. A permission query is informational: it
 * can read "denied" while a fake-media flag still grants a live track (live case 12), or "prompt" while acquisition is denied.
 */
/**
 * Sam, #1662 RETURN (case 12, press-bound denial): only an acquisition refusal recorded AFTER this press qualifies — an
 * earlier rejection on the page cannot qualify a later Start that failed for another reason.
 */
export function deniedAfterPress(rejections: readonly string[], rejectionsBeforePress: number): boolean {
    return rejections.slice(rejectionsBeforePress).includes('NotAllowedError');
}

export function micDeniedVerdict(o: { deniedAtAcquisition: boolean; blockedCopyShown: boolean; tab: TabState }): Verdict {
    if (!o.deniedAtAcquisition) return { status: 'HOLD', detail: 'the page\'s microphone acquisition was never refused with NotAllowedError, so the case was not exercised' };
    if (!o.blockedCopyShown) return { status: 'FAIL', detail: 'the page did not say the microphone is blocked' };
    if (o.tab.runtimeState === 'RECORDING' || o.tab.recorderVisible) return { status: 'FAIL', detail: 'the page shows a recording although the microphone is blocked' };
    if (o.tab.liveTracks > 0) return { status: 'FAIL', detail: 'a microphone track is live although access is blocked' };
    return { status: 'PASS', detail: 'the page says the microphone is blocked, and nothing records' };
}

/**
 * A failing model download: the fault reached the download, the page never claimed `ready`, it ended in a failed state
 * with Retry, and the engine stayed Private.
 */
export function downloadFailureVerdict(o: {
    exercised: boolean; statuses: readonly string[]; finalStatus: string | null; retryOffered: boolean; mode: string | null;
}): Verdict {
    if (!o.exercised) return { status: 'HOLD', detail: 'the fault never reached the model download, so the case was not exercised' };
    if (o.statuses.includes('ready')) return { status: 'FAIL', detail: 'the page claimed the model was ready while its download was failing' };
    if (!(MODEL_FAILED_STATES as readonly string[]).includes(o.finalStatus ?? '')) {
        return { status: 'FAIL', detail: `the download failure ended as ${o.finalStatus ?? 'unreadable'}, not a failed state` };
    }
    if (!o.retryOffered) return { status: 'FAIL', detail: 'the failed download offered no Retry' };
    if (o.mode !== 'private') return { status: 'FAIL', detail: `the engine left Private (${o.mode ?? 'unreadable'})` };
    return { status: 'PASS', detail: 'the failed download was stated with Retry, never claimed ready, and the engine stayed Private' };
}

/** After the cause is removed, the person's own action recovers: a take records and saves one completed session. */
export function recoveredTakeVerdict(o: { recorded: boolean; savedId: string | null; savedStatus: string | null }): Verdict {
    if (!o.recorded) return { status: 'FAIL', detail: 'no take recorded after the cause was removed' };
    if (o.savedId === null) return { status: 'FAIL', detail: 'the recovered take bound no saved session' };
    if (o.savedStatus !== 'completed') return { status: 'FAIL', detail: `the recovered take is ${o.savedStatus ?? 'unreadable'}, not completed` };
    return { status: 'PASS', detail: 'after the cause was removed, a take recorded and saved one completed session' };
}
