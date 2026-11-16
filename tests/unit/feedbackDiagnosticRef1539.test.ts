// #1539 / #1491 6123627243 (Codex r4247569209 on #1594) — a MALFORMED stored coaching-diagnostic reference FAILS both
// supplemental association rows; it is never read as "no link".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    FeedbackInsertObserver, classifyInsertBody, noSessionBindingVerdict, olderTakeBindingVerdict, readStoredDiagnosticRef,
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
    // The binding the live spec actually establishes: one observed key, one insert, every insert attributed (Sam, #1811 RETURN).
    insertKeys: 1, insertRequests: 1, unattributedInserts: 0,
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

// Sam, #1811 RETURN item 1: stored-once is bound to the observed idempotency key and fails CLOSED on any insert that carries no
// valid key, because a report stored by an unattributed insert is invisible to the keyed read and could hide a duplicate.
describe('stored-once binding — observed inserts drive the verdict, unattributed inserts fail closed', () => {
    const KEY = '33333333-3333-4333-8333-333333333333';
    const OTHER_KEY = '44444444-4444-4444-8444-444444444444';
    const observe = (...bodies: Array<() => unknown>) => {
        const o = new FeedbackInsertObserver(null);
        for (const b of bodies) o.observeBody(b);
        return o;
    };
    const stored = (o: FeedbackInsertObserver, storedRows = 1): StoredFeedbackReport => ({
        id: storedRows === 1 ? 'report-1' : null, sessionId: null, storedRows, diagnosticRef: read(undefined),
        insertKeys: o.keys.length, insertRequests: o.insertRequests, unattributedInserts: o.unattributedInserts,
    });
    const noSession = (s: StoredFeedbackReport) => { const r = sink(); writeNoSessionReportRows(r, s); return verdicts(r.rows); };
    const olderTake = (s: StoredFeedbackReport) => { const r = sink(); writeOlderTakeReportRows(r, s, 'older'); return verdicts(r.rows); };

    it('classifies bodies: keyed rows, missing/null/malformed keys, arrays, empty and non-object bodies', () => {
        expect(classifyInsertBody({ idempotency_key: KEY })).toEqual({ keys: [KEY], unattributed: 0 });
        expect(classifyInsertBody({ idempotency_key: null })).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody({})).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody({ idempotency_key: 'not-a-uuid' })).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody({ idempotency_key: 42 })).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody([{ idempotency_key: KEY }, { idempotency_key: null }])).toEqual({ keys: [KEY], unattributed: 1 });
        expect(classifyInsertBody([])).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody(null)).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody('text')).toEqual({ keys: [], unattributed: 1 });
        expect(classifyInsertBody([[{ idempotency_key: KEY }]])).toEqual({ keys: [], unattributed: 1 });
    });
    it('one keyed insert and one stored row → PASS', () => {
        expect(noSession(stored(observe(() => ({ idempotency_key: KEY })))))
            .toEqual({ 'no-session report stored once': 'PASS', 'no-session association': 'PASS', 'no-session diagnostic binding': 'PASS' });
    });
    it('a retry resending the SAME key is still one key → PASS', () => {
        const o = observe(() => ({ idempotency_key: KEY }), () => ({ idempotency_key: KEY }));
        expect(o.insertRequests).toBe(2);
        expect(noSession(stored(o))['no-session report stored once']).toBe('PASS');
    });
    it('mixed: a valid-key insert plus a second NULL-key insert → FAIL (was a false PASS), association rows HOLD', () => {
        const o = observe(() => ({ idempotency_key: KEY }), () => ({ idempotency_key: null }));
        expect(noSession(stored(o))).toEqual({ 'no-session report stored once': 'FAIL', 'no-session association': 'HOLD', 'no-session diagnostic binding': 'HOLD' });
        expect(olderTake(stored(o))).toEqual({ 'older-take report stored once': 'FAIL', 'older-take association': 'HOLD' });
    });
    it('mixed: a valid-key insert plus a second insert with NO key field → FAIL', () => {
        expect(noSession(stored(observe(() => ({ idempotency_key: KEY }), () => ({ description: 'x' }))))['no-session report stored once']).toBe('FAIL');
    });
    it('a malformed body (unparseable) beside a keyed insert → FAIL', () => {
        const o = observe(() => ({ idempotency_key: KEY }), () => { throw new SyntaxError('bad json'); });
        expect(o.unattributedInserts).toBe(1);
        expect(noSession(stored(o))['no-session report stored once']).toBe('FAIL');
    });
    it('a malformed key string → FAIL, even alone', () => {
        expect(noSession(stored(observe(() => ({ idempotency_key: 'abc' }))))['no-session report stored once']).toBe('FAIL');
    });
    it('only NULL-key inserts → FAIL, not HOLD (an insert was seen and is unattributable)', () => {
        expect(noSession(stored(observe(() => ({ idempotency_key: null }))))['no-session report stored once']).toBe('FAIL');
    });
    it('no insert observed at all → HOLD, association rows HOLD', () => {
        expect(noSession(stored(observe(), 0))).toEqual({ 'no-session report stored once': 'HOLD', 'no-session association': 'HOLD', 'no-session diagnostic binding': 'HOLD' });
    });
    it('two distinct keys → FAIL', () => {
        expect(noSession(stored(observe(() => ({ idempotency_key: KEY }), () => ({ idempotency_key: OTHER_KEY })), 2))['no-session report stored once']).toBe('FAIL');
    });
    it('one key but zero or two stored rows → FAIL, association rows HOLD (an unread report is never "no session")', () => {
        expect(noSession(stored(observe(() => ({ idempotency_key: KEY })), 0)))
            .toEqual({ 'no-session report stored once': 'FAIL', 'no-session association': 'HOLD', 'no-session diagnostic binding': 'HOLD' });
        expect(noSession(stored(observe(() => ({ idempotency_key: KEY })), 2))['no-session report stored once']).toBe('FAIL');
    });
    it('the live spec passes the observer\'s unattributed count into the stored report', () => {
        const spec = readFileSync(path.resolve(here, '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
        expect(spec).toContain('unattributedInserts: inserts.unattributedInserts');
    });
});
