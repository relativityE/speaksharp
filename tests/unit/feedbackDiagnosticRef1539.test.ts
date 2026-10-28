// #1539 / #1491 6123627243 (Codex r4247569209 on #1594) — a MALFORMED stored coaching-diagnostic reference FAILS both
// supplemental association rows; it is never read as "no link".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    noSessionBindingVerdict, olderTakeBindingVerdict, readStoredDiagnosticRef,
    writeNoSessionReportRows, writeOlderTakeBindingRow, writeOlderTakeReportRows, type StoredFeedbackReport,
} from '../live/helpers/feedbackDiagnosticRef';

const here = path.dirname(fileURLToPath(import.meta.url));
const OLDER = '11111111-1111-4111-8111-111111111111';
const NEWER = '22222222-2222-4222-8222-222222222222';
const read = (value: unknown) => readStoredDiagnosticRef(value === undefined ? {} : { coaching_diagnostic_ref: value });

describe('readStoredDiagnosticRef — absent, valid and malformed are distinct', () => {
    it('a missing key, undefined and null are absent', () => {
        expect(readStoredDiagnosticRef({})).toEqual({ kind: 'absent' });
        expect(readStoredDiagnosticRef({ coaching_diagnostic_ref: undefined })).toEqual({ kind: 'absent' });
        expect(read(null)).toEqual({ kind: 'absent' });
    });
    it('a UUIDv4 string — the only shape the product writes — is valid', () => {
        expect(read(OLDER)).toEqual({ kind: 'valid', ref: OLDER });
    });
    it.each([
        ['an object', { id: OLDER }, 'object'],
        ['a number', 42, 'number'],
        ['a boolean', true, 'boolean'],
        ['an array', [OLDER], 'array'],
        ['an empty string', '', 'string'],
        ['a non-UUID string', 'not-a-uuid', 'string'],
        ['a UUID that is not v4', '11111111-1111-1111-8111-111111111111', 'string'],
    ])('%s is malformed, reported by shape only', (_label, value, shape) => {
        expect(read(value)).toEqual({ kind: 'malformed', shape });
    });
});

describe('no-session diagnostic binding', () => {
    it('absent → PASS', () => expect(noSessionBindingVerdict(read(undefined)).verdict).toBe('PASS'));
    it('a borrowed valid reference → FAIL', () => expect(noSessionBindingVerdict(read(OLDER)).verdict).toBe('FAIL'));
    it.each([[{}], [7], [''], ['nope']])('malformed %j → FAIL (was a false PASS)', (value) => {
        const v = noSessionBindingVerdict(read(value));
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).toMatch(/malformed/);
        // Content-free: a stored string value never appears in the detail.
        expect(typeof value === 'string' && value.length > 0 && v.detail.includes(value)).toBe(false);
    });
});

describe('older-take diagnostic binding', () => {
    it('the older take\'s own request, not the newer\'s → PASS', () => {
        expect(olderTakeBindingVerdict(read(OLDER), [OLDER], [NEWER]).verdict).toBe('PASS');
    });
    it('the newer take\'s request → FAIL', () => {
        expect(olderTakeBindingVerdict(read(NEWER), [OLDER], [NEWER]).verdict).toBe('FAIL');
    });
    it('absent → HOLD (binding unproven)', () => {
        expect(olderTakeBindingVerdict(read(undefined), [OLDER], [NEWER]).verdict).toBe('HOLD');
    });
    it('no observed newer-take request → HOLD (exclusion unproven)', () => {
        const v = olderTakeBindingVerdict(read(OLDER), [OLDER], []);
        expect(v.verdict).toBe('HOLD');
        expect(v.detail).toMatch(/newer take sent no observed/);
    });
    it.each([[{}], [7], [''], ['nope']])('malformed %j → FAIL (was a HOLD), even with no observed requests', (value) => {
        expect(olderTakeBindingVerdict(read(value), [OLDER], [NEWER]).verdict).toBe('FAIL');
        expect(olderTakeBindingVerdict(read(value), [], []).verdict).toBe('FAIL');
    });
});

/** A receipt that records the rows a scenario writes, exactly as `RwtReceipt.row` receives them. */
function sink() {
    const rows: Array<{ step: string; verdict: string; detail: string }> = [];
    return { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string) => { rows.push({ step, verdict, detail }); } };
}
const verdicts = (rows: Array<{ step: string; verdict: string }>) => Object.fromEntries(rows.map((r) => [r.step, r.verdict]));
const report = (diagnosticRef: unknown, sessionId: string | null): StoredFeedbackReport => ({
    id: 'report-1', sessionId, storedRows: 1, diagnosticRef: read(diagnosticRef),
});

describe('scenario: No session feedback — the rows the live spec writes', () => {
    it('legitimate: no reference → every report row PASSES', () => {
        const r = sink();
        writeNoSessionReportRows(r, report(undefined, null));
        expect(verdicts(r.rows)).toEqual({ 'no-session report stored once': 'PASS', 'no-session association': 'PASS', 'no-session diagnostic binding': 'PASS' });
    });
    it('a borrowed valid reference → the binding row FAILS', () => {
        const r = sink();
        writeNoSessionReportRows(r, report(OLDER, null));
        expect(verdicts(r.rows)['no-session diagnostic binding']).toBe('FAIL');
    });
    it.each([[{ id: OLDER }], [42], [''], ['not-a-uuid']])('malformed %j → the binding row FAILS (was a false PASS); the other rows are still written, nothing throws', (value) => {
        const r = sink();
        expect(() => writeNoSessionReportRows(r, report(value, null))).not.toThrow();
        expect(verdicts(r.rows)).toEqual({ 'no-session report stored once': 'PASS', 'no-session association': 'PASS', 'no-session diagnostic binding': 'FAIL' });
        expect(r.rows.at(-1)?.detail).toMatch(/malformed/);
    });
});

describe('scenario: feedback for an older take — the rows the live spec writes', () => {
    const olderTake = 'session-older';
    const run = (value: unknown, olderRequests: string[] = [OLDER], newerRequests: string[] = [NEWER]) => {
        const r = sink();
        const stored = report(value, olderTake);
        writeOlderTakeReportRows(r, stored, olderTake);
        writeOlderTakeBindingRow(r, stored, olderRequests, newerRequests);
        return r;
    };
    it('legitimate: the older take\'s own valid reference → every report row PASSES', () => {
        expect(verdicts(run(OLDER).rows)).toEqual({ 'older-take report stored once': 'PASS', 'older-take association': 'PASS', 'older-take diagnostic binding': 'PASS' });
    });
    it('legitimate absent reference → the binding is unproven (HOLD), never PASS or FAIL', () => {
        expect(verdicts(run(undefined).rows)['older-take diagnostic binding']).toBe('HOLD');
    });
    it('the newer take\'s valid reference → the binding row FAILS', () => {
        expect(verdicts(run(NEWER).rows)['older-take diagnostic binding']).toBe('FAIL');
    });
    it.each([[{ id: OLDER }], [42], [''], ['not-a-uuid']])('malformed %j → the binding row FAILS (was a HOLD); the stored and association rows are still written', (value) => {
        let r = sink();
        expect(() => { r = run(value); }).not.toThrow();
        expect(verdicts(r.rows)).toEqual({ 'older-take report stored once': 'PASS', 'older-take association': 'PASS', 'older-take diagnostic binding': 'FAIL' });
        // Even when neither take sent an observed request, a malformed stored reference is a FAIL, not an unproven HOLD.
        expect(verdicts(run(value, [], []).rows)['older-take diagnostic binding']).toBe('FAIL');
    });
});

describe('wiring — both live scenarios capture the report id FIRST, then write their rows through these functions', () => {
    const spec = readFileSync(path.join(here, '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
    it('reads the stored reference through readStoredDiagnosticRef, never a string-only cast', () => {
        expect(spec).toContain('readStoredDiagnosticRef(metadata)');
        expect(spec).not.toMatch(/typeof metadata\.coaching_diagnostic_ref === 'string'/);
    });
    it('the older-take scenario: reportId captured, then its report rows, then (after the chain) its binding row', () => {
        const captured = spec.indexOf('reportId = stored.id;\n            writeOlderTakeReportRows(receipt, stored, olderId);');
        const binding = spec.indexOf('writeOlderTakeBindingRow(receipt, stored, olderRequests, newerRequests);');
        // reportId is captured immediately before the older-take rows.
        expect(captured).toBeGreaterThan(-1);
        expect(binding).toBeGreaterThan(captured);
    });
    it('the No-session scenario: reportId captured, then its rows', () => {
        expect(spec).toContain('reportId = stored.id;\n            writeNoSessionReportRows(receipt, stored);');
    });
    it('no scenario still writes those rows inline', () => {
        for (const step of ['no-session diagnostic binding', 'older-take diagnostic binding', 'no-session report stored once', 'older-take report stored once']) {
            expect(spec).not.toContain(`receipt.row('${step}'`);
        }
    });
});
