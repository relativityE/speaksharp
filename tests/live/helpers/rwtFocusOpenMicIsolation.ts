/**
 * AHT-02 only, catalog row `open-mic-isolation` (front-run review fix 7). The source row `take after switching products is clean`
 * proves the Open Mic take saved as open_mic and unchanged, but the harness (tools/cloud-test/harness/draft-adapters/
 * focus-controls.cjs `extendedFocus`) also requires that the Open Mic take has NO `objective_session` row and that the FIRST
 * Focus take's saved evidence (its brief, per-point verdicts and ordered labels) is unchanged across the Open Mic take.
 *
 * This row (`Open Mic take kept out of Focus`) adds those reads. It reads the Open Mic take's objective rows twice (right after it
 * saved, and again at the end of the switch step, so a late write is seen). Case-only helper: pure.
 *
 * Fail closed:
 *  - FAIL when the Open Mic take has any objective_session row, saved as another product, or the first Focus take's saved
 *    evidence changed;
 *  - HOLD when no Open Mic take saved, or a read failed or found nothing to compare (never PASS on a missing read);
 *  - PASS otherwise.
 */

export const OPEN_MIC_ISOLATION_ROW = 'Open Mic take kept out of Focus';

/** The first Focus take's saved evidence, in Node only. 'error' = a read failed; null = no objective session was found. */
export type FocusEvidenceSnapshot = { brief: string; verdicts: readonly string[]; ordered: readonly string[] } | 'error' | null;

export interface OpenMicIsolationObservation {
    /** The Open Mic take's saved id; null when it did not save as a new take. */
    openMicId: string | null;
    /** The Open Mic take's saved product; null when its row could not be read. */
    openMicProduct: string | null;
    /** objective_session rows for the Open Mic take, per read; null for a read that failed. */
    objectiveRowReads: ReadonlyArray<number | null>;
    firstBefore: FocusEvidenceSnapshot;
    firstAfter: FocusEvidenceSnapshot;
}

export interface OpenMicIsolationRow {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    detail: string;
    evidence: Record<string, string | number | boolean | null>;
}

const known = (s: FocusEvidenceSnapshot): s is { brief: string; verdicts: readonly string[]; ordered: readonly string[] } => s !== null && s !== 'error';
const state = (s: FocusEvidenceSnapshot): string => (s === null ? 'none' : s === 'error' ? 'error' : 'read');
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function openMicIsolationVerdict(o: OpenMicIsolationObservation): OpenMicIsolationRow {
    const reads = o.objectiveRowReads;
    const readsKnown = reads.length > 0 && reads.every((n) => n !== null && Number.isInteger(n) && n >= 0);
    const anyObjective = reads.some((n) => typeof n === 'number' && n > 0);
    // A first take with no saved verdicts has nothing to keep unchanged, so it is not a known baseline.
    const a = known(o.firstBefore) ? o.firstBefore : null;
    const b = known(o.firstAfter) ? o.firstAfter : null;
    const firstKnown = a !== null && b !== null && a.verdicts.length > 0;
    const firstUnchanged = a !== null && b !== null && firstKnown
        ? a.brief === b.brief && same(a.verdicts, b.verdicts) && same(a.ordered, b.ordered)
        : null;
    // Content-free: counts, booleans and closed states. Ids, labels and verdict keys stay in Node.
    const evidence = {
        openMicSaved: o.openMicId !== null,
        openMicProductIsOpenMic: o.openMicProduct === null ? null : o.openMicProduct === 'open_mic',
        openMicObjectiveRows: reads.map((n) => (n === null ? 'error' : String(n))).join(','),
        firstFocusBefore: state(o.firstBefore), firstFocusAfter: state(o.firstAfter),
        firstFocusUnchanged: firstUnchanged,
        firstFocusPoints: known(o.firstBefore) ? o.firstBefore.ordered.length : null,
    };
    const row = (verdict: OpenMicIsolationRow['verdict'], detail: string): OpenMicIsolationRow => ({ verdict, detail, evidence });
    if (o.openMicId === null) return row('HOLD', 'no Open Mic take saved, so there is nothing to keep out of Focus');
    if (anyObjective) return row('FAIL', 'the Open Mic take has a Focus objective session');
    if (o.openMicProduct !== null && o.openMicProduct !== 'open_mic') return row('FAIL', 'the Open Mic take did not save as Open Mic');
    if (firstUnchanged === false) return row('FAIL', 'the first Focus take\'s saved evidence changed across the Open Mic take');
    if (!readsKnown) return row('HOLD', 'the Open Mic take\'s objective sessions could not be read');
    if (o.openMicProduct === null) return row('HOLD', 'the Open Mic take\'s saved product could not be read');
    if (!firstKnown) return row('HOLD', 'the first Focus take\'s saved evidence could not be read before and after the Open Mic take');
    return row('PASS', 'the Open Mic take has no Focus objective session, and the first Focus take\'s saved evidence is unchanged across it');
}
