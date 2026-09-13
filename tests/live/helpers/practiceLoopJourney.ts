/**
 * #1437 — THE PRACTICE LOOP JOURNEY VERDICT, AS A PURE FUNCTION.
 *
 * The live spec drives canonical Production and collects evidence; this decides whether that evidence
 * shows the journey PO's procedure requires. Splitting them is deliberate and load-bearing:
 *
 *   - a Production run proves the journey happened, but it cannot prove the CHECK would have caught a
 *     failure, because you cannot make Production fail on demand;
 *   - a pure verdict over a described journey can be driven through every failure shape in ordinary CI.
 *
 * #1424 taught this the hard way: eleven Codex findings against source-reading proofs, ended only by
 * observing the real request and making the judgement separately testable. Same shape here.
 *
 * EVIDENCE IS CONTENT-FREE BY CONSTRUCTION. The types below admit event names, closed enums, counts,
 * booleans and identifiers — there is no field for a transcript, a coaching phrase, a credential or a
 * provider body, so a spec cannot accidentally place one in an artifact.
 */

/** A terminal outcome for one review attempt. Exactly one is allowed per completed session. */
export type ReviewTerminalOutcome = 'rendered_success' | 'failed_safe' | 'refused_safe';

/** Telemetry the journey must show, by name only. */
export interface JourneyTelemetry {
    /** Ordered event names observed for THIS journey, deduplicated by occurrence, not by name. */
    readonly events: readonly string[];
    /** Completion stages the run reported as reached. */
    readonly stagesReached: readonly string[];
    /*
     * IDENTITY IS READ OUT OF THE OBSERVED ENVELOPES, never assigned from what the test expected
     * (Codex `3996845167`). Assigning the saved row's values made the comparisons tautologies.
     *
     * There is deliberately NO `boundSessionId`. No Practice Loop event carries a session id — the
     * allowlist keeps these events content-free, and a session id is user data. An earlier version of
     * this verdict demanded one, which could only ever be satisfied by copying the value in, which is
     * the tautology itself. The correlation spine the product actually publishes is
     * journey_id + attempt_id + candidate_id, so that is what is checked.
     */
    /** `candidate_id` from the envelope: the v2/v4/Moonshine identity, not the `private` facade. */
    readonly boundCandidateId: string | null;
    /** Distinct `attempt_id` values seen on this journey's review events. */
    readonly attemptIds: readonly string[];
    /** Distinct `journey_id` values seen on this journey's review events. */
    readonly journeyIds: readonly string[];
}

/**
 * #1437 RETURN `5649385757`, workstream 2 — THE COMPARISON SLATE AND THE ARM KEY.
 *
 * Mirrored from `runtimeCandidateSwitch.ts` (`COMPARISON_CANDIDATE_IDS`, `MODEL_COMPARISON_CDP_ARM_KEY`).
 * A live spec cannot import the transcription stack, so the values are restated here — and a unit test
 * compares them with the product's own constants, so a drift fails in ordinary CI instead of silently
 * running the wrong arm on Production.
 */
export const COMPARISON_TARGETS = Object.freeze(['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium'] as const);
export type ComparisonTarget = (typeof COMPARISON_TARGETS)[number];
export const MODEL_COMPARISON_CDP_ARM_KEY = 'speaksharp.model-comparison.cdp';

export interface PersistedTupleMapping {
    /** The `EngineVariant` half of `buildEngineVersion(variant, model)`. */
    readonly variant: string;
    /** The `model_name` the same save persists beside `engine_version`. */
    readonly modelName: string;
    /** The canonical registry candidate id this tuple denotes. */
    readonly candidateId: string;
}

/**
 * ONE EXPLICIT MAPPING from the persisted identity tuple to a canonical candidate id (Codex `3997967390`).
 *
 * The two namespaces are different by construction: `sessions.engine_version` is
 * `buildEngineVersion(variant, model)` — `private_v2:whisper-base.en` — while the registry and the
 * acquisition envelope speak `v2:base.en`. Comparing them directly rejects every correct save.
 *
 * `20260724220000_sessions_attribution_status.sql` forbids "engine_version string heuristics", so this is
 * deliberately NOT a normalizer. It is a closed table of the exact tuples the product writes: a value that
 * is not in it is refused, never guessed at, and an `engine_version` whose `model_name` disagrees is refused
 * as inconsistent. `v4:base:q4` is included not because it is on the slate but because it is what a v4 run
 * that fell back to the default variant persists — mapping it lets that report as a DIVERGENCE, which is
 * the truth, instead of as an unknown identity.
 */
export const PERSISTED_TUPLE_TO_CANDIDATE: Readonly<Record<string, PersistedTupleMapping>> = Object.freeze({
    'private_v2:whisper-base.en': { variant: 'private_v2', modelName: 'whisper-base.en', candidateId: 'v2:base.en' },
    'private_v4:distil_q4': { variant: 'private_v4', modelName: 'distil_q4', candidateId: 'v4:distil:q4' },
    'private_v4:base_q4': { variant: 'private_v4', modelName: 'base_q4', candidateId: 'v4:base:q4' },
    'private_moonshine:medium-streaming-en': {
        variant: 'private_moonshine', modelName: 'medium-streaming-en', candidateId: 'moonshine:streaming-medium',
    },
});

export function candidateFromPersistedTuple(
    engineVersion: string | null,
    modelName: string | null,
): { readonly candidateId: string } | { readonly failure: string } {
    if (!engineVersion || !modelName) {
        return { failure: 'the persisted row carries no complete engine_version/model_name tuple' };
    }
    const mapping = PERSISTED_TUPLE_TO_CANDIDATE[engineVersion];
    if (!mapping) {
        return { failure: `persisted engine_version ${engineVersion} is not a known candidate; unknown identities are refused, never guessed` };
    }
    if (mapping.modelName !== modelName) {
        return { failure: `persisted model_name ${modelName} disagrees with engine_version ${engineVersion}; the tuple is inconsistent` };
    }
    return { candidateId: mapping.candidateId };
}

/** The persisted identity columns, as read — including whether the attribution became trusted. */
export interface PersistedIdentity {
    readonly engineVersion: string | null;
    readonly modelName: string | null;
    /** `sessions.attribution_status`: `pending` | `verified` | `unverified` | `legacy_unknown`. */
    readonly attributionStatus: string | null;
}

/**
 * #1437 RETURN workstream 1 — COUNT REQUESTS AGAINST THE PRODUCT'S OWN SAVE BOUNDARY (Codex `3997967382`).
 *
 * The previous head sampled `Date.now()` after `stopBenchmarkRecording`, `waitForBenchmarkSaveCandidate` and
 * an attribute poll. The automatic request can fire inside that gap — correctly, after persistence — and was
 * then counted as a pre-save request. The boundary is `window.__SS_LAST_PERSISTED_SESSION__.at`, stamped by
 * `syncSessionPersisted` at the moment of persistence. With no boundary nothing is classified, and the
 * verdict reports the missing boundary rather than inventing an ordering.
 */
export function classifyRequestsByBoundary(
    requestTimes: readonly number[],
    boundaryAt: number | null,
): { readonly after: number; readonly atOrBefore: number } {
    if (boundaryAt === null || !Number.isFinite(boundaryAt)) return { after: 0, atOrBefore: 0 };
    return {
        after: requestTimes.filter((at) => at > boundaryAt).length,
        atOrBefore: requestTimes.filter((at) => at <= boundaryAt).length,
    };
}

export const TERMINAL_REVIEW_EVENTS = Object.freeze(['practice_loop_review_rendered', 'practice_loop_review_failed'] as const);

export interface CorrelatedTerminalWait {
    /** The whole observation window. The snapshot is frozen only when it ends. */
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly now: () => number;
    readonly sleep: (ms: number) => Promise<void>;
}

/**
 * #1437 RETURN workstream 1 — WAIT FOR THE TERMINAL EVENT TO LEAVE THE SDK QUEUE (Codex `3997967395`).
 *
 * The DOM turns terminal first; the terminal telemetry enters PostHog's batch queue at the same moment and
 * is flushed asynchronously (a 3 s default in the installed SDK). Counting at the DOM transition therefore
 * commonly sees no terminal outcome at all. This observes, bounded, for a terminal event correlated to THIS
 * take, and keeps observing until the deadline before returning a frozen snapshot.
 *
 * THROUGH THE WHOLE WINDOW, NOT A SETTLE INTERVAL (Codex `3998152257`). The previous head returned a fixed
 * interval after the first correlated terminal event, so a same-take duplicate arriving later — but still
 * inside the window — fell outside the snapshot and exactly-one passed on a take with two outcomes. The
 * snapshot is now frozen only at the deadline; `settled` records whether a correlated terminal was seen.
 *
 * THE CORRELATION KEY IS DISCOVERED INSIDE THE POLL, not before it (Codex `3998069827`). The event that names
 * the take — `session_saved` — travels through the same asynchronous queue as the terminal event, so a fast
 * review can reach the DOM before it is on the wire. The previous head read the key once, got `null`, and
 * never polled, failing a healthy run. `resolveCorrelation` is re-evaluated on every read; a take that never
 * appears is never correlated, and the wait ends unsettled at its deadline.
 *
 * JOURNEY AND ATTEMPT, BOTH (PM criterion). An attempt id alone is not the take's identity: a terminal event
 * carrying the same attempt id under a different journey is a different take, so it must not settle the wait
 * or be counted. A terminal event counts only when both ids match the saved take.
 */
export interface TakeCorrelation {
    readonly journeyId: string;
    readonly attemptId: string;
}

type CorrelatableEvent = { readonly name: string; readonly attemptId?: string; readonly journeyId?: string };

export async function awaitCorrelatedTerminal<T extends CorrelatableEvent>(
    read: () => readonly T[],
    resolveCorrelation: (events: readonly T[]) => TakeCorrelation | null,
    wait: CorrelatedTerminalWait,
): Promise<{ readonly settled: boolean; readonly events: readonly T[] }> {
    const correlated = (events: readonly T[]): boolean => {
        const take = resolveCorrelation(events);
        return take !== null && events.some((event) =>
            (TERMINAL_REVIEW_EVENTS as readonly string[]).includes(event.name)
            && event.attemptId === take.attemptId
            && event.journeyId === take.journeyId);
    };
    const deadline = wait.now() + wait.timeoutMs;
    let settled = false;
    for (;;) {
        if (!settled && correlated(read())) settled = true;
        if (wait.now() >= deadline) break;
        await wait.sleep(wait.intervalMs);
    }
    const frozen = [...read()];
    return { settled: settled || correlated(frozen), events: frozen };
}

/** The saved take's identity: the latest `session_saved` carrying BOTH a journey id and an attempt id. */
export function savedCorrelationOf<T extends CorrelatableEvent>(events: readonly T[]): TakeCorrelation | null {
    const saved = [...events].reverse().find((event) => event.name === 'session_saved' && event.attemptId && event.journeyId);
    return saved?.attemptId && saved.journeyId ? { journeyId: saved.journeyId, attemptId: saved.attemptId } : null;
}

type AcquisitionEvent = {
    readonly name: string;
    readonly expected?: string;
    readonly acquired?: string;
    readonly candidateId?: string;
};

/**
 * OBSERVED IDENTITY COMES ONLY FROM AFTER THE SWITCH (PM criterion; Codex `3997967389`).
 *
 * The page acquires its DEFAULT engine first, then the guarded switch tears it down and acquires the target
 * with `expected_candidate_id` set. Reading `acquired_candidate_id` from anywhere in the snapshot could lend
 * the default acquisition's identity to the take — and when the target IS the default (`v2:base.en`), that
 * borrowed value would even agree. So only events AFTER the last acquisition start bound to this target count,
 * preferring the acquisition's own `acquired_candidate_id`, then the envelope's running `candidate_id`. No
 * bound start, or nothing after it, is null — reported as incomplete, never filled in.
 */
export function observedCandidateAfterSwitch<T extends AcquisitionEvent>(events: readonly T[], target: string): string | null {
    const after = eventsAfterSwitch(events, target);
    if (after === null) return null;
    const acquired = [...after].reverse().find((event) => event.acquired)?.acquired;
    const running = [...after].reverse().find((event) => event.candidateId)?.candidateId;
    return acquired ?? running ?? null;
}

/**
 * RUNNING IDENTITY IS BOUND TO THE SWITCH TOO (PM `5649623145` item 3: observed / acquired / RUNNING).
 *
 * The envelope's `candidate_id` feeds the verdict's `boundCandidateId`. Taking the latest one from the whole
 * snapshot would, when nothing after the switch carries it, hand the default engine's pre-switch value to the
 * take — the same borrow as above, on a different field. Only events after the target-bound start count.
 */
export function runningCandidateAfterSwitch<T extends AcquisitionEvent>(events: readonly T[], target: string): string | null {
    const after = eventsAfterSwitch(events, target);
    if (after === null) return null;
    return [...after].reverse().find((event) => event.candidateId)?.candidateId ?? null;
}

/** Events strictly after the LAST acquisition start bound to `target`; null when no such start exists. */
function eventsAfterSwitch<T extends AcquisitionEvent>(events: readonly T[], target: string): readonly T[] | null {
    let boundAt = -1;
    events.forEach((event, index) => {
        if (event.name === 'private_model_acquisition_start' && event.expected === target) boundAt = index;
    });
    return boundAt === -1 ? null : events.slice(boundAt + 1);
}

export interface PracticeLoopJourneyEvidence {
    /** The saved session's id, from the persistence boundary. */
    readonly savedSessionId: string | null;
    /** Whether the save reached a completed, persisted state. */
    readonly sessionSaved: boolean;
    /**
     * The product's own persistence boundary, `window.__SS_LAST_PERSISTED_SESSION__` (Codex `3997967382`).
     * `markerSessionId` must name the same session as `savedSessionId`, or the timestamp is someone else's.
     */
    readonly persistenceBoundary: { readonly markerSessionId: string | null; readonly at: number | null };
    /**
     * Coaching requests made STRICTLY AFTER persistence (Codex `3996845181`). A request that fired
     * before the save is not the automatic post-save behaviour, even when a review later renders, so it
     * is counted separately and refused rather than folded into the total.
     */
    readonly suggestionRequests: number;
    /** Coaching requests observed at or before persistence. Any is a defect. */
    readonly suggestionRequestsBeforeSave: number;
    /** True only if a human-equivalent action (button, retry, refresh) triggered generation. */
    readonly manualGenerationTriggered: boolean;
    /** The review surface's terminal state, as rendered. */
    readonly renderedPhraseCounts: { readonly whatWentWell: number; readonly whatToImprove: number };
    /** Terminal outcomes observed for this session's review. */
    readonly terminalOutcomes: readonly ReviewTerminalOutcome[];
    /** Whether the correlated terminal wire event was observed before the counts were frozen. */
    readonly terminalFlushSettled: boolean;
    /**
     * The EXPLICIT target and what the guarded switch reported for it (Codex `3997967389`). Requested
     * identity is derived from `target` and nothing else — there is no separate `requested` a caller could
     * fill in, because the previous head's requested value was null on every canonical run.
     */
    readonly candidateSwitch: { readonly target: string; readonly outcome: string };
    /** What the engine acquired for that target, from the envelope — null if no acquisition was bound to it. */
    readonly observedCandidate: string | null;
    /** The persisted identity tuple and its attribution status, read with the service role. */
    readonly persistedIdentity: PersistedIdentity;
    readonly telemetry: JourneyTelemetry;
}

/**
 * The documented journey, in order, for a rendered success (Codex `3996845178`).
 *
 * The first version required only requested → rendered, so a run that lost `session_saved`,
 * `_completed` or `_persisted` still passed while claiming the journey was reconstructable. It was not:
 * a funnel missing its middle cannot tell a delivered review from a lucky render.
 */
const REQUIRED_SUCCESS_SEQUENCE = [
    'session_saved',
    'practice_loop_review_requested',
    'practice_loop_review_completed',
    'practice_loop_review_persisted',
    'practice_loop_review_rendered',
] as const;

const STAGES_THAT_REQUIRE_A_RENDERED_REVIEW = ['practice_loop_ready', 'review_rendered'] as const;

/**
 * Every way the journey can fail PO's procedure, as a list. Empty means the journey is proven.
 *
 * Each check states the user-visible fact it protects, because a proof nobody can read is a proof
 * nobody maintains.
 */
export function practiceLoopJourneyFailures(evidence: PracticeLoopJourneyEvidence): string[] {
    const failures: string[] = [];

    // 1. A fresh authenticated session starts, completes and saves.
    if (!evidence.sessionSaved) failures.push('the session did not reach a saved state');
    if (!evidence.savedSessionId) failures.push('the saved session has no id, so nothing downstream can be bound to it');

    // 1b. The persistence boundary is the product's own, and it names THIS session.
    const { markerSessionId, at: boundaryAt } = evidence.persistenceBoundary;
    const boundaryKnown = boundaryAt !== null && Number.isFinite(boundaryAt);
    if (!boundaryKnown) {
        failures.push('the product published no persistence timestamp, so post-save ordering cannot be established');
    }
    if (markerSessionId !== evidence.savedSessionId) {
        failures.push('the persistence timestamp belongs to a different session than the one saved');
    }

    // 2. Suggestions start AUTOMATICALLY — no click, no retry, no refresh, and exactly one request.
    if (evidence.manualGenerationTriggered) {
        failures.push('generation was triggered manually; the contract is automatic on save');
    }
    // Request ordering is only meaningful against a real boundary; without one it is reported above.
    if (boundaryKnown) {
        if (evidence.suggestionRequestsBeforeSave > 0) {
            failures.push(`${evidence.suggestionRequestsBeforeSave} coaching request(s) fired at or before persistence; the contract is automatic AFTER a successful save`);
        }
        if (evidence.suggestionRequests === 0) {
            failures.push('no automatic suggestion request was made after the save');
        } else if (evidence.suggestionRequests > 1) {
            failures.push(`${evidence.suggestionRequests} suggestion requests were made; exactly one is allowed per uncached session`);
        }
    }

    // 3. Exactly one valid 1+1 review becomes visible.
    const { whatWentWell, whatToImprove } = evidence.renderedPhraseCounts;
    if (whatWentWell !== 1 || whatToImprove !== 1) {
        failures.push(`the review rendered ${whatWentWell} strength(s) and ${whatToImprove} improvement(s); the contract is exactly one of each`);
    }

    // 4. Exactly one terminal outcome, counted only after the correlated wire event was observed.
    if (!evidence.terminalFlushSettled) {
        failures.push('the correlated terminal telemetry was not observed within the bounded wait, so outcomes were counted from an incomplete batch');
    }
    if (evidence.terminalOutcomes.length === 0) {
        failures.push('the review reached no terminal outcome');
    } else if (evidence.terminalOutcomes.length > 1) {
        failures.push(`${evidence.terminalOutcomes.length} terminal outcomes were recorded; exactly one is allowed (${evidence.terminalOutcomes.join(', ')})`);
    }
    const [outcome] = evidence.terminalOutcomes;

    // 5. Telemetry correlates the journey, in order, and is bound to THIS session, attempt and candidate.
    const { events, stagesReached, boundCandidateId, attemptIds, journeyIds } = evidence.telemetry;
    if (outcome === 'rendered_success') {
        let cursor = -1;
        for (const required of REQUIRED_SUCCESS_SEQUENCE) {
            const index = events.indexOf(required, cursor + 1);
            if (index === -1) {
                failures.push(`telemetry is missing ${required} after the preceding step, so the journey cannot be reconstructed`);
                break;
            }
            cursor = index;
        }
        // A rendered review MUST claim both links. Requiring them only in the negative let a success
        // pass with neither, which is the other half of #1422's rule.
        for (const stage of STAGES_THAT_REQUIRE_A_RENDERED_REVIEW) {
            if (!stagesReached.includes(stage)) {
                failures.push(`${stage} was not marked despite a rendered review`);
            }
        }
    }

    /*
     * ONE attempt and ONE journey, read from the envelopes. Cross-take contamination is the failure
     * #1432's attribution cannot survive: two attempts inside one settled take means a row cannot be
     * ascribed to a candidate, however green the rest looks.
     */
    if (attemptIds.length > 1) {
        failures.push(`${attemptIds.length} distinct attempt ids appear on this journey's review events; a settled take has exactly one`);
    }
    if (journeyIds.length > 1) {
        failures.push(`${journeyIds.length} distinct journey ids appear on this journey's review events; a settled take has exactly one`);
    }
    if (outcome && attemptIds.length === 0) {
        failures.push('no attempt id is present on the review events, so the take cannot be attributed');
    }

    // 6. A review that did NOT render must not claim the completion stages.
    if (outcome !== 'rendered_success') {
        for (const stage of STAGES_THAT_REQUIRE_A_RENDERED_REVIEW) {
            if (stagesReached.includes(stage)) {
                failures.push(`${stage} was marked without a rendered review (outcome: ${outcome ?? 'none'})`);
            }
        }
    }

    // 7. The take ran the EXPLICIT target, through the guarded switch.
    const { target, outcome: switchOutcome } = evidence.candidateSwitch;
    if (!(COMPARISON_TARGETS as readonly string[]).includes(target)) {
        failures.push(`requested target ${target} is not in the three-model comparison`);
    }
    if (switchOutcome !== 'ok') {
        failures.push(`the guarded candidate switch to ${target} did not succeed (${switchOutcome})`);
    }

    // 8. Persisted identity is TRUSTED only once attribution is verified (Codex `3997967394`). A `pending` row
    // still carries client-supplied identity columns, so reading them as proof would credit the take to an
    // identity the trusted attestation never confirmed.
    const { engineVersion, modelName, attributionStatus } = evidence.persistedIdentity;
    if (attributionStatus !== 'verified') {
        failures.push(`persisted attribution is ${attributionStatus ?? 'absent'}, not verified; an unverified row cannot prove which model ran`);
    }
    const mapped = candidateFromPersistedTuple(engineVersion, modelName);
    if ('failure' in mapped) failures.push(mapped.failure);
    const trustedPersisted = attributionStatus === 'verified' && 'candidateId' in mapped ? mapped.candidateId : null;

    // 9. Requested (the target), observed and trusted-persisted identity agree — the down-selection's basis.
    const requested = target;
    const observed = evidence.observedCandidate;
    if (!observed || !trustedPersisted) {
        failures.push('model identity is incomplete at one of requested/observed/persisted');
    } else if (!(requested === observed && observed === trustedPersisted)) {
        failures.push(`model identity diverges: requested=${requested} observed=${observed} persisted=${trustedPersisted}`);
    }
    // A running binding is REQUIRED, not merely compared when present (Codex `3998152255`). Running identity is
    // null when nothing after the switch carried `candidate_id`; accepting that let target, acquired and persisted
    // agree with no evidence of which candidate actually ran.
    if (!boundCandidateId) {
        failures.push('no post-switch running identity was observed, so the take cannot be bound to the candidate that ran');
    } else if (trustedPersisted && boundCandidateId !== trustedPersisted) {
        failures.push('telemetry is bound to a different candidate than the one persisted');
    }
    // The facade is not an identity. `private` agreeing with `private` proves nothing about which of
    // v2, v4 or Moonshine ran, and a down-selection built on that is unattributable.
    for (const [label, value] of [['requested', requested], ['observed', observed], ['persisted', engineVersion]] as const) {
        if (value && /^(private|browser|cloud|native)$/i.test(value)) {
            failures.push(`${label} model identity is the product facade "${value}", not a candidate id`);
        }
    }

    return failures;
}

/**
 * #1437 — A ROUTE THAT DOES NOT EXIST MUST FAIL IMMEDIATELY.
 *
 * The previous head navigated to `/auth/login`, which is not a route (`App.tsx:439` defines
 * `/auth/signin`). The pre-credential step checked origin, release SHA and mock injection — all of
 * which hold on the app's 404 shell — so it PASSED, execution continued, and the run died later for an
 * unrelated reason. A surface check that a 404 satisfies is not a surface check.
 *
 * Pure, so the 404 case is a casualty in ordinary CI rather than something only Production can reveal.
 */
export interface RouteSurface {
    readonly path: string;
    readonly httpStatus: number | null;
    readonly origin: string;
    readonly releaseSha: string | null;
    readonly mockSurfacesPresent: boolean;
    /** True when the rendered page is the app's not-found shell. */
    readonly notFoundRendered: boolean;
    /**
     * POSITIVE PROOF (Codex `3997198050`). The checks above are all refusals, and refusals cannot
     * distinguish "the right page rendered" from "a redirect, a blank shell, or a loading state that
     * happens to trip none of them". These two say the route we asked for is the route we are on, and
     * that its own content actually mounted.
     */
    readonly observedPathname: string | null;
    readonly routeMarkerVisible: boolean;
    /**
     * THE CENTRALIZED AUTHORITY, NOT A SELECTOR (Codex `3997198050`, second pass; PM RETURN).
     *
     * `routeMarkerVisible` is a route-specific selector, and AGENTS.md is explicit that a selector is
     * not readiness proof: user-visible browser tests must consume `waitForAppVisibleReady`, which
     * requires `data-app-ready`, then `data-app-visible-ready`, then a shell with non-empty text. A form
     * can be in the DOM and visible while the app has not declared itself visible-ready, so the selector
     * alone can accept a surface the repository's own authority would refuse.
     */
    readonly appVisibleReady: boolean;
}

export function routeSurfaceFailures(surface: RouteSurface, approvedOrigin: string): string[] {
    const failures: string[] = [];
    if (surface.httpStatus === null) {
        failures.push(`${surface.path} returned no response`);
    } else if (surface.httpStatus < 200 || surface.httpStatus >= 400) {
        failures.push(`${surface.path} returned HTTP ${surface.httpStatus}`);
    }
    // The decisive one: a SPA serves its shell with 200 and renders not-found in the client, so status
    // alone cannot tell a real route from a typo.
    if (surface.notFoundRendered) failures.push(`${surface.path} rendered the not-found page; the route does not exist`);
    if (surface.origin !== approvedOrigin) failures.push(`origin ${surface.origin} is not the approved origin`);
    if (!surface.releaseSha || !/^[0-9a-f]{40}$/.test(surface.releaseSha)) {
        failures.push('the deployed release SHA is missing or malformed');
    }
    if (surface.mockSurfacesPresent) failures.push('mock surfaces are present on Production');

    // The route we landed on must be the route we asked for: a same-origin rewrite or redirect trips
    // none of the refusals above.
    if (surface.observedPathname !== surface.path) {
        failures.push(`expected to be on ${surface.path} but the browser is on ${surface.observedPathname ?? 'an unknown path'}`);
    }
    // And it must have actually rendered. A blank, loading or error shell satisfies every negative
    // check while showing the user nothing.
    if (!surface.routeMarkerVisible) {
        failures.push(`${surface.path} did not render its own content; the surface is blank, loading or errored`);
    }
    // And the app's own centralized readiness authority must agree. A visible form is this route's
    // evidence; `data-app-visible-ready` is the repository's.
    if (!surface.appVisibleReady) {
        failures.push(`${surface.path} never reported app-visible-ready; the app has not declared the route committed`);
    }
    return failures;
}

/**
 * Guard against a proof that quietly carries content. Applied to anything the spec is about to write to
 * an artifact — a journey proof must be reconstructable without ever holding a transcript or a phrase.
 */
export function contentLeaks(serialized: string, forbidden: readonly string[]): string[] {
    return forbidden
        .map((value) => value.trim())
        .filter((value) => value.length >= 8 && serialized.includes(value));
}
