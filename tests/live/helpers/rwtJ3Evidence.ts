/**
 * J3.a / J3.b (#1904, Sam's first Focus wave): the three checks the existing Focus journey (#1897) did not yet make, each a
 * pure verdict so its negative controls run offline. Nothing here is live proof; the live run is its own authorized packet.
 *
 *  - `focusAcceptancePrivacyVerdict` (step 2): the privacy choice is bound before Start. Coaching credit needs the saved
 *    Focus result to reach coaching, so acceptance needs the post-#1835 build with Save Yes / Coaching Yes. A pre-#1835
 *    build FAILS (the release under test is post-#1835); any other mode is a diagnostic run and HOLDS.
 *  - `focusSavedTimingVerdict` (step 3): the measured timing of the exact saved take, from saved state: the saved duration
 *    agrees with the take's own Start → Stop, the shown per-point average is that saved duration ÷ the detected points, and
 *    each saved detection time is inside the take.
 *  - `j3bRepeatReopenVerdict` (step 4): the one repeat take on the same set is its own save, its saved point results match
 *    the fixture (partial counts as detected), its reopened review shows exactly those results, and the first take's saved
 *    results are unchanged by it.
 *
 * Fail closed: an unreadable or missing input is HOLD, a contradiction is FAIL, PASS only when every part is proved.
 */
import type { ConsentMode, PrivacyBuild } from './rwtPracticeConsent';
import type { SavedFocusIdentityResult } from './rwtSavedFocusIdentity';

export type J3Verdict = { status: 'PASS' | 'FAIL' | 'HOLD'; reason: string };

export const J3_PRIVACY_ROW = 'practice privacy choice';
export const J3_SAVED_TIMING_ROW = 'saved timing matches the take';
export const J3B_REPEAT_ROW = 'J3.b: repeat take saved and reopened against the fixture';

/** The only consent mode that can earn J3 coaching credit. */
export const J3_ACCEPTANCE_CONSENT_MODE: ConsentMode = 'save_on_coaching_on';

/** `settlePracticeConsent` already threw on every unproven #1835 state; this decides what the settled state is worth. */
export function focusAcceptancePrivacyVerdict(input: { build: PrivacyBuild; mode: ConsentMode | null; choiceRecorded: boolean }): J3Verdict {
    if (input.build === 'predates_1835') return { status: 'FAIL', reason: 'legacy_build' };
    if (input.build !== 'includes_1835') return { status: 'HOLD', reason: 'build_unknown' };
    if (!input.choiceRecorded) return { status: 'HOLD', reason: 'choice_unverified' };
    if (input.mode !== J3_ACCEPTANCE_CONSENT_MODE) return { status: 'HOLD', reason: 'not_acceptance_mode' };
    return { status: 'PASS', reason: 'save_yes_coaching_yes' };
}

/** Saved duration vs the take's own Start → Stop. Node-side Start/Stop include page latency, so a few seconds either way. */
export const J3_DURATION_TOLERANCE_SECONDS = 5;
/** The same per-point tolerance the shown-average row already uses (rwtFocusPointsJourney AVERAGE_TOLERANCE_SECONDS). */
export const J3_AVERAGE_TOLERANCE_SECONDS = 4;

export interface SavedTimingObservation {
    /** Node-side seconds from the take's Start to its Stop. */
    elapsedSec: number;
    /** `objective_session.actual_duration_seconds` of THIS take's objective session; null when unread. */
    savedDurationSec: number | null;
    /** The per-point average the page showed after Stop (seconds); null when unread. */
    shownAverageSec: number | null;
    /** This take's saved evidence rows; null when unread. */
    evidence: readonly { verdict: string; detected_at_seconds: number | null }[] | null;
    /** How many points the fixture expects detected (covered + partial). */
    detectedExpected: number;
}

export function focusSavedTimingVerdict(o: SavedTimingObservation): J3Verdict {
    if (o.savedDurationSec === null || o.evidence === null) return { status: 'HOLD', reason: 'saved_unread' };
    if (o.shownAverageSec === null) return { status: 'HOLD', reason: 'average_unread' };
    if (!Number.isFinite(o.elapsedSec) || o.elapsedSec <= 0) return { status: 'HOLD', reason: 'take_unmeasured' };
    if (!Number.isFinite(o.savedDurationSec) || o.savedDurationSec <= 0) return { status: 'FAIL', reason: 'no_saved_duration' };
    if (Math.abs(o.savedDurationSec - o.elapsedSec) > J3_DURATION_TOLERANCE_SECONDS) return { status: 'FAIL', reason: 'duration_not_this_take' };
    const detected = o.evidence.filter((r) => r.verdict === 'detected');
    if (detected.length === 0 || detected.length !== o.detectedExpected) return { status: 'FAIL', reason: 'detected_count' };
    for (const r of o.evidence) {
        const t = r.detected_at_seconds;
        if (r.verdict === 'detected') {
            if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > o.savedDurationSec) return { status: 'FAIL', reason: 'detection_outside_take' };
        } else if (t !== null) return { status: 'FAIL', reason: 'time_on_undetected' };
    }
    if (Math.abs(o.shownAverageSec - o.savedDurationSec / detected.length) > J3_AVERAGE_TOLERANCE_SECONDS) {
        return { status: 'FAIL', reason: 'average_not_saved' };
    }
    return { status: 'PASS', reason: 'saved_timing' };
}

export interface RepeatReopenObservation {
    /** 'coaching_on' is the only mode whose reopened review shows point evidence. */
    reviewMode: string | null;
    firstSessionId: string | null;
    repeatSessionId: string | null;
    /** The first take's objective session id. */
    firstObjectiveId: string | null;
    /** The repeat take's objective session; null when absent, 'error' when unread. */
    repeatObjective: { id: string; source_session_id: string; brief_id: string } | null | 'error';
    /** Whether the repeat take saved its coaching: the reopened review shows point evidence only beside it. null: unread. */
    repeatCoachingSaved: boolean | null;
    /** The first take's brief: the set the repeat must reuse. */
    firstBriefId: string | null;
    /** `savedFocusIdentityVerdict` over the repeat take: fixture statuses, its saved points/evidence and its reopened review. */
    repeatIdentity: SavedFocusIdentityResult | null;
    /** `persistedVerdictMismatches` of the first take's evidence re-read after the repeat; null when unread. */
    firstMismatchesAfter: readonly number[] | null;
    /**
     * The session the reopened review card was actually read from (`loadedReviewSessionId`, the J1.d pattern: the card's
     * `data-session-id`). null: no id loaded in time. Evidence is read only from the card carrying the repeat's own id (Sam,
     * Nov 19 on 947d357), so a still-displayed first-take card with identical statuses can never stand in for the repeat.
     */
    repeatCardId: string | null;
}

export function j3bRepeatReopenVerdict(o: RepeatReopenObservation): J3Verdict {
    if (o.reviewMode !== 'coaching_on') return { status: 'HOLD', reason: 'not_acceptance_mode' };
    if (!o.firstSessionId || !o.firstObjectiveId) return { status: 'HOLD', reason: 'no_first_take' };
    if (!o.repeatSessionId) return { status: 'HOLD', reason: 'no_repeat_take' };
    if (o.repeatSessionId === o.firstSessionId) return { status: 'FAIL', reason: 'repeat_is_first_take' };
    if (o.repeatObjective === 'error') return { status: 'HOLD', reason: 'repeat_unread' };
    if (o.repeatObjective === null) return { status: 'FAIL', reason: 'repeat_not_scored' };
    if (o.repeatObjective.source_session_id !== o.repeatSessionId) return { status: 'FAIL', reason: 'repeat_result_substituted' };
    if (o.repeatObjective.id === o.firstObjectiveId) return { status: 'FAIL', reason: 'repeat_result_substituted' };
    if (!o.firstBriefId || o.repeatObjective.brief_id !== o.firstBriefId) return { status: 'FAIL', reason: 'not_the_same_set' };
    if (o.firstMismatchesAfter === null || o.repeatCoachingSaved === null) return { status: 'HOLD', reason: 'saved_unread' };
    if (o.firstMismatchesAfter.length > 0) return { status: 'FAIL', reason: 'first_take_changed' };
    if (!o.repeatCoachingSaved) return { status: 'HOLD', reason: 'no_saved_review' };
    if (o.repeatCardId === null) return { status: 'HOLD', reason: 'repeat_card_not_loaded' };
    if (o.repeatCardId !== o.repeatSessionId) return { status: 'FAIL', reason: 'repeat_card_wrong_id' };
    if (o.repeatIdentity === null) return { status: 'HOLD', reason: 'saved_unread' };
    if (o.repeatIdentity.verdict !== 'PASS') return { status: 'FAIL', reason: 'repeat_differs_from_fixture' };
    return { status: 'PASS', reason: 'repeat_saved_and_reopened' };
}

/** The smallest part of a Playwright page the card scope needs. */
export interface CardScopePage<L> { locator(selector: string): L }

/** The saved-review card carrying exactly this session id (`data-session-id`); ids are UUIDs, so the selector is exact. */
export function repeatReviewCard<L>(page: CardScopePage<L>, sessionId: string): L {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('repeat card scope needs a session UUID (fail closed)');
    return page.locator(`[data-testid="saved-review"][data-session-id="${sessionId}"]`);
}
