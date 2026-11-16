/**
 * #1539 / #1491 6123627243 (Codex r4247569209 on #1594) — the stored feedback report's coaching-diagnostic reference,
 * read in THREE states rather than two.
 *
 * The product writes `metadata.coaching_diagnostic_ref` only as a validated UUIDv4 (`coachingDiagnosticLink.ts`) or
 * omits it. The supplemental association spec used to read any non-string value as "no link", so a MALFORMED stored
 * reference — a product regression — passed the no-session binding row and turned the older-take row into a HOLD.
 * Absent, valid and malformed are now distinct, and malformed FAILS both rows. Details stay content-free: the shape of a
 * malformed value is reported, never the value.
 */
import type { BrowserContext, Page, Request } from '@playwright/test';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MalformedShape = 'string' | 'number' | 'boolean' | 'object' | 'array';
export type StoredDiagnosticRef =
    | { kind: 'absent' }
    | { kind: 'valid'; ref: string }
    | { kind: 'malformed'; shape: MalformedShape };

export function readStoredDiagnosticRef(metadata: Record<string, unknown>): StoredDiagnosticRef {
    const value = metadata.coaching_diagnostic_ref;
    if (value === undefined || value === null) return { kind: 'absent' };
    if (typeof value === 'string') return UUID_V4.test(value) ? { kind: 'valid', ref: value } : { kind: 'malformed', shape: 'string' };
    if (Array.isArray(value)) return { kind: 'malformed', shape: 'array' };
    if (typeof value === 'number' || typeof value === 'boolean') return { kind: 'malformed', shape: typeof value as 'number' | 'boolean' };
    return { kind: 'malformed', shape: 'object' };
}

export type BindingVerdict = { verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string };

/** A report filed with No session selected must carry no reference at all — a borrowed or malformed one FAILS. */
export function noSessionBindingVerdict(stored: StoredDiagnosticRef): BindingVerdict {
    if (stored.kind === 'absent') return { verdict: 'PASS', detail: 'the report has no coaching diagnostic reference' };
    if (stored.kind === 'malformed') return { verdict: 'FAIL', detail: `the report stored a malformed coaching diagnostic reference (${stored.shape})` };
    return { verdict: 'FAIL', detail: 'the report borrowed a coaching diagnostic reference' };
}

/**
 * The older take's report must reference a request SENT for the older take and not one sent for the newer take. A
 * malformed reference FAILS; an absent one, or no observed request on either side, cannot prove binding (HOLD).
 */
export function olderTakeBindingVerdict(
    stored: StoredDiagnosticRef, olderRequests: readonly string[], newerRequests: readonly string[],
): BindingVerdict {
    if (stored.kind === 'malformed') {
        return { verdict: 'FAIL', detail: `the report stored a malformed coaching diagnostic reference (${stored.shape})` };
    }
    // Codex P1 r4247450898: "not the newer take" is proven only against an OBSERVED newer-take request; with none, HOLD.
    if (olderRequests.length === 0 || newerRequests.length === 0 || stored.kind === 'absent') {
        return {
            verdict: 'HOLD',
            detail: newerRequests.length === 0 && olderRequests.length > 0 && stored.kind === 'valid'
                ? 'the newer take sent no observed coaching request, so excluding it is unproven'
                : 'the older take has no captured request link, so binding is unproven',
        };
    }
    return olderRequests.includes(stored.ref) && !newerRequests.includes(stored.ref)
        ? { verdict: 'PASS', detail: 'the report references a request sent for the older take and not the newer take' }
        : { verdict: 'FAIL', detail: 'the report references an unrelated or newer-take diagnostic request' };
}

/**
 * The stored report as the supplemental spec reads it back (content-free). The read is bound to THIS submit: the rows
 * stored under the idempotency key(s) the page's own feedback insert carried (`insertKeys` distinct keys over
 * `insertRequests` POSTs), for the owner. Retries of one draft resend the same key, and the unique index makes that one row.
 */
export type StoredFeedbackReport = {
    id: string | null; sessionId: string | null; diagnosticRef: StoredDiagnosticRef; storedRows: number;
    /** Distinct valid keys, insert POSTs, and inserted rows (or whole bodies) that carried NO valid key (Sam, #1811 RETURN item 1). */
    insertKeys: number; insertRequests: number; unattributedInserts: number;
};
/** The receipt surface the scenario rows are written to (`RwtReceipt.row`). */
export type ReceiptRowSink = { row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, number | string | boolean | null>): void };

/** The product's feedback insert (`issueReportService.submit`: a plain PostgREST INSERT into `user_issue_reports`). */
export const FEEDBACK_INSERT_URL = /\/rest\/v1\/user_issue_reports(?:\?|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An insert body's attribution: the distinct `idempotency_key` values (migration 20260904150000, a uuid) its rows carry, and how
 * many inserted rows carry NONE. A row with a missing, null, non-string or malformed key is unattributed; so is a body that is not a
 * JSON object or a non-empty array of objects (unreadable, malformed or empty), counted once. An unattributed insert could store a
 * report the keyed read never sees, so stored-once fails closed on it (Sam, #1811 RETURN item 1).
 */
export function classifyInsertBody(body: unknown): { keys: string[]; unattributed: number } {
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length === 0) return { keys: [], unattributed: 1 };
    const keys: string[] = [];
    let unattributed = 0;
    for (const r of rows) {
        const key = r && typeof r === 'object' && !Array.isArray(r) ? (r as { idempotency_key?: unknown }).idempotency_key : undefined;
        if (typeof key === 'string' && UUID.test(key)) { if (!keys.includes(key)) keys.push(key); } else unattributed += 1;
    }
    return { keys, unattributed };
}

/** The valid idempotency key(s) an insert body carries (see `classifyInsertBody`). */
export function idempotencyKeysOfInsertBody(body: unknown): string[] {
    return classifyInsertBody(body).keys;
}


/**
 * Observes the page's feedback insert POSTs while a submit is in flight and keeps the distinct idempotency keys they
 * carried, in order. Several POSTs of one draft (a retry) carry the SAME key and count once. Keys stay in memory only.
 */
export class FeedbackInsertObserver {
    insertRequests = 0;
    /** Inserted rows (or whole unreadable bodies) that carried no valid idempotency key. */
    unattributedInserts = 0;
    readonly keys: string[] = [];
    private readonly handler = (r: Request) => {
        if (r.method() !== 'POST' || !FEEDBACK_INSERT_URL.test(r.url())) return;
        this.observeBody(() => r.postDataJSON());
    };
    /** One insert POST's body (a reader, because Playwright's parse can throw). Exposed for the unit controls. */
    observeBody(read: () => unknown): void {
        this.insertRequests += 1;
        let body: unknown = null;
        try { body = read(); } catch { body = null; }
        const { keys, unattributed } = classifyInsertBody(body);
        this.unattributedInserts += unattributed;
        for (const k of keys) if (!this.keys.includes(k)) this.keys.push(k);
    }
    constructor(private readonly context: BrowserContext | null) { context?.on('request', this.handler); }
    stop(): void { this.context?.off('request', this.handler); }
}

const UNBOUND_DETAIL = 'no feedback insert carrying an idempotency key was observed for this submit, so no stored report is bound to it';
const UNATTRIBUTED_DETAIL = 'a feedback insert for this submit carried no valid idempotency key, so a report it stored would be invisible to the keyed read';
const insertEvidence = (stored: StoredFeedbackReport) => ({ storedRows: stored.storedRows, insertKeys: stored.insertKeys,
    insertRequests: stored.insertRequests, unattributedInserts: stored.unattributedInserts });
/**
 * Stored-once, fail closed: FAIL on any unattributed insert (a missing, null or malformed key, or an unreadable body), even beside a
 * keyed one; HOLD when no insert was observed at all; FAIL when one submit carried more than one key or its key holds other than one
 * row; PASS only for exactly one key, every insert attributed to it, and exactly one stored row under it.
 */
function storedOnceRow(receipt: ReceiptRowSink, step: string, stored: StoredFeedbackReport, passDetail: string): void {
    if (stored.unattributedInserts !== 0) { receipt.row(step, 'FAIL', UNATTRIBUTED_DETAIL, insertEvidence(stored)); return; }
    if (stored.insertKeys === 0) { receipt.row(step, 'HOLD', UNBOUND_DETAIL, insertEvidence(stored)); return; }
    const once = stored.insertKeys === 1 && stored.storedRows === 1 && Boolean(stored.id);
    receipt.row(step, once ? 'PASS' : 'FAIL',
        once ? passDetail : stored.insertKeys > 1 ? 'the submit\'s feedback inserts carried more than one idempotency key'
            : 'feedback was not stored exactly once under the submit\'s idempotency key', insertEvidence(stored));
}

/**
 * The No-session scenario's report rows, in order. Pure and non-throwing, so a malformed reference becomes a FAIL row
 * while the caller's already-captured `reportId` still drives cleanup and retention bookkeeping. With no observed key no
 * report was read, so the association and binding rows HOLD too (an unread report is never "no link").
 */
/**
 * Why a stored report's association or link cannot be judged, or null when it can: no insert key observed, or the key did not read
 * back exactly one stored report (an absent row must never read as "no session" or "no link").
 */
function unjudgedDetail(stored: StoredFeedbackReport): string | null {
    if (stored.unattributedInserts !== 0) return UNATTRIBUTED_DETAIL;
    if (stored.insertKeys === 0) return UNBOUND_DETAIL;
    if (stored.storedRows !== 1 || !stored.id) return 'the submit\'s idempotency key did not read back exactly one stored report, so its association is not judged';
    return null;
}

export function writeNoSessionReportRows(receipt: ReceiptRowSink, stored: StoredFeedbackReport): void {
    storedOnceRow(receipt, 'no-session report stored once', stored, 'one no-session feedback report was acknowledged and read back under the submit\'s idempotency key');
    const unjudged = unjudgedDetail(stored);
    if (unjudged) {
        receipt.row('no-session association', 'HOLD', unjudged);
        receipt.row('no-session diagnostic binding', 'HOLD', unjudged);
        return;
    }
    receipt.row('no-session association', stored.sessionId === null ? 'PASS' : 'FAIL',
        stored.sessionId === null ? 'the report has no session association' : 'the report was linked to a session despite No session being selected');
    const binding = noSessionBindingVerdict(stored.diagnosticRef);
    receipt.row('no-session diagnostic binding', binding.verdict, binding.detail);
}

/** The older-take scenario's stored-report rows (before the diagnostic chain is settled). Pure and non-throwing. */
export function writeOlderTakeReportRows(receipt: ReceiptRowSink, stored: StoredFeedbackReport, olderId: string): void {
    storedOnceRow(receipt, 'older-take report stored once', stored, 'one feedback report was acknowledged and read back under the submit\'s idempotency key');
    const unjudged = unjudgedDetail(stored);
    if (unjudged) { receipt.row('older-take association', 'HOLD', unjudged); return; }
    const correctSession = stored.sessionId === olderId;
    receipt.row('older-take association', correctSession ? 'PASS' : 'FAIL',
        correctSession ? 'the persisted report references the selected older take' : 'the persisted report does not reference the selected older take');
}

/** The older-take scenario's diagnostic-binding row (after the chain settles). Pure and non-throwing. */
export function writeOlderTakeBindingRow(
    receipt: ReceiptRowSink, stored: StoredFeedbackReport, olderRequests: readonly string[], newerRequests: readonly string[],
): void {
    const unjudged = unjudgedDetail(stored);
    const binding = unjudged ? { verdict: 'HOLD' as const, detail: unjudged }
        : olderTakeBindingVerdict(stored.diagnosticRef, olderRequests, newerRequests);
    receipt.row('older-take diagnostic binding', binding.verdict, binding.detail,
        { olderRequests: olderRequests.length, newerRequests: newerRequests.length });
}

/**
 * AHT-08 (fifteen-case front-run review, 2026-11-10) — the submit's own `fresh acknowledgment` row. Earlier toasts are marked
 * BEFORE the submit, so only a toast this submit produced counts; the dialog must also detach (the product closes it on success,
 * `IssueReportDialog`). This is the harness definition (AHT-07/08 case body: mark, submit, dialog detached, unmarked toast).
 */
export const ACK_TOAST = 'li[data-sonner-toast]';
export const ACK_COPY = 'Thanks — we’ve got it.';
export const PREVIOUS_ACK_ATTR = 'data-rwt-previous-ack';

export interface EarlierAcknowledgments { marked: boolean; earlier: number }
export interface FreshAcknowledgmentObservation extends EarlierAcknowledgments { dialogDetached: boolean; freshToastVisible: boolean }

/** Marks every toast already on the page; `marked` is false when the page could not be marked (freshness then unproven). */
export async function markEarlierAcknowledgments(page: Page): Promise<EarlierAcknowledgments> {
    return page.locator(ACK_TOAST).evaluateAll((els, attr) => { els.forEach((el) => el.setAttribute(attr, 'true')); return els.length; }, PREVIOUS_ACK_ATTR)
        .then((earlier) => ({ marked: true, earlier }), () => ({ marked: false, earlier: 0 }));
}

/** After the submit: the dialog detaches and an UNMARKED acknowledgment toast is visible, both awaited (bounded) at once. */
export async function observeFreshAcknowledgment(page: Page, earlier: EarlierAcknowledgments, timeoutMs = 30_000): Promise<FreshAcknowledgmentObservation> {
    const [dialogDetached, freshToastVisible] = await Promise.all([
        page.getByTestId('issue-report-dialog').waitFor({ state: 'detached', timeout: timeoutMs }).then(() => true, () => false),
        page.locator(`${ACK_TOAST}:not([${PREVIOUS_ACK_ATTR}])`).filter({ hasText: ACK_COPY }).first()
            .waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false),
    ]);
    return { ...earlier, dialogDetached, freshToastVisible };
}

/** PASS only for a marked page, a detached dialog and a fresh toast; an unmarked page (freshness unproven) is HOLD. */
export function freshAcknowledgmentVerdict(o: FreshAcknowledgmentObservation | null): BindingVerdict & { evidence: Record<string, number | boolean> } {
    if (!o || !o.marked) {
        return { verdict: 'HOLD', detail: 'the toasts on the page before the submit could not be marked, so a fresh acknowledgment is unproven',
            evidence: { marked: false } };
    }
    const evidence = { marked: true, earlierToasts: o.earlier, dialogDetached: o.dialogDetached, freshToastVisible: o.freshToastVisible };
    if (!o.dialogDetached) return { verdict: 'FAIL', detail: 'the feedback dialog did not close after the submit', evidence };
    if (!o.freshToastVisible) return { verdict: 'FAIL', detail: 'no acknowledgment appeared that was not already on the page before the submit', evidence };
    return { verdict: 'PASS', detail: 'the dialog closed and a new acknowledgment appeared for this submit', evidence };
}

export function writeFreshAcknowledgmentRow(receipt: ReceiptRowSink, o: FreshAcknowledgmentObservation | null): void {
    const v = freshAcknowledgmentVerdict(o);
    receipt.row('fresh acknowledgment', v.verdict, v.detail, v.evidence);
}

/** A `feedback_submit` event as the AnalyticsTap keeps it (closed fields only; see `SentEvent`). */
export interface FeedbackSubmitEvent {
    event: string; bootId?: string; journeyId?: string; releaseSha?: string; trafficType?: string;
    fields?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * AHT-08 — the in-spec `received feedback` row: the submit's own `feedback_submit` events (those sent since the submit) are
 * EXACTLY one `attempted` and one `storage_ok` with the same `submit_seq`, one boot/journey/release/traffic identity, the run's
 * expected release and canary traffic. This is the harness's local sent verdict (oracles/feedback-sequence.cjs
 * `feedbackSentVerdict`) without its capture-order check. An observed `storage_failed`, an extra event, a second attempt, or a
 * mismatched sequence or identity FAILS; an undecodable PostHog beacon since the submit, a missing event or a missing identity
 * field is HOLD. Receipt by PostHog itself stays the rc-gates readback's to settle: this row proves what left the page.
 */
export function receivedFeedbackVerdict(
    sinceSubmit: readonly FeedbackSubmitEvent[], { blindSinceSubmit, expectedReleaseSha }: { blindSinceSubmit: number; expectedReleaseSha: string },
): BindingVerdict & { evidence: Record<string, number> } {
    const events = sinceSubmit.filter((e) => e.event === 'feedback_submit');
    const outcome = (o: string) => events.filter((e) => e.fields?.outcome === o).length;
    const evidence = { events: events.length, attempted: outcome('attempted'), storageOk: outcome('storage_ok'),
        storageFailed: outcome('storage_failed'), blindSinceSubmit };
    if (evidence.storageFailed > 0) return { verdict: 'FAIL', detail: 'the submit reported storage_failed', evidence };
    if (events.length > 2) return { verdict: 'FAIL', detail: 'the submit sent more than one attempted/outcome pair', evidence };
    if (blindSinceSubmit !== 0) return { verdict: 'HOLD', detail: 'a PostHog beacon since the submit was not decodable, so duplicates cannot be excluded', evidence };
    if (events.length < 2) return { verdict: 'HOLD', detail: 'the submit\'s attempted/storage_ok pair was not observed whole', evidence };
    if (evidence.attempted !== 1 || evidence.storageOk !== 1) return { verdict: 'FAIL', detail: 'the submit did not send exactly one attempted and one storage_ok', evidence };
    const [a, b] = events;
    const seq = a.fields?.submit_seq;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || b.fields?.submit_seq !== seq) {
        return { verdict: 'FAIL', detail: 'the attempted and storage_ok events do not share one valid submit_seq', evidence };
    }
    const identity = ['bootId', 'journeyId', 'releaseSha', 'trafficType'] as const;
    if (!expectedReleaseSha || identity.some((k) => typeof a[k] !== 'string' || !a[k])) {
        return { verdict: 'HOLD', detail: 'the sent identity (boot, journey, release, traffic class) or the expected release is unknown', evidence };
    }
    if (identity.some((k) => b[k] !== a[k])) return { verdict: 'FAIL', detail: 'the attempted and storage_ok events carry different identities', evidence };
    if (a.releaseSha !== expectedReleaseSha || a.trafficType !== 'canary') {
        return { verdict: 'FAIL', detail: 'the feedback events are not bound to the run\'s release as canary traffic', evidence };
    }
    return { verdict: 'PASS', detail: 'exactly one attempted and one storage_ok with the same submit_seq left the page (receipt is the readback\'s)', evidence };
}

export function writeReceivedFeedbackRow(
    receipt: ReceiptRowSink, sinceSubmit: readonly FeedbackSubmitEvent[], opts: { blindSinceSubmit: number; expectedReleaseSha: string },
): void {
    const v = receivedFeedbackVerdict(sinceSubmit, opts);
    receipt.row('received feedback', v.verdict, v.detail, v.evidence);
}
