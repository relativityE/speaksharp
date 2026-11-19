/**
 * AHT-02 / AHT-03, catalog row `grounded-coaching` (fix list item 5 of the 2026-11-10 front-run review): the harness also
 * requires `capturedTakesDifferVerdict` — the first take and the Practice-again take, whose saved evidence differs, must not
 * receive the identical coaching pair. Open Mic writes this as `coaching differs between takes`; the Focus journey had no such
 * row. Case-only helper: the pure decision around the shared `capturedTakesDifferVerdict` (rwtCoachingCollector.ts), unchanged.
 *
 * Fail closed:
 *  - no `Focus coaching rendered` row (the coaching step never settled), no first or repeat saved take, the same id for both,
 *    or no captured witness for either take → HOLD;
 *  - a proved provider outage (`Focus coaching rendered` EXTERNAL) → HOLD, not EXTERNAL: EXTERNAL is allowed only on the rows
 *    listed in rwtAcceptance.ts FOCUS_EXTERNAL_SCOPE, and this row is not one of them (that file is outside this change);
 *  - otherwise the shared verdict decides: FAIL when a witness changed / failed its binding or the pairs are identical, HOLD
 *    when a binding is unproven or the saved evidence did not differ, PASS when the takes received different coaching.
 */
import { capturedTakesDifferVerdict, type CapturedCoachingTake } from './rwtCoachingCollector';
import type { ReceiptRow } from './rwtAcceptance';

export const FOCUS_TAKES_DIFFER_ROW = 'Focus coaching differs between takes';
const PARENT_ROW = 'Focus coaching rendered';

export interface FocusTakesDifferInput {
    /** The receipt's rows so far: the parent `Focus coaching rendered` row is read from them. */
    rows: readonly ReceiptRow[];
    firstSessionId: string | null;
    repeatSessionId: string | null;
    /** The take capture's witnesses; null when no capture was started. */
    captured: { get(sessionId: string | null): CapturedCoachingTake } | null;
    releaseSha: string;
}

type TakesDifferJudge = (first: CapturedCoachingTake, second: CapturedCoachingTake, releaseSha: string) => { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string };

export interface FocusTakesDifferRow {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    detail: string;
    evidence: Record<string, string | number | boolean | null>;
}

const kind = (t: CapturedCoachingTake | null): string => (!t ? 'none' : 'take' in t ? 'take' : 'fail' in t ? `fail:${t.fail}` : `hold:${t.hold}`);

/** `judge` is the shared `capturedTakesDifferVerdict`; it is a parameter only so the unit test can stand in for artifact building. */
export function focusTakesDifferRow(input: FocusTakesDifferInput, judge: TakesDifferJudge = capturedTakesDifferVerdict): FocusTakesDifferRow {
    const parent = input.rows.find((r) => r.step === PARENT_ROW);
    const first = input.captured && input.firstSessionId ? input.captured.get(input.firstSessionId) : null;
    const repeat = input.captured && input.repeatSessionId ? input.captured.get(input.repeatSessionId) : null;
    const bothTakes = !!first && !!repeat && 'take' in first && 'take' in repeat;
    const evidence = {
        parentVerdict: parent?.verdict ?? 'none',
        firstWitness: kind(first),
        repeatWitness: kind(repeat),
        bothPairsSaved: bothTakes,
        evidenceDiffers: bothTakes && first.totalWords !== null && repeat.totalWords !== null ? first.totalWords !== repeat.totalWords : null,
    };
    const hold = (detail: string): FocusTakesDifferRow => ({ verdict: 'HOLD', detail, evidence });
    if (!parent) return hold('the Focus coaching step did not settle, so there is no coaching to compare');
    if (parent.verdict === 'EXTERNAL') return hold('not exercised: the coaching provider was unavailable (EXTERNAL is not in the Focus scope for this row, so it stays HOLD)');
    if (!input.firstSessionId || !input.repeatSessionId) return hold('two saved takes (the first and the Practice-again take) are needed to compare');
    if (input.firstSessionId === input.repeatSessionId) return hold('the Practice-again take is not a distinct saved take');
    if (!first || !repeat) return hold('no coaching witness was captured for the takes');
    const differ = judge(first, repeat, input.releaseSha);
    return { verdict: differ.status, detail: differ.detail, evidence };
}
