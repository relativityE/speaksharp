/**
 * AHT-02 only, catalog row `focus-edit-cancel-save` (front-run review fix 6). The source journey checked Edit seeded + Save +
 * the scored take (`Focus Edit`), but not the cancel half. The harness (tools/cloud-test/harness/draft-adapters/focus-controls.cjs,
 * `cancelPreserved`) edits point 3 of the new set, closes the dialog with Escape, reopens Edit and requires the old value.
 *
 * This row (`Focus Edit cancel keeps the set`) is that cancel probe, plus two reads the harness does not make: the rail still
 * shows the set as it was, and the newest saved brief (id and its point labels, compared in Node only) is the same before and
 * after the cancel. Escape closing the Radix dialog is product behaviour (ObjectiveSetupDialog.tsx). Case-only helper: pure.
 *
 * Fail closed:
 *  - HOLD when the probe could not be made: Edit not reached, not seeded with the set, the change not typed, focus not inside the
 *    dialog when Escape was pressed (the key may not have reached it), or a brief read failed or found no brief;
 *  - FAIL when Escape (delivered inside the dialog) did not close it, Edit could not be reopened, the reopened Edit shows the
 *    cancelled change, the rail shows the cancelled change, or the saved brief changed;
 *  - PASS otherwise.
 */

export const FOCUS_EDIT_CANCEL_ROW = 'Focus Edit cancel keeps the set';

/** The newest saved brief: its id and point labels in sort order. 'error' = the read failed; null = no brief was found. */
export type BriefSnapshot = { id: string; labels: readonly string[] } | 'error' | null;

export interface EditCancelObservation {
    /** Edit was offered and its dialog opened. */
    editOpened: boolean;
    /** Edit opened seeded with the current set (point 3 = the set's own label). */
    editSeeded: boolean;
    /** The replacement value was typed into point 3 before the cancel. */
    changeTyped: boolean;
    /** Focus was inside the dialog when Escape was pressed. */
    focusedInDialog: boolean;
    /** The dialog closed after Escape. */
    closed: boolean;
    /** The rail still shows the set's point 3 and not the cancelled value (null = not read). */
    railKept: boolean | null;
    /** Edit reopened its dialog after the cancel. */
    reopened: boolean;
    /** The reopened Edit shows the set's point 3, not the cancelled value. */
    preserved: boolean;
    briefBefore: BriefSnapshot;
    briefAfter: BriefSnapshot;
}

export interface EditCancelRow {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    detail: string;
    evidence: Record<string, string | number | boolean | null>;
}

const sameBrief = (a: { id: string; labels: readonly string[] }, b: { id: string; labels: readonly string[] }): boolean =>
    a.id === b.id && a.labels.length === b.labels.length && a.labels.every((label, i) => label === b.labels[i]);
const briefState = (b: BriefSnapshot): string => (b === null ? 'none' : b === 'error' ? 'error' : 'read');

export function editCancelVerdict(o: EditCancelObservation): EditCancelRow {
    const briefsKnown = o.briefBefore !== null && o.briefBefore !== 'error' && o.briefAfter !== null && o.briefAfter !== 'error';
    const briefUnchanged = briefsKnown ? sameBrief(o.briefBefore as { id: string; labels: readonly string[] }, o.briefAfter as { id: string; labels: readonly string[] }) : null;
    // Content-free: booleans and closed states only. Labels and brief ids stay in Node.
    const evidence = {
        editOpened: o.editOpened, editSeeded: o.editSeeded, changeTyped: o.changeTyped, focusedInDialog: o.focusedInDialog,
        closed: o.closed, railKept: o.railKept, reopened: o.reopened, cancelPreserved: o.preserved,
        briefBefore: briefState(o.briefBefore), briefAfter: briefState(o.briefAfter), briefUnchanged,
    };
    const row = (verdict: EditCancelRow['verdict'], detail: string): EditCancelRow => ({ verdict, detail, evidence });
    if (!o.editOpened) return row('HOLD', 'Edit was not reached, so the cancel probe was not made');
    if (!o.editSeeded) return row('HOLD', 'Edit did not open seeded with the set, so a cancel cannot be judged against it');
    if (!o.changeTyped) return row('HOLD', 'the change to cancel could not be typed');
    if (!o.focusedInDialog) return row('HOLD', 'focus was not inside the Edit dialog, so Escape may not have reached it');
    if (!o.closed) return row('FAIL', 'Escape did not close the Edit dialog');
    if (!o.reopened) return row('FAIL', 'Edit could not be reopened after the cancel');
    if (!o.preserved) return row('FAIL', 'the reopened Edit shows the cancelled change instead of the set');
    if (o.railKept === false) return row('FAIL', 'the rail shows the cancelled change');
    if (briefUnchanged === false) return row('FAIL', 'the saved brief changed although the edit was cancelled');
    if (o.railKept === null) return row('HOLD', 'the rail was not read after the cancel');
    if (!briefsKnown) return row('HOLD', 'the saved brief could not be read before and after the cancel');
    return row('PASS', 'Escape closed Edit without saving: the reopened Edit, the rail and the saved brief all keep the set');
}
