/**
 * #1259 F09 — why Send stays grey, against the form that actually ships.
 *
 * The original version of this module instrumented a form that no longer exists. It described a
 * four-condition gate over `kind`/`title`/`description`, blocked on `title_too_short`, and reported a
 * `title` field — while the shipped dialog (#1416) asks a single question with four answers and one
 * message box. There is no title. A user could never trip `title_too_short`, so the one channel that
 * would tell us the product is failing was reporting on a screen nobody sees.
 *
 * The gate it now mirrors, from `IssueReportDialog.tsx`:
 *
 *   canSubmit = type !== null && body.trim().length > 0 && !isSubmitting
 *
 * Three conditions, and the dialog still surfaces none of them — no `aria-invalid`, no helper text,
 * no validation message. "Greyed out no matter what" remains the expected experience of that
 * expression rather than a glitch, and it stays unfixable by guesswork from outside, because the user
 * cannot see which condition is unmet and neither can we. That is what this records.
 *
 * `severity` is deliberately included as a field even though it does not gate submission: it is
 * revealed only for `broke`, so whether it is answered when shown is a real question about the
 * redesign that nothing else can answer.
 *
 * NEVER THE TEXT. Not the message, not a first word. A length BAND, a list of blocker names, and the
 * chosen `type` — which is safe because it is a closed set of four labels the product wrote, not
 * anything the user typed. The prose belongs in the database row it was typed into.
 */
import { safeEmit } from './safeEmit';

export type FeedbackField = 'type' | 'body' | 'severity';
export type FieldTransition = 'entered' | 'cleared' | 'unexpected_clear';
export type SubmitBlocker = 'type_missing' | 'body_empty' | 'already_submitting';
/** The four answers the shipped dialog offers. A closed product-authored set, never user text. */
export const FEEDBACK_TYPES = ['broke', 'confused', 'idea', 'praise'] as const;
export type FeedbackTypeName = (typeof FEEDBACK_TYPES)[number];

/** Bands, never lengths: an exact character count of a short field narrows its content. */
export function lengthBand(n: number): string {
    if (n === 0) return '0';
    if (n < 4) return '1-3';
    if (n < 10) return '4-9';
    if (n < 40) return '10-39';
    if (n < 200) return '40-199';
    return '200+';
}

/**
 * The blockers, derived from the SAME expression the button uses.
 *
 * `type` is null-or-a-name rather than the old empty-string sentinel, because that is what the dialog
 * holds; taking a string here would let '' and null disagree about the same state.
 */
export function submitBlockers(input: {
    type: FeedbackTypeName | null; bodyLength: number; isSubmitting: boolean;
}): SubmitBlocker[] {
    const blockers: SubmitBlocker[] = [];
    if (input.type === null) blockers.push('type_missing');
    // The gate trims before measuring, so the caller must pass a TRIMMED length. A body of pure
    // whitespace is empty to the button and must be empty here too.
    if (input.bodyLength === 0) blockers.push('body_empty');
    if (input.isSubmitting) blockers.push('already_submitting');
    return blockers;
}

let lastSignature = '';

export function emitFeedbackFieldState(input: {
    field: FeedbackField;
    transition: FieldTransition;
    lengthBand: string;
    blockers: readonly SubmitBlocker[];
    submitEnabled: boolean;
    /** Which of the four the user chose. Closed set; never their prose. Absent becomes 'none'. */
    feedbackType?: FeedbackTypeName | null;
}): void {
    const props = {
        field: input.field,
        transition: input.transition,
        length_band: input.lengthBand,
        submit_blockers: [...input.blockers],
        submit_enabled: input.submitEnabled,
        feedback_type: input.feedbackType ?? 'none',
    };
    const signature = JSON.stringify(props);
    if (signature === lastSignature) return;   // typing is not an event; a CHANGE of state is
    lastSignature = signature;
    safeEmit('feedback_field', props, 'LOW');
}

export function emitFeedbackDialogOpened(): void {
    lastSignature = '';
    safeEmit('feedback_dialog_opened', {}, 'HIGH');
}

export function emitFeedbackSubmit(input: {
    outcome: 'attempted' | 'refused_by_gate' | 'storage_ok' | 'storage_failed';
    blockers?: readonly SubmitBlocker[];
    acknowledgementVisible?: boolean | null;
}): void {
    safeEmit('feedback_submit', {
        outcome: input.outcome,
        submit_blockers: input.blockers ? [...input.blockers] : null,
        acknowledgement_visible: input.acknowledgementVisible ?? null,
    }, 'HIGH');
}

export function __resetFeedbackTelemetryForTests(): void { lastSignature = ''; }
