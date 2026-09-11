/**
 * #1259 F03 / F08 — where the user meant to go, and where they ended up.
 *
 * F03 IS A NAMING COLLISION WITH TWO DIFFERENT ACTIONS BEHIND IT. Two controls in the shipped product
 * carry the same words:
 *
 *   ObjectiveSetupForm.tsx:305   "Start speaking →"          navigates, and starts nothing
 *   MicCard.tsx:99               "Press to start speaking"   actually starts recording
 *
 * A user who reads the first as a promise gets a page that waits for a second click. Nothing in
 * telemetry distinguishes those two controls today — `practice_mode_selected` records the mode and
 * never the control — so the mismatch is currently a source reading rather than a measurement. This
 * records the control's identity ALONGSIDE what it actually did, which is what makes the collision a
 * fact instead of an argument.
 *
 * F08 IS ABSENCE. The finding is that a finished session offers nowhere to go. Absence cannot be
 * proven by an event that never fires, so `options_shown` is emitted with its real contents — an
 * empty list where there is nothing to offer. An empty list is a measurement; a missing event is not.
 *
 * ROUTES, NEVER URLS. The `route` rule rejects query strings and fragments, which is where identifiers
 * and user content live. A pathname carrying a session id would be rejected by that rule rather than
 * quietly sent, so paths are normalised before they are offered.
 */
import { safeEmit } from './safeEmit';

export type JourneyStepKind =
    | 'route_change'
    | 'cta_click'
    | 'setup_submitted'
    | 'post_session_options'
    | 'option_selected';

/** What a control DID, as distinct from what it said. The whole of F03 lives in this gap. */
export type CtaAction = 'navigate' | 'start_recording' | 'submit' | 'none';

/**
 * Replace path segments that carry identifiers with a stable placeholder.
 *
 * `/analytics/9f2c…` is a session id in a pathname. Sending it raw would put an identifier into
 * telemetry through a field that looks innocent, and the schema would reject it anyway — so the
 * normalisation happens here, where the reason for it is visible, rather than showing up downstream
 * as an inexplicably dropped field.
 */
/**
 * A segment is kept ONLY if it looks like a route word. Everything else becomes `id`.
 *
 * This is deliberately an allowlist rather than a list of identifier shapes to catch. The previous
 * version tested `/^[0-9a-f]{8,}$/i`, which requires hex ONLY — so a standard hyphenated UUID such as
 * `9f2c4b1e-8a7d-4c3b-9e1f-2a3b4c5d6e7f` did not match, and `/analytics/:sessionId` exported the
 * persisted session identifier into `journey_step.from_route` / `to_route`. The route rule permits
 * hyphens, so nothing downstream caught it either.
 *
 * Enumerating the shapes an identifier can take is a losing game; the shapes a ROUTE WORD can take is
 * a short, closed list. A lowercase word, optionally hyphenated. Anything else — digits, mixed case,
 * hyphenated UUIDs, base64ish tokens, anything unforeseen — is redacted.
 *
 * The cost is that a legitimate segment containing a digit (`/v2/`) is redacted too. That is the right
 * side to be wrong on: the loss is a little reporting fidelity, and the alternative is exporting an
 * identifier we promised never to send.
 */
const ROUTE_WORD = /^[a-z][a-z-]*$/;

export function normaliseRoute(pathname: string | null | undefined): string | null {
    if (!pathname || !pathname.startsWith('/')) return null;
    return pathname
        .split('?')[0]
        .split('#')[0]
        .split('/')
        .map((seg) => (seg === '' || ROUTE_WORD.test(seg) ? seg : 'id'))
        .join('/');
}

export interface JourneyStepInput {
    step: JourneyStepKind;
    fromRoute?: string | null;
    toRoute?: string | null;
    productMode?: string | null;
    /** A checked-in control identifier, never the visible label — copy changes, identity should not. */
    ctaId?: string | null;
    ctaAction?: CtaAction | null;
    runtimeStateOnArrival?: string | null;
    optionsShown?: readonly string[] | null;
    optionSelected?: string | null;
    pointsEntered?: number | null;
}

export function emitJourneyStep(input: JourneyStepInput): void {
    safeEmit('journey_step', {
        step: input.step,
        from_route: normaliseRoute(input.fromRoute),
        to_route: normaliseRoute(input.toRoute),
        product_mode: input.productMode ?? null,
        cta_id: input.ctaId ?? null,
        cta_action: input.ctaAction ?? null,
        runtime_state_on_arrival: input.runtimeStateOnArrival ?? null,
        // Emitted even when EMPTY. F08 is the claim that a finished session offers nowhere to go, and
        // an event that simply never fires cannot support that claim.
        options_shown: input.optionsShown ? [...input.optionsShown] : null,
        option_selected: input.optionSelected ?? null,
        points_entered: input.pointsEntered ?? null,
    }, 'HIGH');
}
