/**
 * AHT-07 (feedback on an older take) — the bounded production writes, as pure decisions (Sam's one-run limit, 2026-11-11):
 * one disposable account, two Starts, two sessions, at most 7 feedback insert attempts and at most 4 stored reports.
 *
 *  - PRE-SEND CAP. Every write the page makes to `user_issue_reports` passes ONE route (the spec installs it on the journey's
 *    browser context). `FeedbackAttemptLedger.admit` records the attempt BEFORE it can leave the browser and decides it:
 *    the 8th attempt and later, an insert whose rows carry no valid idempotency key, a fifth distinct key, and any non-insert
 *    write are aborted by the route (never sent) and recorded. Distinct admitted keys bound the stored reports, because the
 *    unique index `user_issue_reports_idempotency_key_unique` makes one key one row.
 *  - THE THREE FAULT LEGS (the harness modes of tools/cloud-test/harness/bundle/harness/feedback-fault.cjs, in Sam's order):
 *      synthetic-42501       — the leg's first insert is answered 403/42501 by the route; it never reaches the server;
 *      request-lost          — the leg's first insert is aborted before it is sent (`transport-before-send`);
 *      stored-response-lost  — the leg's first insert reaches the server and is stored (`route.fetch()`), then its answer is
 *                              dropped (`route.abort('failed')`); the same-key Retry must meet the REAL 409 on the index.
 *    Each leg is one failed attempt and one explicit Retry with the same key; then ONE clean final submit, un-faulted.
 *  - THE LEDGER at the final boundary (harness final-attempts.cjs `classifyAttempt`: 2 attempts per leg, 1 for the final
 *    observe-once): an extra, changed, out-of-window or capped attempt is a FAIL; a missing or unanswered one is a HOLD; an
 *    observed FAIL stays FAIL (`stickyFinalVerdict`).
 *
 * Case-only helper: nothing AHT-01 loads imports it. Bodies stay in memory as a key list and a stable-draft sha; receipts get
 * counts, verdicts and closed codes, never a key or a body.
 */
import { createHash } from 'node:crypto';
import { classifyInsertBody } from './feedbackDiagnosticRef';

export type Verdict = 'PASS' | 'FAIL' | 'HOLD';
export type Evidence = Record<string, number | string | boolean | null>;
export interface RowVerdict { verdict: Verdict; detail: string; evidence?: Evidence }
/** One receipt row as these helpers produce it (`RwtReceipt.row` arguments). */
export interface ReceiptRowOut { step: string; verdict: Verdict; detail: string; evidence?: Evidence }
export type RowSink = { row(step: string, verdict: Verdict, detail: string, evidence?: Evidence): void };

/** Sam's one-run limit: 3 legs × (fault + Retry) + 1 final submit = 7 insert attempts; 3 leg keys + 1 final key = 4 reports. */
export const FEEDBACK_ATTEMPT_CAP = 7;
export const FEEDBACK_REPORT_CAP = 4;
/** The dialog's failure copy (IssueReportDialog `setError`), and the unique index a same-key replay is refused on. */
export const FEEDBACK_ERROR_COPY = 'That didn’t go through. Try again?';
export const FEEDBACK_IDEMPOTENCY_INDEX = 'user_issue_reports_idempotency_key_unique';

export const FEEDBACK_FAULT_LEGS = Object.freeze(['synthetic-42501', 'request-lost', 'stored-response-lost'] as const);
export type FeedbackFaultLeg = typeof FEEDBACK_FAULT_LEGS[number];

/** Each leg's rows, as literal names (the acceptance list and the drift guard read them from this file). */
export const FEEDBACK_LEG_ROWS = Object.freeze({
    'synthetic-42501': Object.freeze({
        fault: 'feedback leg synthetic 42501: fault exercised',
        alert: 'feedback leg synthetic 42501: alert copy truthful',
        dialog: 'feedback leg synthetic 42501: dialog kept open',
        sameKey: 'feedback leg synthetic 42501: same key on Retry',
        noAck: 'feedback leg synthetic 42501: no fresh acknowledgement before the Retry',
        retry: 'feedback leg synthetic 42501: Retry treated as stored',
        stored: 'feedback leg synthetic 42501: exactly one stored row for the leg key',
    }),
    'request-lost': Object.freeze({
        fault: 'feedback leg request lost: fault exercised',
        alert: 'feedback leg request lost: alert copy truthful',
        dialog: 'feedback leg request lost: dialog kept open',
        sameKey: 'feedback leg request lost: same key on Retry',
        noAck: 'feedback leg request lost: no fresh acknowledgement before the Retry',
        retry: 'feedback leg request lost: Retry treated as stored',
        stored: 'feedback leg request lost: exactly one stored row for the leg key',
    }),
    'stored-response-lost': Object.freeze({
        fault: 'feedback leg stored response lost: fault exercised',
        alert: 'feedback leg stored response lost: alert copy truthful',
        dialog: 'feedback leg stored response lost: dialog kept open',
        sameKey: 'feedback leg stored response lost: same key on Retry',
        noAck: 'feedback leg stored response lost: no fresh acknowledgement before the Retry',
        retry: 'feedback leg stored response lost: Retry treated as stored',
        stored: 'feedback leg stored response lost: exactly one stored row for the leg key',
    }),
});
export const FEEDBACK_CAP_ROW = 'feedback attempts within the cap';
export const FEEDBACK_LEDGER_ROW = 'feedback attempts are three faults, three Retries and one final submit';
export const FEEDBACK_ISOLATION_ROW = 'final submit isolated from the fault legs';
/** Every row the AHT-07 bounded-writes wiring writes on its success path (cleanup's `zero residue` is feedbackReportCleanup's). */
export const FEEDBACK_BOUNDED_WRITE_ROWS: readonly string[] = Object.freeze([
    ...FEEDBACK_FAULT_LEGS.flatMap((leg) => Object.values(FEEDBACK_LEG_ROWS[leg])),
    FEEDBACK_ISOLATION_ROW, FEEDBACK_CAP_ROW, FEEDBACK_LEDGER_ROW,
]);

/** The description each leg types, so its draft differs from every other leg's and from the final submit's. */
export const feedbackLegDescription = (leg: FeedbackFaultLeg): string => `Automated RWT feedback retry control: ${leg}.`;

export type CapReason = 'not-an-insert' | 'attempt-cap' | 'unattributed-insert' | 'report-cap';
export type AttemptAction = 'cap-abort' | 'fault-synthetic-42501' | 'fault-request-lost' | 'fault-stored-response-lost' | 'forward';
export type AttemptWindow = 'leg' | 'final' | 'outside';

/** One write the route saw, recorded at entry (before any await), so a write in flight at a page close is still counted. */
export interface FeedbackAttempt {
    ordinal: number;
    method: string;
    window: AttemptWindow;
    leg: FeedbackFaultLeg | null;
    /** The leg's explicit Retry mark was set (immediately before the Retry click) when this attempt arrived. */
    afterRetryMark: boolean;
    /** Distinct valid idempotency keys in the body; memory only. */
    keys: string[];
    unattributed: number;
    /** sha256 of the persisted draft fields (harness `stableDraft`), or null for an unreadable/multi-row body. */
    draftSha: string | null;
    action: AttemptAction;
    capReason: CapReason | null;
    /** What the page's request met: the server's (or the synthetic) HTTP status; null when it got none. */
    status: number | null;
    /** Reached the server: false for a capped/faulted-before-send attempt, null when unknown (a failed `route.fetch`). */
    forwarded: boolean | null;
    /** A 409 answered as the named idempotency replay for this attempt's key. */
    replayNamed: boolean | null;
    settled: boolean;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * The persisted draft of one insert row, as the harness compares a Retry (feedback-fault.cjs `stableDraft`): every column but
 * `metadata`, plus the metadata fields the draft owns. The product rebuilds operational metadata (e.g. `sentryLastEventId`) on
 * Retry, so the whole body is not stable. Null for anything but one row object.
 */
export function stableDraftSha(body: unknown): string | null {
    const row = Array.isArray(body) ? (body.length === 1 ? body[0] : null) : body;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const { metadata, ...fields } = row as Record<string, unknown>;
    const m = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
    const owned = Object.fromEntries(['feedback_type', 'feedback_kind', 'feedback_severity', 'coaching_diagnostic_ref', 'releaseId'].map((k) => [k, m[k] ?? null]));
    const sorted = Object.fromEntries(Object.keys(fields).sort().map((k) => [k, fields[k]]));
    return sha256(JSON.stringify({ ...sorted, metadata: owned }));
}

/**
 * The pre-send cap, decided before the write leaves the browser. `seen` counts every write already recorded (aborted ones
 * too), so the 8th and later are refused whatever happened before; `admittedKeys` are the distinct keys already let through.
 */
export function capDecision(
    state: { seen: number; admittedKeys: readonly string[] }, req: { method: string; keys: readonly string[]; unattributed: number },
): CapReason | null {
    if (req.method !== 'POST') return 'not-an-insert';
    if (state.seen + 1 > FEEDBACK_ATTEMPT_CAP) return 'attempt-cap';
    // An insert row without a valid key could store a report no keyed bound or keyed cleanup sees.
    if (req.unattributed > 0 || req.keys.length === 0) return 'unattributed-insert';
    if (new Set([...state.admittedKeys, ...req.keys]).size > FEEDBACK_REPORT_CAP) return 'report-cap';
    return null;
}

/** The named idempotency replay (product `isIdempotentReplay`, harness `isReplay`): 23505 on the index, details empty or this key. */
export function isNamedIdempotencyReplay(bodyText: string | null, key: string | null): boolean {
    if (!bodyText || !key) return false;
    let parsed: unknown = null;
    try { parsed = JSON.parse(bodyText); } catch { return false; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const error = parsed as { code?: unknown; message?: unknown; details?: unknown };
    if (error.code !== '23505') return false;
    if (typeof error.message !== 'string' || !error.message.includes(`"${FEEDBACK_IDEMPOTENCY_INDEX}"`)) return false;
    return error.details === null || error.details === undefined || error.details === ''
        || (typeof error.details === 'string' && error.details.includes(`(idempotency_key)=(${key})`));
}

/**
 * The synthetic-42501 answer: PostgREST's RLS refusal shape, labelled as a control. It never reaches the server, so it is a
 * form-contract check only — NOT evidence that the real server rejected a row. The CORS header lets the cross-origin page read it.
 */
export function syntheticRejection(origin: string | undefined): { status: number; contentType: string; headers: Record<string, string>; body: string } {
    return {
        status: 403, contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin || '*' },
        body: JSON.stringify({ code: '42501', message: 'RWT SYNTHETIC CONTROL: new row violates row-level security policy for table "user_issue_reports"', details: null, hint: null }),
    };
}

type Window = { kind: 'leg'; leg: FeedbackFaultLeg; retryMarked: boolean } | { kind: 'final' } | null;

/**
 * The run's feedback-write ledger. The spec's route calls `admit` at entry and `settle` with what the request met; the body
 * opens and closes the windows (`armLeg` → `markRetry` → `endWindow`, `beginFinal` → `endWindow`). Outside every window an
 * insert is still admitted under the cap (it is a product write), and the ledger FAILs it.
 */
export class FeedbackAttemptLedger {
    readonly attempts: FeedbackAttempt[] = [];
    private window: Window = null;
    private inFlight = 0;

    armLeg(leg: FeedbackFaultLeg): void { this.window = { kind: 'leg', leg, retryMarked: false }; }
    /** Set immediately before the leg's one explicit Retry click. */
    markRetry(): void { if (this.window?.kind === 'leg') this.window.retryMarked = true; }
    beginFinal(): void { this.window = { kind: 'final' }; }
    endWindow(): void { this.window = null; }

    /** Distinct keys of attempts the cap let through (what can be stored). */
    get admittedKeys(): string[] { return [...new Set(this.attempts.filter((a) => a.action !== 'cap-abort').flatMap((a) => a.keys))]; }
    /** Every distinct key the route saw, aborted ones included (cleanup reads by these). */
    get seenKeys(): string[] { return [...new Set(this.attempts.flatMap((a) => a.keys))]; }
    legAttempts(leg: FeedbackFaultLeg): FeedbackAttempt[] { return this.attempts.filter((a) => a.window === 'leg' && a.leg === leg); }
    finalAttempts(): FeedbackAttempt[] { return this.attempts.filter((a) => a.window === 'final'); }

    /** Record one write at the route's entry and decide it. `readBody` may throw (an unreadable body is unattributed). */
    admit(method: string, readBody: () => unknown): FeedbackAttempt {
        let body: unknown = null;
        try { body = readBody(); } catch { body = null; }
        const { keys, unattributed } = classifyInsertBody(body);
        const capReason = capDecision({ seen: this.attempts.length, admittedKeys: this.admittedKeys }, { method, keys, unattributed });
        const w = this.window;
        const legFirst = w?.kind === 'leg' && !this.attempts.some((a) => a.window === 'leg' && a.leg === w.leg && a.action !== 'cap-abort');
        const action: AttemptAction = capReason ? 'cap-abort' : legFirst && w?.kind === 'leg' ? `fault-${w.leg}` : 'forward';
        const attempt: FeedbackAttempt = {
            ordinal: this.attempts.length + 1, method, window: w?.kind ?? 'outside', leg: w?.kind === 'leg' ? w.leg : null,
            afterRetryMark: w?.kind === 'leg' && w.retryMarked, keys, unattributed, draftSha: stableDraftSha(body),
            action, capReason, status: null, forwarded: null, replayNamed: null, settled: false,
        };
        this.attempts.push(attempt);
        return attempt;
    }

    settle(attempt: FeedbackAttempt, outcome: { status: number | null; forwarded: boolean | null; replayNamed?: boolean | null }): void {
        attempt.status = outcome.status;
        attempt.forwarded = outcome.forwarded;
        attempt.replayNamed = outcome.replayNamed ?? null;
        attempt.settled = true;
    }

    /** Route handlers in flight (each one's write is already recorded); the finalizer drains them before capturing reports. */
    begin(): void { this.inFlight += 1; }
    end(): void { this.inFlight = Math.max(0, this.inFlight - 1); }
    get pending(): number { return this.inFlight; }
    async drain(ms: number, pollMs = 100): Promise<number> {
        const deadline = Date.now() + ms;
        while (this.inFlight > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, pollMs));
        return this.inFlight;
    }
}

/** Content-free ledger evidence: ordinal, window/leg, action, phase, status. Never a key or a body. */
export function ledgerEvidence(attempts: readonly FeedbackAttempt[]): string {
    return attempts.map((a) => `${a.ordinal}:${a.window === 'leg' ? a.leg : a.window}:${a.action}:${a.afterRetryMark ? 'retry' : 'initial'}:${a.status ?? 'none'}`).join(',');
}

function countEvidence(attempts: readonly FeedbackAttempt[]): Evidence {
    const admitted = attempts.filter((a) => a.action !== 'cap-abort');
    return {
        attempts: attempts.length, admittedAttempts: admitted.length, capAborted: attempts.length - admitted.length,
        admittedKeys: new Set(admitted.flatMap((a) => a.keys)).size, attemptCap: FEEDBACK_ATTEMPT_CAP, reportCap: FEEDBACK_REPORT_CAP,
        ledger: ledgerEvidence(attempts),
    };
}

/**
 * `feedback attempts within the cap`: FAIL when the cap aborted any write or the admitted writes exceed 7 attempts or 4 keys;
 * HOLD when the route never observed the final submit (the bound cannot be shown for a run that did not finish); else PASS.
 */
export function feedbackCapVerdict(attempts: readonly FeedbackAttempt[]): RowVerdict {
    const evidence = countEvidence(attempts);
    const capped = attempts.filter((a) => a.action === 'cap-abort');
    if (capped.length > 0) {
        const reasons = [...new Set(capped.map((a) => a.capReason))].join(',');
        return { verdict: 'FAIL', detail: `${capped.length} feedback write(s) were aborted by the cap before they were sent (${reasons})`, evidence };
    }
    if ((evidence.admittedAttempts as number) > FEEDBACK_ATTEMPT_CAP || (evidence.admittedKeys as number) > FEEDBACK_REPORT_CAP) {
        return { verdict: 'FAIL', detail: 'the admitted feedback inserts exceed 7 attempts or 4 distinct keys', evidence };
    }
    if (!attempts.some((a) => a.window === 'final')) {
        return { verdict: 'HOLD', detail: 'the route never observed the final submit, so the run\'s write bound is not shown', evidence };
    }
    return { verdict: 'PASS', detail: 'every feedback insert passed the pre-send cap: at most 7 attempts and 4 distinct keys, none aborted', evidence };
}

/** What a leg's first attempt must have met for its fault to be exercised at the intended boundary. */
function faultExercised(leg: FeedbackFaultLeg, a: FeedbackAttempt): boolean {
    if (!a.settled || a.action !== `fault-${leg}`) return false;
    if (leg === 'synthetic-42501') return a.forwarded === false && a.status === 403;
    if (leg === 'request-lost') return a.forwarded === false && a.status === null;
    return a.forwarded === true && a.status === 201;
}

const oneKey = (a: FeedbackAttempt | undefined): string | null => (a && a.keys.length === 1 && a.unattributed === 0 ? a.keys[0] : null);

/**
 * The exact ledger at the final boundary (harness `classifyAttempt` per leg, expected 2, and the final observe-once, expected 1).
 * VIOLATION → FAIL: a capped write; a write outside every window; a leg with more than 2 attempts, a second attempt before the
 * explicit Retry mark, or a Retry with another key or another draft; a stored-response-lost Retry that STORED again (201: the
 * index did not replay); a final with more than one attempt or a faulted one. INCOMPLETE → HOLD: a missing or unanswered attempt,
 * or a status other than the expected one (fault boundary; Retry 201, or the named 409 replay; final 201). PASS: exactly 7.
 */
export function feedbackLedgerVerdict(attempts: readonly FeedbackAttempt[]): RowVerdict {
    const evidence = countEvidence(attempts);
    const fail = (detail: string): RowVerdict => ({ verdict: 'FAIL', detail, evidence });
    if (attempts.some((a) => a.action === 'cap-abort')) return fail('a feedback write was aborted by the cap, so the run sent more than its designed attempts');
    if (attempts.some((a) => a.window === 'outside')) return fail('a feedback insert was sent outside every fault leg and the final submit');
    const incomplete: string[] = [];
    for (const leg of FEEDBACK_FAULT_LEGS) {
        const own = attempts.filter((a) => a.window === 'leg' && a.leg === leg);
        if (own.length > 2) return fail(`the ${leg} leg sent ${own.length} inserts; exactly the fault and one Retry are allowed`);
        if (own[0] && own[0].action !== `fault-${leg}`) return fail(`the ${leg} leg's first insert was not its injected fault`);
        if (own.length === 2) {
            const [first, retry] = own;
            if (!retry.afterRetryMark) return fail(`the ${leg} leg's second insert came before the explicit Retry`);
            if (oneKey(first) === null || oneKey(first) !== oneKey(retry)) return fail(`the ${leg} leg's Retry did not carry the fault's one idempotency key`);
            if (first.draftSha === null || first.draftSha !== retry.draftSha) return fail(`the ${leg} leg's Retry changed the draft`);
            if (leg === 'stored-response-lost' && retry.status === 201) return fail('the stored-response-lost Retry stored a second row under the same key (no idempotent replay)');
        }
        if (own.length < 2) incomplete.push(`${leg}:attempts=${own.length}`);
        else {
            if (!faultExercised(leg, own[0])) incomplete.push(`${leg}:fault-boundary`);
            const retry = own[1];
            const ok = leg === 'stored-response-lost' ? retry.status === 409 && retry.replayNamed === true : retry.status === 201;
            if (!retry.settled || !ok) incomplete.push(`${leg}:retry-answer`);
        }
    }
    const final = attempts.filter((a) => a.window === 'final');
    if (final.length > 1) return fail(`the final submit sent ${final.length} inserts; exactly one is allowed`);
    if (final[0] && final[0].action !== 'forward') return fail('the final submit\'s insert was faulted');
    if (final.length === 0) incomplete.push('final:attempts=0');
    else if (!final[0].settled || final[0].status !== 201) incomplete.push('final:answer');
    if (incomplete.length > 0) {
        return { verdict: 'HOLD', detail: 'the attempt sequence is incomplete or unanswered; no extra or changed attempt was observed', evidence: { ...evidence, incomplete: incomplete.join(',') } };
    }
    if (attempts.length !== FEEDBACK_ATTEMPT_CAP) return fail(`${attempts.length} feedback inserts; exactly 7 are designed`);
    return { verdict: 'PASS', detail: 'exactly 7 inserts: each fault and its one same-key Retry, then one un-faulted final submit, each answered as designed', evidence };
}

/** Harness `finalAttemptAssertions`: a FAIL observed in the body stays FAIL whatever the final evidence shows. */
export function stickyFinalVerdict(observed: RowVerdict | null, final: RowVerdict): RowVerdict {
    if (observed?.verdict === 'FAIL' && final.verdict !== 'FAIL') {
        return { verdict: 'FAIL', detail: `${observed.detail} (observed before the final boundary)`, evidence: { ...final.evidence, finalVerdict: final.verdict } };
    }
    return final;
}

/** Both ledger rows, judged at the final boundary (after every owned page closed, so no write can still arrive from a page). */
export function writeFeedbackAttemptRows(receipt: RowSink, attempts: readonly FeedbackAttempt[], observedInBody: RowVerdict | null): void {
    const cap = feedbackCapVerdict(attempts);
    receipt.row(FEEDBACK_CAP_ROW, cap.verdict, cap.detail, cap.evidence);
    const ledger = stickyFinalVerdict(observedInBody, feedbackLedgerVerdict(attempts));
    receipt.row(FEEDBACK_LEDGER_ROW, ledger.verdict, ledger.detail, ledger.evidence);
}

/** What the spec read on the page for one leg (booleans and counts; null when the read did not answer). */
export interface LegObservation {
    alertShown: boolean;
    alertText: string | null;
    dialogVisible: boolean | null;
    descriptionKept: boolean | null;
    typeKept: boolean | null;
    sessionKept: boolean | null;
    submitEnabled: boolean | null;
    /** Unmarked acknowledgement toasts when the alert showed (before the Retry). */
    freshBeforeRetry: number | null;
    retried: boolean;
    dialogDetachedAfterRetry: boolean | null;
    freshAfterRetry: number | null;
    /** Rows stored for the owner under the leg's key (service-role read); null when unread. */
    storedRows: number | null;
    storedSessionMatches: boolean | null;
    /** Diagnostics only: console errors from `[issueReportService.submit]`, and the leg's feedback_submit outcomes. */
    serviceErrors: number;
    telemetry: { attempted: number; storageFailed: number; storageOk: number };
}

/** The leg ended with its draft stored and the dialog closed, so the next leg (or the final) starts from a clean dialog. */
export const feedbackLegRecovered = (o: LegObservation): boolean => o.retried && o.dialogDetachedAfterRetry === true;

/** One leg's seven rows, in order. Pure and non-throwing. */
export function feedbackLegRows(leg: FeedbackFaultLeg, o: LegObservation, attempts: readonly FeedbackAttempt[]): ReceiptRowOut[] {
    const names = FEEDBACK_LEG_ROWS[leg];
    const [first, retry] = attempts;
    const rows: ReceiptRowOut[] = [];
    const push = (step: string, verdict: Verdict, detail: string, evidence?: Evidence) => rows.push({ step, verdict, detail, ...(evidence ? { evidence } : {}) });

    // 1. The fault reached its intended boundary.
    const faultEv: Evidence = { attempts: attempts.length, firstAction: first?.action ?? null, firstStatus: first?.status ?? null, firstForwarded: first?.forwarded ?? null };
    if (!first) push(names.fault, 'HOLD', 'the leg\'s insert never reached the route, so the fault was not exercised', faultEv);
    else if (first.action !== `fault-${leg}`) push(names.fault, 'FAIL', 'the leg\'s first insert was not its injected fault', faultEv);
    else if (!faultExercised(leg, first)) push(names.fault, 'HOLD', 'the fault did not reach its intended boundary', faultEv);
    else {
        push(names.fault, 'PASS', leg === 'synthetic-42501' ? 'the first insert was answered 403/42501 by the route and never reached the server (a form-contract control, not real RLS)'
            : leg === 'request-lost' ? 'the first insert was aborted before it was sent' : 'the first insert was stored by the server (201) and its answer was dropped', faultEv);
    }

    // 2. The alert tells the truth.
    if (!o.alertShown) push(names.alert, 'FAIL', 'no alert appeared after the failed insert');
    else if (o.alertText !== FEEDBACK_ERROR_COPY) push(names.alert, 'FAIL', 'the alert does not read "That didn’t go through. Try again?"', { alertTextLength: o.alertText?.length ?? 0 });
    else push(names.alert, 'PASS', 'the dialog\'s alert reads "That didn’t go through. Try again?"');

    // 3. The dialog stays open with the draft and a usable Submit.
    const kept = { dialogVisible: o.dialogVisible, descriptionKept: o.descriptionKept, typeKept: o.typeKept, sessionKept: o.sessionKept, submitEnabled: o.submitEnabled };
    const lost = Object.entries(kept).filter(([, v]) => v === false).map(([k]) => k);
    if (lost.length > 0) push(names.dialog, 'FAIL', `after the failure the form lost: ${lost.join(', ')}`, kept);
    else if (Object.values(kept).some((v) => v === null)) push(names.dialog, 'HOLD', 'the form after the failure could not be read whole', kept);
    else push(names.dialog, 'PASS', 'the dialog stayed open with the description, type and older session kept, and Submit enabled', kept);

    // 4. The Retry is the same draft under the same key.
    const keyEv: Evidence = { attempts: attempts.length, retryAfterMark: retry?.afterRetryMark ?? null };
    if (!o.retried) push(names.sameKey, 'HOLD', 'the Retry was not pressed, so its key was not observed', keyEv);
    else if (attempts.length < 2) push(names.sameKey, 'FAIL', 'the Retry sent no insert', keyEv);
    else if (attempts.length > 2) push(names.sameKey, 'FAIL', `the leg sent ${attempts.length} inserts; only the fault and one Retry are allowed`, keyEv);
    else if (!retry.afterRetryMark) push(names.sameKey, 'FAIL', 'the second insert came before the explicit Retry', keyEv);
    else if (oneKey(first) === null || oneKey(first) !== oneKey(retry)) push(names.sameKey, 'FAIL', 'the Retry did not carry the failed insert\'s one idempotency key', keyEv);
    else if (first.draftSha === null || first.draftSha !== retry.draftSha) push(names.sameKey, 'FAIL', 'the Retry changed the persisted draft', keyEv);
    else push(names.sameKey, 'PASS', 'the explicit Retry resent the same draft under the same idempotency key', keyEv);

    // 5. Nothing claimed success before the Retry.
    if (o.freshBeforeRetry === null) push(names.noAck, 'HOLD', 'the acknowledgements on the page after the failure could not be counted');
    else if (o.freshBeforeRetry !== 0) push(names.noAck, 'FAIL', 'an acknowledgement appeared for the failed insert', { freshBeforeRetry: o.freshBeforeRetry });
    else push(names.noAck, 'PASS', 'no new acknowledgement appeared before the Retry', { freshBeforeRetry: 0 });

    // 6. The Retry is stored (or, after a lost answer, recognised as already stored) and acknowledged exactly once.
    const retryEv: Evidence = { retryStatus: retry?.status ?? null, replayNamed: retry?.replayNamed ?? null, dialogDetached: o.dialogDetachedAfterRetry,
        freshAfterRetry: o.freshAfterRetry, serviceErrors: o.serviceErrors, attempted: o.telemetry.attempted, storageFailed: o.telemetry.storageFailed, storageOk: o.telemetry.storageOk };
    const replayLeg = leg === 'stored-response-lost';
    if (!o.retried) push(names.retry, 'HOLD', 'the Retry was not pressed', retryEv);
    else if (!retry || !retry.settled) push(names.retry, 'HOLD', 'the Retry\'s answer was not observed', retryEv);
    else if (replayLeg && retry.status === 201) push(names.retry, 'FAIL', 'the same-key Retry stored a second row: the unique index did not replay', retryEv);
    else if (replayLeg && !(retry.status === 409 && retry.replayNamed === true)) {
        push(names.retry, 'FAIL', `the Retry was not answered by the real 409 on ${FEEDBACK_IDEMPOTENCY_INDEX}`, retryEv);
    } else if (!replayLeg && retry.status !== 201) push(names.retry, 'FAIL', 'the Retry\'s insert was not stored (201)', retryEv);
    else if (o.dialogDetachedAfterRetry === false) push(names.retry, 'FAIL', 'the dialog stayed open after the Retry', retryEv);
    else if (o.freshAfterRetry !== null && o.freshAfterRetry !== 1) push(names.retry, 'FAIL', `the Retry produced ${o.freshAfterRetry} new acknowledgements; exactly one is required`, retryEv);
    else if (o.dialogDetachedAfterRetry === null || o.freshAfterRetry === null) push(names.retry, 'HOLD', 'the dialog or the acknowledgement after the Retry could not be read', retryEv);
    else {
        push(names.retry, 'PASS', replayLeg
            ? `the Retry met the real 409 on ${FEEDBACK_IDEMPOTENCY_INDEX} and the page treated it as stored: the dialog closed with one new acknowledgement`
            : 'the Retry was stored (201): the dialog closed with one new acknowledgement', retryEv);
    }

    // 7. The leg's key holds exactly one stored row, for the older take.
    const storedEv: Evidence = { storedRows: o.storedRows, sessionMatches: o.storedSessionMatches };
    if (oneKey(first) === null) push(names.stored, 'HOLD', 'the leg\'s idempotency key was not observed, so no stored row is bound to it', storedEv);
    else if (o.storedRows === null) push(names.stored, 'HOLD', 'the rows under the leg\'s key could not be read', storedEv);
    else if (o.storedRows !== 1) push(names.stored, 'FAIL', `${o.storedRows} rows are stored under the leg's key; exactly one is required`, storedEv);
    else if (o.storedSessionMatches !== true) push(names.stored, 'FAIL', 'the leg\'s stored row does not reference the selected older take', storedEv);
    else push(names.stored, 'PASS', 'exactly one row is stored under the leg\'s key, for the selected older take', storedEv);
    return rows;
}

export function writeFeedbackLegRows(receipt: RowSink, leg: FeedbackFaultLeg, o: LegObservation, attempts: readonly FeedbackAttempt[]): void {
    for (const r of feedbackLegRows(leg, o, attempts)) receipt.row(r.step, r.verdict, r.detail, r.evidence);
}

/** A `feedback_submit` event as the AnalyticsTap keeps it (closed fields only). */
export interface FeedbackEvent { event: string; journeyId?: string; fields?: Readonly<Record<string, string | number | boolean>> }

/**
 * `final submit isolated from the fault legs`, judged after the telemetry settle: the ONE `share_feedback` readback binding is the
 * final submit's journey, no leg's feedback event carries that journey, the bound journey's feedback events are only the final's
 * attempted + storage_ok (no `storage_failed`), and the final insert's key is none of the legs'. A second binding, a leg journey
 * bound, a leg event in the bound journey, or a reused key FAILs; no binding, no observed leg journey, or no final key HOLDs.
 */
export function finalIsolationVerdict(input: {
    boundJourneys: readonly string[]; legJourneys: readonly string[]; events: readonly FeedbackEvent[]; legKeys: readonly string[]; finalKeys: readonly string[];
}): RowVerdict {
    const { boundJourneys, legJourneys, events, legKeys, finalKeys } = input;
    const bound = boundJourneys[0] ?? null;
    const inBound = bound ? events.filter((e) => e.event === 'feedback_submit' && e.journeyId === bound) : [];
    const outcome = (o: string) => inBound.filter((e) => e.fields?.outcome === o).length;
    const evidence: Evidence = { bindings: boundJourneys.length, legJourneys: new Set(legJourneys).size, boundFeedbackEvents: inBound.length,
        boundStorageFailed: outcome('storage_failed'), finalKeys: finalKeys.length };
    if (boundJourneys.length > 1) return { verdict: 'FAIL', detail: 'more than one share_feedback action was bound for readback', evidence };
    if (finalKeys.some((k) => legKeys.includes(k))) return { verdict: 'FAIL', detail: 'the final submit reused a fault leg\'s idempotency key', evidence };
    if (bound && legJourneys.includes(bound)) return { verdict: 'FAIL', detail: 'the bound readback journey is a fault leg\'s journey', evidence };
    if (outcome('storage_failed') > 0 || inBound.length > 2) return { verdict: 'FAIL', detail: 'a fault leg\'s feedback event reached the bound readback journey', evidence };
    if (!bound) return { verdict: 'HOLD', detail: 'no share_feedback readback binding was captured for the final submit', evidence };
    if (legJourneys.length === 0) return { verdict: 'HOLD', detail: 'no fault leg\'s journey was observed, so separation from the bound journey is unproven', evidence };
    if (finalKeys.length !== 1) return { verdict: 'HOLD', detail: 'the final submit\'s one idempotency key was not observed', evidence };
    return { verdict: 'PASS', detail: 'the final submit ran in a fresh document whose journey alone is bound; no leg event or key reached it', evidence };
}

/**
 * The events handed to `bindReadbackJourneys` for AHT-07. Its anchor check takes the FIRST canary `feedback_submit` as the
 * share_feedback anchor; with the fault legs that would be a leg's failed Send, so the final submit's binding would read
 * `anchor_mismatch`. Only `feedback_submit` events whose journey is a recorded fault-leg journey are dropped. Every other
 * event (controls, routes, the final submit's own feedback events) is kept, so the boot/route/anchor checks still judge the
 * final submit. A binding captured inside a leg journey still misses (its own anchor is gone) and the isolation row FAILs it.
 * With no leg journeys this returns the events unchanged (AHT-08's path).
 */
export function withoutFaultLegSubmits<E extends { event: string; journeyId?: string }>(events: readonly E[], legJourneys: readonly string[]): readonly E[] {
    if (legJourneys.length === 0) return events;
    return events.filter((e) => !(e.event === 'feedback_submit' && e.journeyId !== undefined && legJourneys.includes(e.journeyId)));
}
