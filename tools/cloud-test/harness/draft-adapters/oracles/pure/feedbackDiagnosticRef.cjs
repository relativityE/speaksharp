// Exact main70e TypeScript source mechanically transpiled; no browser/network executed.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readStoredDiagnosticRef = readStoredDiagnosticRef;
exports.noSessionBindingVerdict = noSessionBindingVerdict;
exports.olderTakeBindingVerdict = olderTakeBindingVerdict;
exports.writeNoSessionReportRows = writeNoSessionReportRows;
exports.writeOlderTakeReportRows = writeOlderTakeReportRows;
exports.writeOlderTakeBindingRow = writeOlderTakeBindingRow;
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
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readStoredDiagnosticRef(metadata) {
    const value = metadata.coaching_diagnostic_ref;
    if (value === undefined || value === null)
        return { kind: 'absent' };
    if (typeof value === 'string')
        return UUID_V4.test(value) ? { kind: 'valid', ref: value } : { kind: 'malformed', shape: 'string' };
    if (Array.isArray(value))
        return { kind: 'malformed', shape: 'array' };
    if (typeof value === 'number' || typeof value === 'boolean')
        return { kind: 'malformed', shape: typeof value };
    return { kind: 'malformed', shape: 'object' };
}
/** A report filed with No session selected must carry no reference at all — a borrowed or malformed one FAILS. */
function noSessionBindingVerdict(stored) {
    if (stored.kind === 'absent')
        return { verdict: 'PASS', detail: 'the report has no coaching diagnostic reference' };
    if (stored.kind === 'malformed')
        return { verdict: 'FAIL', detail: `the report stored a malformed coaching diagnostic reference (${stored.shape})` };
    return { verdict: 'FAIL', detail: 'the report borrowed a coaching diagnostic reference' };
}
/**
 * The older take's report must reference a request SENT for the older take and not one sent for the newer take. A
 * malformed reference FAILS; an absent one, or no observed request on either side, cannot prove binding (HOLD).
 */
function olderTakeBindingVerdict(stored, olderRequests, newerRequests) {
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
 * The No-session scenario's report rows, in order. Pure and non-throwing, so a malformed reference becomes a FAIL row
 * while the caller's already-captured `reportId` still drives cleanup and retention bookkeeping.
 */
function writeNoSessionReportRows(receipt, stored) {
    const once = stored.storedRows === 1 && Boolean(stored.id);
    receipt.row('no-session report stored once', once ? 'PASS' : 'FAIL', once ? 'one no-session feedback report was acknowledged and read back' : 'feedback was not stored exactly once', { storedRows: stored.storedRows });
    receipt.row('no-session association', stored.sessionId === null ? 'PASS' : 'FAIL', stored.sessionId === null ? 'the report has no session association' : 'the report was linked to a session despite No session being selected');
    const binding = noSessionBindingVerdict(stored.diagnosticRef);
    receipt.row('no-session diagnostic binding', binding.verdict, binding.detail);
}
/** The older-take scenario's stored-report rows (before the diagnostic chain is settled). Pure and non-throwing. */
function writeOlderTakeReportRows(receipt, stored, olderId) {
    const once = stored.storedRows === 1 && Boolean(stored.id);
    receipt.row('older-take report stored once', once ? 'PASS' : 'FAIL', once ? 'one feedback report was acknowledged and read back' : 'feedback was not stored exactly once', { storedRows: stored.storedRows });
    const correctSession = stored.sessionId === olderId;
    receipt.row('older-take association', correctSession ? 'PASS' : 'FAIL', correctSession ? 'the persisted report references the selected older take' : 'the persisted report does not reference the selected older take');
}
/** The older-take scenario's diagnostic-binding row (after the chain settles). Pure and non-throwing. */
function writeOlderTakeBindingRow(receipt, stored, olderRequests, newerRequests) {
    const binding = olderTakeBindingVerdict(stored.diagnosticRef, olderRequests, newerRequests);
    receipt.row('older-take diagnostic binding', binding.verdict, binding.detail, { olderRequests: olderRequests.length, newerRequests: newerRequests.length });
}
