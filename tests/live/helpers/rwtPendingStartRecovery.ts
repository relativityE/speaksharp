/**
 * AHT-04 `deliberate-recovery-saved` (catalog: minimumTakes 1, minimumStarts 2). After a cold Start was abandoned and the person
 * returned to Open Mic, ONE deliberate take must start from the control the settled return offers and save exactly one completed
 * session, bound by the page, with its transcript kept (the harness's `ownSaved`, mirrored by `savedTakeReadbackVerdict`).
 *
 * Pure decisions only; the spec drives the page. Case-only helper: nothing AHT-01 loads imports it.
 */
import { savedTakeReadbackVerdict, type SessionRowFacts, type Verdict } from './rwtSaveRetry';

/** The control the settled return offered: `returnControlSample(...).expectedControl` (a test id), or null when unreadable. */
export type ReturnedControl = string | null;

/**
 * Whether the recovery take may be driven from this return, and how. Only a settled `mic-start` (warm model) or `mic-download` (model
 * retired on unmount, the one press consents, downloads AND records) is a deliberate recovery a person would make. A return that
 * settled on Retry is a model failure, and pressing Retry is not the catalog's recovery take: HOLD, never a pass by another route.
 */
export function recoveryTakePlan(returnSettled: boolean, control: ReturnedControl):
    { drive: true; control: 'mic-start' | 'mic-download' } | { drive: false; verdict: Verdict } {
    if (!returnSettled || control === null) {
        return { drive: false, verdict: { status: 'HOLD', detail: 'the return never settled on a usable Start, so no recovery take was attempted' } };
    }
    if (control === 'mic-start' || control === 'mic-download') return { drive: true, control };
    if (control === 'mic-retry') {
        return { drive: false, verdict: { status: 'HOLD', detail: 'the return settled on Retry (a model failure), so the deliberate recovery take was not attempted' } };
    }
    return { drive: false, verdict: { status: 'HOLD', detail: 'the return settled on an unrecognised control, so no recovery take was attempted' } };
}

/**
 * The recovery take's verdict over the account's session rows after it. The account is fresh and the abandoned Start saved
 * nothing, so the rows must be exactly the one take the page bound. `priorIds` are the identities read before the take: any
 * session that existed before it (a survivor of the abandonment) is a FAIL here, not a second row quietly tolerated.
 */
export function recoveryTakeVerdict(priorIds: readonly string[], rows: readonly SessionRowFacts[], savedId: string | null): Verdict {
    if (priorIds.length !== 0) {
        return { status: 'FAIL', detail: `${priorIds.length} session(s) existed before the recovery take on a fresh account` };
    }
    if (savedId === null) return { status: 'FAIL', detail: 'the page did not bind a saved session for the recovery take' };
    const verdict = savedTakeReadbackVerdict(rows, savedId);
    return verdict.status === 'PASS'
        ? { status: 'PASS', detail: 'the deliberate take after the abandoned Start saved one completed session, bound by the page, with its transcript kept' }
        : verdict;
}
