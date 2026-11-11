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
import type { BrowserContext, Request } from '@playwright/test';

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
    insertKeys: number; insertRequests: number;
};
/** The receipt surface the scenario rows are written to (`RwtReceipt.row`). */
export type ReceiptRowSink = { row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, number | string | boolean | null>): void };

/** The product's feedback insert (`issueReportService.submit`: a plain PostgREST INSERT into `user_issue_reports`). */
export const FEEDBACK_INSERT_URL = /\/rest\/v1\/user_issue_reports(?:\?|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The idempotency key(s) an insert body carries: the row's `idempotency_key` column (migration 20260904150000, a uuid),
 * read from a single-row object or each row of an array. Anything else carries no key.
 */
export function idempotencyKeysOfInsertBody(body: unknown): string[] {
    const rows = Array.isArray(body) ? body : [body];
    const keys: string[] = [];
    for (const r of rows) {
        const key = r && typeof r === 'object' ? (r as { idempotency_key?: unknown }).idempotency_key : undefined;
        if (typeof key === 'string' && UUID.test(key) && !keys.includes(key)) keys.push(key);
    }
    return keys;
}


/**
 * Observes the page's feedback insert POSTs while a submit is in flight and keeps the distinct idempotency keys they
 * carried, in order. Several POSTs of one draft (a retry) carry the SAME key and count once. Keys stay in memory only.
 */
export class FeedbackInsertObserver {
    insertRequests = 0;
    readonly keys: string[] = [];
    private readonly handler = (r: Request) => {
        if (r.method() !== 'POST' || !FEEDBACK_INSERT_URL.test(r.url())) return;
        this.insertRequests += 1;
        let body: unknown = null;
        try { body = r.postDataJSON(); } catch { body = null; }
        for (const k of idempotencyKeysOfInsertBody(body)) if (!this.keys.includes(k)) this.keys.push(k);
    };
    constructor(private readonly context: BrowserContext) { context.on('request', this.handler); }
    stop(): void { this.context.off('request', this.handler); }
}

const UNBOUND_DETAIL = 'no feedback insert carrying an idempotency key was observed for this submit, so no stored report is bound to it';
const insertEvidence = (stored: StoredFeedbackReport) => ({ storedRows: stored.storedRows, insertKeys: stored.insertKeys, insertRequests: stored.insertRequests });
/** Stored-once: HOLD with no observed key; FAIL when one submit carried more than one key or the key holds other than one row. */
function storedOnceRow(receipt: ReceiptRowSink, step: string, stored: StoredFeedbackReport, passDetail: string): void {
    if (stored.insertKeys === 0) { receipt.row(step, 'HOLD', UNBOUND_DETAIL, insertEvidence(stored)); return; }
    const once = !(stored.insertKeys > 1) && stored.storedRows === 1 && Boolean(stored.id);
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
