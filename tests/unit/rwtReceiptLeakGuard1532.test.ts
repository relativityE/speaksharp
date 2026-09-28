// @vitest-environment node
/**
 * #1532 Codex P1 r4125567004 (PM RETURN 5875940109) — a receipt that fails the leak check must publish nothing
 * original. `guardReceiptOutput` returns the exact receipt file text, worksheet text and log line `RwtReceipt.write()`
 * emits, so these casualties assert on the published bytes themselves.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardReceiptOutput, humanWorksheet, receiptAcceptance, type ReceiptRow } from '../live/helpers/rwtAcceptance';

const ROOT = resolve(__dirname, '../..');
const SUITE = 'rwt-open-mic-first-session';
const RELEASE = 'a'.repeat(40);
const EMAIL = 'rwt-journey-open-mic-1759000000000-36500000001@example.com';
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiJ9.fixture-service-role-value.sig';
const COACHING = 'Slow down before "your" key point';

const rows = (): ReceiptRow[] => [
    { step: 'signup', verdict: 'PASS', detail: 'account created through the real form', evidence: { signupMs: 1200 } },
    { step: 'coaching phrases', verdict: 'PASS', detail: 'two phrases rendered', evidence: { wellWords: 5, nextWords: 4 } },
    { step: 'receipt content-free', verdict: 'PASS', detail: 'no credential, email or coaching text in the receipt' },
];
const build = (r: ReceiptRow[], meta: Record<string, unknown> = { fixture: 'open_mic_tts' }) => {
    const body = { suite: SUITE, release: RELEASE, meta, rows: r, ...receiptAcceptance(r), testStatus: 'passed' };
    const worksheet = humanWorksheet(SUITE, RELEASE, ['j1'], r);
    return { body, worksheet };
};
const guard = (r: ReceiptRow[], meta?: Record<string, unknown>) => {
    const { body, worksheet } = build(r, meta);
    return guardReceiptOutput({ suite: SUITE, release: RELEASE, body, worksheet, forbidden: [EMAIL, SERVICE_ROLE, COACHING], testStatus: 'passed' });
};
const published = (out: ReturnType<typeof guard>) => [out.receiptText, out.worksheetText ?? '', out.logLine].join('\n');
const expectRedacted = (out: ReturnType<typeof guard>, count: number) => {
    expect(out.leakCount).toBe(count);
    expect(out.worksheetText).toBeNull();
    expect(JSON.parse(out.receiptText)).toEqual({ suite: SUITE, release: RELEASE, contaminated: true, acceptance: 'FAIL', leakCount: count, testStatus: 'passed' });
    expect(out.logLine).toBe(`RWT_RECEIPT ${JSON.stringify(JSON.parse(out.receiptText))}`);
    // No original row, detail, evidence or meta survives.
    expect(published(out)).not.toMatch(/signup|coaching phrases|open_mic_tts|wellWords/);
};

describe('guardReceiptOutput — the published receipt, worksheet and log line', () => {
    it('CLEAN CONTROL: normal receipts and worksheets are byte-for-byte what write() emitted before', () => {
        const r = rows();
        const { body, worksheet } = build(r);
        const out = guard(r);
        expect(out.leakCount).toBe(0);
        expect(out.receiptText).toBe(`${JSON.stringify(body, null, 2)}\n`);
        expect(out.worksheetText).toBe(worksheet);
        expect(out.logLine).toBe(`RWT_RECEIPT ${JSON.stringify(body)}`);
    });

    it('an email in a row → redacted failure receipt; the email is in no file and no log line', () => {
        const r = rows();
        r[0].detail = `account ${EMAIL} created`;
        const out = guard(r);
        expectRedacted(out, 1);
        expect(published(out)).not.toContain(EMAIL);
    });

    it('the service-role value in metadata → redacted; the value is in no file and no log line', () => {
        const out = guard(rows(), { fixture: 'open_mic_tts', debugKey: SERVICE_ROLE });
        expectRedacted(out, 1);
        expect(published(out)).not.toContain(SERVICE_ROLE);
        expect(published(out)).not.toContain('fixture-service-role-value');
    });

    it('a value introduced by a LATE row (added after the old call-site scan) is still caught at write time', () => {
        const r = rows();
        // The old call-site scan ran here, over meta + rows, and was clean.
        expect(JSON.stringify(r).includes(COACHING)).toBe(false);
        r.push({ step: 'feedback retention', verdict: 'PASS', detail: 'retained', evidence: { note: COACHING } });
        const out = guard(r);
        expectRedacted(out, 1);
        expect(published(out)).not.toContain('Slow down before');
    });

    it('a JSON-escaped occurrence counts (a value with quotes appears escaped in the receipt text)', () => {
        const r = rows();
        r[1].evidence = { quoted: COACHING };
        expect(`${JSON.stringify(r)}`.includes(COACHING)).toBe(false);   // only the escaped form is present
        expectRedacted(guard(r), 1);
    });

    it('several distinct values are counted, never listed', () => {
        const r = rows();
        r[0].detail = EMAIL;
        r[1].detail = COACHING;
        const out = guard(r, { k: SERVICE_ROLE });
        expectRedacted(out, 3);
        for (const value of [EMAIL, COACHING, SERVICE_ROLE]) expect(published(out)).not.toContain(value);
    });

    it('if an identifying field is itself registered, the redacted receipt drops it too', () => {
        const { body, worksheet } = build(rows(), { leaked: RELEASE });
        const out = guardReceiptOutput({ suite: SUITE, release: RELEASE, body, worksheet, forbidden: [RELEASE], testStatus: 'passed' });
        expect(JSON.parse(out.receiptText)).toEqual({ contaminated: true, acceptance: 'FAIL', leakCount: 1 });
        expect(published(out)).not.toContain(RELEASE);
    });

    it('registrations of 3 characters or fewer are ignored (same threshold as receiptContentLeaks); 4+ fail closed', () => {
        const { body, worksheet } = build(rows());
        const ignored = guardReceiptOutput({ suite: SUITE, release: RELEASE, body, worksheet, forbidden: ['', null, undefined, 'acc'], testStatus: 'passed' });
        expect(ignored.leakCount).toBe(0);
        // A 4-character value that also appears in ordinary receipt text is treated as a leak: fail closed, never open.
        const strict = guardReceiptOutput({ suite: SUITE, release: RELEASE, body, worksheet, forbidden: ['PASS'], testStatus: 'passed' });
        expect(strict.leakCount).toBe(1);
    });
});

describe('wiring — write() publishes only the guard\'s outputs, and every suite registers its values early', () => {
    const journey = readFileSync(resolve(ROOT, 'tests/live/helpers/rwtJourney.ts'), 'utf8');
    const write = journey.slice(journey.indexOf('    write(testInfo: TestInfo'), journey.indexOf('\n    }\n}', journey.indexOf('    write(testInfo: TestInfo')));

    it('write() runs the guard after every row exists and emits nothing else; a contaminated receipt fails the test', () => {
        expect(write.indexOf('guardReceiptOutput(')).toBeGreaterThan(write.indexOf("this.row('readback journey binding'"));
        expect(write.match(/writeFileSync\(/g)).toHaveLength(2);
        expect(write).toContain('writeFileSync(path.join(dir, `${this.suite}.receipt.json`), out.receiptText)');
        expect(write).toContain('writeFileSync(worksheetPath, out.worksheetText)');
        expect(write).toContain('rmSync(worksheetPath, { force: true })');
        expect(write.match(/console\.log\(/g)).toHaveLength(1);
        expect(write).toContain('console.log(out.logLine)');
        expect(write).toMatch(/if \(out\.leakCount > 0\) \{\s+throw new Error/);
        expect(write).not.toMatch(/JSON\.stringify\(body/);
    });

    it('the call-site scan also registers its values', () => {
        expect(journey).toMatch(/export function receiptContentLeaks[\s\S]{0,120}receipt\.forbid\(\.\.\.forbidden\)/);
    });

    it('each suite registers its forbidden values as soon as they exist', () => {
        const openMic = readFileSync(resolve(ROOT, 'tests/live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        expect(openMic).toMatch(/new RwtReceipt\(SUITE\);\s+receipt\.forbid\(SERVICE_ROLE\);/);
        expect(openMic).toMatch(/createdEmail = newDisposableEmail\('open-mic'\);\s+receipt\.forbid\(createdEmail\);/);
        expect(openMic).toContain('receipt.forbid(shownWell, shownNext);');
        expect(openMic).toContain('receipt.forbid(savedWell, savedNext);');
        const focus = readFileSync(resolve(ROOT, 'tests/live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(focus).toMatch(/new RwtReceipt\(suite\);\s+receipt\.forbid\(SERVICE_ROLE, topic, \.\.\.points\);/);
        expect(focus).toMatch(/owner\.email = newDisposableEmail\('focus-points'\);\s+receipt\.forbid\(owner\.email\);/);
        const nav = readFileSync(resolve(ROOT, 'tests/live/rwt-products-navigation.live.spec.ts'), 'utf8');
        expect(nav).toMatch(/new RwtReceipt\(SUITE\);\s+receipt\.forbid\(RETURNING_EMAIL, RETURNING_PASSWORD, SERVICE_ROLE\);/);
    });
});
