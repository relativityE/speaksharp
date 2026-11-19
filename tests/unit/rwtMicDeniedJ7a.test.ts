/**
 * J7.a (PO and Sam, 2026-11-19): the blocked-microphone journey, narrowed to the denial. The browser denies the microphone,
 * the app explains the block, capture never starts, no take is saved for the test account, and the app never tries to
 * unblock the microphone. Recovery on the same page is not exercised, so it is recorded as UNTESTED and never as a pass.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    MIC_DENIED_RECOVERY_ROWS, NO_TAKE_SAVED_ROW, SAME_PAGE_RECOVERY, SAME_PAGE_RECOVERY_REASON, noTakeSavedAfterDenialVerdict,
} from '../live/helpers/rwtAdverse';
import {
    ADVERSE_MIC_DENIED_SUITE, finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, samePageRecoveryErrors,
    validateReceipt, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

describe('J7.a: no take is saved for the test account after the blocked Start', () => {
    const uid = 'u-test';
    const base = { deniedAtAcquisition: true, uid, baseline: ['a', 'b'] as readonly string[] };
    const read = (...ids: string[]) => ({ uid, ids });

    it('passes only when both reads of that account show no new session row', () => {
        expect(noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a', 'b'), read('a', 'b')] }).status).toBe('PASS');
        // A row removed is not a take saved.
        expect(noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a'), read('a')] }).status).toBe('PASS');
    });
    it('fails when a new row appears, including one that only shows in the settled read', () => {
        expect(noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a', 'b', 'c'), read('a', 'b', 'c')] }).status).toBe('FAIL');
        const late = noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a', 'b'), read('a', 'b', 'late')] });
        expect(late).toMatchObject({ status: 'FAIL' });
        expect(late.detail).toContain('1 new session row');
    });
    it('holds (never passes) when the case was not exercised or the account was not read properly', () => {
        expect(noTakeSavedAfterDenialVerdict({ ...base, deniedAtAcquisition: false, reads: [read('a', 'b'), read('a', 'b')] }).status).toBe('HOLD');
        expect(noTakeSavedAfterDenialVerdict({ ...base, baseline: null, reads: [read('a', 'b'), read('a', 'b')] }).status).toBe('HOLD');
        expect(noTakeSavedAfterDenialVerdict({ ...base, uid: '', reads: [read('a', 'b'), read('a', 'b')] }).status).toBe('HOLD');
        expect(noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a', 'b')] }).status).toBe('HOLD');
        expect(noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a', 'b'), null] }).status).toBe('HOLD');
        expect(noTakeSavedAfterDenialVerdict({ ...base, reads: [read('a', 'b'), { uid: 'someone-else', ids: ['a', 'b'] }] }).status).toBe('HOLD');
    });
});

describe('J7.a: the journey checks exactly the agreed scope', () => {
    const journey = src('tests/live/helpers/rwtAdverseJourney.ts');
    const from = journey.indexOf("if (variant === 'mic-denied') {");
    const branch = journey.slice(from, journey.indexOf('} else {', from));

    it('reads the account twice, with the settle wait between, after the blocked copy and while recording is still forbidden', () => {
        expect(from).toBeGreaterThan(0);
        const copyRow = branch.indexOf("receipt.row('blocked microphone is stated truthfully'");
        const firstRead = branch.indexOf('const reads = [await readAccountSessions(owner.uid)];');
        const settle = branch.indexOf('await page.waitForTimeout(NO_TAKE_SETTLE_MS);');
        const secondRead = branch.indexOf('reads.push(await readAccountSessions(owner.uid));');
        const verdict = branch.indexOf('noTakeSavedAfterDenialVerdict({ deniedAtAcquisition, uid: owner.uid, baseline: accountRows.baseline, reads })');
        const row = branch.indexOf('receipt.row(NO_TAKE_SAVED_ROW, noTake.status, noTake.detail,');
        const unforbid = branch.indexOf('watch.setForbidRecording(false);');
        expect([copyRow, firstRead, settle, secondRead, verdict, row, unforbid].every((i) => i > 0)).toBe(true);
        expect(copyRow < firstRead && firstRead < settle && settle < secondRead && secondRead < verdict && verdict < row && row < unforbid).toBe(true);
        expect(branch.indexOf('watch.setForbidRecording(true);')).toBeLessThan(copyRow);
        expect(journey).toMatch(/const NO_TAKE_SETTLE_MS = \d[\d_]*;/);
    });
    it('never allows the microphone, presses nothing after the denied press, and records same-page recovery as UNTESTED', () => {
        expect(branch).not.toMatch(/chromium\.launch|grantPermissions\(|signInOn\(|allowedPage|saveRecoveredTake|\.click\(\)[\s\S]*\.click\(\)/);
        expect(branch.match(/\.click\(\)/g)).toHaveLength(1);
        expect(journey).toContain("permission: { name: 'microphone' }, setting: 'denied',");
        expect(branch).toContain('receipt.meta.samePageRecovery = SAME_PAGE_RECOVERY;');
        expect(branch).toContain('receipt.meta.samePageRecoveryReason = SAME_PAGE_RECOVERY_REASON;');
        expect(SAME_PAGE_RECOVERY).toBe('UNTESTED');
        expect(SAME_PAGE_RECOVERY_REASON).toMatch(/not exercised/);
    });
    it('answers the #1835 privacy question only for its own disposable account, before any press (Sam, 2026-11-19)', () => {
        const practice = journey.indexOf("await page.goto('/practice');");
        const settle = journey.indexOf('const consent = await settlePracticeConsent({ page, client: admin as unknown as ChoiceClient, ownerId: owner.uid, migrationFiles,');
        const firstPress = journey.indexOf("await openProductsItem(page, 'open-mic');");
        expect([practice, settle, firstPress].every((i) => i > 0)).toBe(true);
        expect(practice < settle && settle < firstPress && settle < from).toBe(true);
        expect(journey).toContain('mode: consentModeFrom(process.env.RWT_PRACTICE_CONSENT) });');
        expect(journey).toContain("receipt.row('practice privacy choice', 'PASS',");
        // The product default is never touched: the journey writes no privacy choice itself; only the prompt, answered on
        // the page as a person would, records one for this account.
        expect(journey).not.toMatch(/practice_privacy_choices'\)\.(insert|update|upsert|delete)/);
    });
    it('budgets one Start press and no coaching request', () => {
        expect(journey).toContain("const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 1, perControl: { 'mic-download': 1, 'mic-start': 1 } };");
        expect(journey).toContain("maximum: variant === 'mic-denied' ? 0 : 1");
    });
});

describe('J7.a: acceptance requires the no-take row and UNTESTED recovery, and refuses recovery rows', () => {
    const SHA = 'd'.repeat(40);
    const canonical = (o: { drop?: string; fail?: string; extra?: ReceiptRow[]; meta?: Record<string, unknown> } = {}) => {
        const inv = requiredAutomatedRows(ADVERSE_MIC_DENIED_SUITE)!;
        const rows: ReceiptRow[] = [...inv.required, ...inv.product]
            .filter((step) => step !== o.drop)
            .map((step): ReceiptRow => (step === 'signup-stage telemetry received' || step === 'journey telemetry received'
                ? { step, verdict: 'HOLD', detail: 'pending' }
                : { step, verdict: step === o.fail ? 'FAIL' : 'PASS', detail: 'ok' }));
        rows.push(...(o.extra ?? []));
        return {
            suite: ADVERSE_MIC_DENIED_SUITE, release: SHA,
            meta: o.meta ?? { fixtureKind: 'synthetic', runScope: 'full-gate', samePageRecovery: SAME_PAGE_RECOVERY },
            rows, readback: { journeys: [], reportedJourneyIds: [], missingBindings: [] },
        };
    };
    const finalize = (r: ReturnType<typeof canonical>) =>
        finalizeReceipt(r, parseHumanWorksheet(humanWorksheet(r.suite, SHA, [], r.rows)), undefined);

    it('the suite requires the no-take row and lists both recovery rows as absent', () => {
        const inv = requiredAutomatedRows(ADVERSE_MIC_DENIED_SUITE)!;
        expect(inv.product).toContain(NO_TAKE_SAVED_ROW);
        expect(inv.product).toContain('blocked microphone is stated truthfully');
        for (const row of MIC_DENIED_RECOVERY_ROWS) {
            expect(inv.absent).toContain(row);
            expect(inv.product).not.toContain(row);
        }
    });
    it('a complete receipt with UNTESTED recovery finalizes PASS', () => {
        expect(finalize(canonical())).toMatchObject({ status: 'final', finalAcceptance: 'PASS' });
    });
    it('a missing or failed no-take row does not pass', () => {
        expect(finalize(canonical({ drop: NO_TAKE_SAVED_ROW })).status).toBe('binding_error');
        expect(finalize(canonical({ fail: NO_TAKE_SAVED_ROW }))).toMatchObject({ status: 'final', finalAcceptance: 'FAIL' });
    });
    it('same-page recovery must be recorded as UNTESTED, and a recovery row is refused', () => {
        expect(samePageRecoveryErrors({ suite: ADVERSE_MIC_DENIED_SUITE, meta: { samePageRecovery: SAME_PAGE_RECOVERY } })).toEqual([]);
        expect(samePageRecoveryErrors({ suite: ADVERSE_MIC_DENIED_SUITE, meta: {} })).toHaveLength(1);
        expect(samePageRecoveryErrors({ suite: ADVERSE_MIC_DENIED_SUITE, meta: { samePageRecovery: 'PASS' } })).toHaveLength(1);
        expect(samePageRecoveryErrors({ suite: 'some-other-suite', meta: {} })).toEqual([]);
        expect(validateReceipt(canonical({ meta: { fixtureKind: 'synthetic', runScope: 'full-gate' } })).errors.join('\n')).toContain('UNTESTED');
        expect(finalize(canonical({ meta: { fixtureKind: 'synthetic', runScope: 'full-gate', samePageRecovery: 'PASS' } })))
            .toMatchObject({ status: 'binding_error', finalAcceptance: 'INCOMPLETE' });
        const withRecovery = canonical({ extra: [{ step: MIC_DENIED_RECOVERY_ROWS[0], verdict: 'PASS', detail: 'ok' }] });
        expect(finalize(withRecovery)).toMatchObject({ status: 'binding_error', finalAcceptance: 'INCOMPLETE' });
    });
});
