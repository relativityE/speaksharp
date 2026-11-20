/**
 * AHT-04 `deliberate-recovery-saved` (catalog: minimumTakes 1, minimumStarts 2). After a cold Start was abandoned and the person
 * returned to Open Mic, ONE deliberate take must start from the control the settled return offers and save exactly one completed
 * session, bound by the page, with its transcript kept (the harness's `ownSaved`, mirrored by `savedTakeReadbackVerdict`).
 *
 * Pure decisions only; the spec drives the page. Case-only helper: nothing AHT-01 loads imports it.
 */
import type { ConsentMode } from './rwtPracticeConsent';
import { savedTakeReadbackVerdict, type SessionRowFacts, type Verdict } from './rwtSaveRetry';

/**
 * J5.a (#1835, Sam Nov 20): the recovery take must keep its transcript, so this run's own fresh account opts in to saving through
 * the Practice prompt (Save: Yes, Coaching: No; the coaching budget is a ceiling, so zero requests passes). Fixed, never read
 * from the environment: the app's default stays off and only this test account opts in.
 */
export const PENDING_START_CONSENT_MODE: ConsentMode = 'save_on';

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

/**
 * Sam, 2026-11-15 (#1869 on 26896492): the recovery press, as one bounded driver the unit tests exercise with a fake page. The
 * generic Start helper re-resolves the control (it could press Retry if the model flipped to error) and returns without pressing
 * when a recorder already runs, so neither may earn recovery credit. Here:
 *  - a recorder already running before the press (or an unreadable check) is no deliberate recovery: FAIL, nothing pressed;
 *  - the planned control must still be the one offered (a flip to Retry or anything else presses nothing): HOLD;
 *  - exactly ONE activation of that planned control must be observed (an unobserved or failed press): HOLD;
 *  - a recording must follow that activation (a proven press that never records): the named FAIL, never a harness timeout.
 */
export type RecoveryControl = 'mic-start' | 'mic-download';
export interface RecoveryPressIo {
    /** Whether the recorder (`recorder-stop`) is present right now. */
    recorderPresent(): Promise<boolean>;
    /** The control the page offers right now (from its model status), or null. */
    offeredControl(): Promise<string | null>;
    /**
     * One guarded activation of exactly this control; `activated` only when the click was observed reaching it. The press calls
     * `beforeClick` after ALL of its setup (finding the control, the human reflex, arming the guard), as the statement directly
     * before the click; if it throws, nothing is clicked and the press reports `consentUnproven` with the reason.
     */
    pressOnce(control: RecoveryControl, beforeClick: () => Promise<void>):
        Promise<{ activated: boolean; reason?: string; staleRecorder?: boolean; consentUnproven?: string }>;
    /** Whether the take is recording within the control's bound after that press. */
    recordingAfterPress(control: RecoveryControl): Promise<boolean>;
    /** #1835: the owner's fresh consent readback; throws unless it is exactly the run's fixed choice. Passed to the press as `beforeClick`. */
    confirmConsent(): Promise<void>;
}
export type RecoveryPressOutcome =
    | { kind: 'recorded'; control: RecoveryControl }
    | { kind: 'stale-recorder' }
    | { kind: 'control-changed'; planned: RecoveryControl; offered: string | null }
    | { kind: 'press-unobserved'; control: RecoveryControl; reason: string }
    | { kind: 'pressed-no-recording'; control: RecoveryControl }
    | { kind: 'consent-unproven'; control: RecoveryControl; reason: string };

export async function driveRecoveryPress(io: RecoveryPressIo, planned: RecoveryControl): Promise<RecoveryPressOutcome> {
    if (await io.recorderPresent().catch(() => true)) return { kind: 'stale-recorder' };
    const offered = await io.offeredControl().catch(() => null);
    if (offered !== planned) return { kind: 'control-changed', planned, offered };
    // #1835 (Sam, Nov 20): the owner's choice is read back inside the press, after its setup and immediately before the click. A
    // choice changed or unreadable since the first press, even during that setup, means zero recovery clicks.
    let press: { activated: boolean; reason?: string; staleRecorder?: boolean; consentUnproven?: string };
    try {
        press = await io.pressOnce(planned, () => io.confirmConsent());
    } catch (error) {
        press = { activated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (press.consentUnproven !== undefined) return { kind: 'consent-unproven', control: planned, reason: press.consentUnproven };
    // A recorder that started between discovery and activation is caught by the click guard: still no deliberate recovery.
    if (press.staleRecorder === true) return { kind: 'stale-recorder' };
    if (!press.activated) return { kind: 'press-unobserved', control: planned, reason: press.reason ?? 'the activation was not observed' };
    return (await io.recordingAfterPress(planned).catch(() => false))
        ? { kind: 'recorded', control: planned }
        : { kind: 'pressed-no-recording', control: planned };
}

/** The `deliberate recovery take saved` row when the press itself decides it, or null when a recording followed the press. */
export function recoveryPressVerdict(o: RecoveryPressOutcome): Verdict | null {
    switch (o.kind) {
        case 'recorded': return null;
        case 'stale-recorder':
            return { status: 'FAIL', detail: 'a recorder was already running before the recovery press, so it is not a deliberate recovery; nothing was pressed' };
        case 'control-changed':
            return { status: 'HOLD', detail: `the planned ${o.planned} changed to ${o.offered ?? 'no control'} before the press; nothing was pressed and no recovery credit is given` };
        case 'press-unobserved':
            return { status: 'HOLD', detail: `the ${o.control} activation was not observed (${o.reason}); no recovery credit is given` };
        case 'pressed-no-recording':
            return { status: 'FAIL', detail: `a proven press of ${o.control} for the recovery take did not start recording` };
        case 'consent-unproven':
            return { status: 'HOLD', detail: `the owner's consent was not proven right before the recovery press (${o.reason}); nothing was pressed` };
    }
}

/**
 * Sam, 2026-11-15 (#1869 on c0c085ac): the in-page click guard for the ONE recovery press, self-contained so it runs in the page
 * (`target.evaluate(armRecoveryClickGuard, …)`) and in the DOM-level unit test. Everything is re-checked AT ACTIVATION, in the
 * capture handler: no recorder present, exactly one element with the planned test id, that element is this target, still enabled
 * and the event's own target. Anything else stops the event before the product sees it and records why (a recorder that started
 * after discovery is `recorder`). The listener belongs to ONE attempt (`token`) and removes itself on its first click; the caller
 * ALWAYS calls `disarmRecoveryClickGuard(token)` in `finally`, so a click that times out before dispatch never leaves it armed.
 */
export function armRecoveryClickGuard(node: Element, args: { id: string; recorderStopId: string; token: string }): boolean {
    type GuardState = { accepted: boolean; rejected: boolean; reason: string };
    const w = window as unknown as { __rwtRecoveryGuards?: Record<string, { state: GuardState; disarm: () => void }> };
    const state: GuardState = { accepted: false, rejected: false, reason: '' };
    const guard = (event: Event): void => {
        document.removeEventListener('click', guard, true);
        const recorder = document.querySelector(`[data-testid="${args.recorderStopId}"]`) !== null;
        const matches = document.querySelectorAll(`[data-testid="${args.id}"]`);
        const ok = !recorder && matches.length === 1 && matches.item(0) === node && node.isConnected
            && node.getAttribute('data-testid') === args.id && !(node as HTMLButtonElement).disabled
            && event.target instanceof Node && node.contains(event.target);
        if (ok) {
            state.accepted = true;
            return;
        }
        state.rejected = true;
        state.reason = recorder ? 'recorder' : 'control';
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    document.addEventListener('click', guard, true);
    w.__rwtRecoveryGuards = w.__rwtRecoveryGuards ?? {};
    w.__rwtRecoveryGuards[args.token] = { state, disarm: () => document.removeEventListener('click', guard, true) };
    return true;
}

/** Removes the attempt's guard (idempotent) and returns what it observed, or null when no guard was armed for `token`. */
export function disarmRecoveryClickGuard(token: string): { accepted: boolean; rejected: boolean; reason: string } | null {
    const w = window as unknown as { __rwtRecoveryGuards?: Record<string, { state: { accepted: boolean; rejected: boolean; reason: string }; disarm: () => void }> };
    const g = w.__rwtRecoveryGuards?.[token];
    if (!g) return null;
    g.disarm();
    delete w.__rwtRecoveryGuards![token];
    return { ...g.state };
}

/** The content-free reason a consent readback refused (`HOLD practice consent: <reason>`), or `not_proven`. */
export function consentRefusalReason(error: unknown): string {
    return /^HOLD practice consent: ([a-z0-9_]+)/.exec(error instanceof Error ? error.message : '')?.[1] ?? 'not_proven';
}
