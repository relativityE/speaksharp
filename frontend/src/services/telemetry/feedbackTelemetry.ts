/**
 * #1259 F09 — why Send stayed grey.
 *
 * `IssueReportDialog.tsx:95`:
 *
 *   canSubmit = feedbackKind !== '' && title.trim().length >= 4
 *            && description.trim().length >= 10 && !isSubmitting
 *
 * Four independent conditions, and the dialog surfaces none of them: no `aria-invalid`, no helper
 * text, no validation message anywhere. "Greyed out no matter what" is the expected experience of
 * that expression, not a glitch — and it is unfixable-by-guesswork from outside, because the user
 * cannot see which condition is unmet and neither can we.
 *
 * PostHog confirms the consequence: `report_issue_submitted` has 7 lifetime receipts and NONE on the
 * day of the session. That event fires only after a successful database insert, so a blocked submit
 * is invisible by construction. Absence proves the report never landed and says nothing about why.
 *
 * So this records the BLOCKERS, by name, as they change — and the field transitions that produce
 * them, including a field that empties without the user emptying it.
 *
 * NEVER THE TEXT. Not the title, not the description, not a first word. A length BAND and a list of
 * blocker names. The prose belongs in the database row it was typed into.
 */
import { safeEmit } from './safeEmit';

export type FeedbackField = 'kind' | 'title' | 'description' | 'category' | 'severity' | 'impact';
export type FieldTransition = 'entered' | 'cleared' | 'unexpected_clear';
export type SubmitBlocker =
    | 'kind_missing' | 'title_too_short' | 'description_too_short' | 'already_submitting';

/** Bands, never lengths: an exact character count of a short field narrows its content. */
export function lengthBand(n: number): string {
    if (n === 0) return '0';
    if (n < 4) return '1-3';
    if (n < 10) return '4-9';
    if (n < 40) return '10-39';
    if (n < 200) return '40-199';
    return '200+';
}

/** The blockers, derived from the SAME expression the button uses. */
export function submitBlockers(input: {
    kind: string; titleLength: number; descriptionLength: number; isSubmitting: boolean;
}): SubmitBlocker[] {
    const blockers: SubmitBlocker[] = [];
    if (input.kind === '') blockers.push('kind_missing');
    if (input.titleLength < 4) blockers.push('title_too_short');
    if (input.descriptionLength < 10) blockers.push('description_too_short');
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
}): void {
    const props = {
        field: input.field,
        transition: input.transition,
        length_band: input.lengthBand,
        submit_blockers: [...input.blockers],
        submit_enabled: input.submitEnabled,
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
