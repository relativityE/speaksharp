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
import type { Page } from '@playwright/test';
import {
    ADVERSE_RECOVERY_CONSENT_MODE, CONSENT_MODES, MIC_DENIED_CONSENT_MODE, PRACTICE_PRIVACY_PROMPT, PRIVACY_MIGRATION_1835, adverseConsentMode,
    captureConsentGate, settleFixedConsentOnPractice, type ChoiceClient, type ConsentMode,
} from '../live/helpers/rwtPracticeConsent';
import {
    ADVERSE_DOWNLOAD_FAILS_SUITE, ADVERSE_MIC_DENIED_SUITE, ADVERSE_OFFLINE_SUITE, automatedEvaluation, finalizeReceipt, receiptAcceptance, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, samePageRecoveryErrors,
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
        expect(branch).not.toMatch(/chromium\.launch|grantPermissions\(|signInOn\(|allowedPage|saveRecoveredTake|\.click\(/);
        // The one press: the denied press, through pressCaptureControl (#1835, Sam #1916: consent read back at its click).
        expect(branch.match(/pressCaptureControl\(/g)).toHaveLength(1);
        expect(branch).toContain("await pressCaptureControl(page, ['mic-download', 'mic-start'], { beforeClick: () => gate.confirm() });");
        expect(journey).toContain("permission: { name: 'microphone' }, setting: 'denied',");
        expect(branch).toContain('receipt.meta.samePageRecovery = SAME_PAGE_RECOVERY;');
        expect(branch).toContain('receipt.meta.samePageRecoveryReason = SAME_PAGE_RECOVERY_REASON;');
        expect(SAME_PAGE_RECOVERY).toBe('UNTESTED');
        expect(SAME_PAGE_RECOVERY_REASON).toMatch(/not exercised/);
    });
    it('answers the #1835 privacy question only for its own disposable account, on Practice, before any press (Sam, 2026-11-19)', () => {
        const practice = journey.indexOf("await page.goto('/practice');");
        const settle = journey.indexOf('const consent = await settleFixedConsentOnPractice({ page, client, ownerId: owner.uid, migrationFiles, mode: consentMode, record });');
        const firstPress = journey.indexOf("await openProductsItem(page, 'open-mic');");
        expect([practice, settle, firstPress].every((i) => i > 0)).toBe(true);
        expect(practice < settle && settle < firstPress && settle < from).toBe(true);
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

/**
 * #1835 (PO, Nov 20: "Yes, fix J7"; Sam, Nov 20): J7.a, J7.b and J7.c record 'practice privacy choice' as PASS only after this
 * run's own account made the variant's fixed choice and it was read back from the server immediately before the first
 * Start-control press. A pre-#1835 build, an unknown build, or a choice that is missing, different or unreadable stops the
 * journey before any press (the gap Sam found in #1911: the old code recorded PASS on a pre-#1835 build with nothing to read).
 * J7.a tests denial only, so it does not opt in to saving (Save No). J7.b/c judge a recovered take by its saved transcript,
 * so they need Save Yes and refuse Save No before recording.
 */
describe('J7.a/b/c: no Start-control press without the variant\'s verified saved privacy choice (#1835)', () => {
    const journey = src('tests/live/helpers/rwtAdverseJourney.ts');
    const CONSENT = 'practice privacy choice';
    const START_CLICK = /await pressCaptureControl\(page, \[(?:'mic-(?:download|retry|start)'(?:, )?)+\], \{ beforeClick: \(\) => gate\.confirm\(\) \}\);/;
    const lines = journey.split('\n');

    it('fixed modes, never read from the environment: J7.a Save No; J7.b/c Save Yes, Coaching No', () => {
        expect(MIC_DENIED_CONSENT_MODE).toBe('save_off');
        expect(ADVERSE_RECOVERY_CONSENT_MODE).toBe('save_on');
        expect(adverseConsentMode('mic-denied')).toBe('save_off');
        expect(adverseConsentMode('download-fails')).toBe('save_on');
        expect(adverseConsentMode('offline-mid-download')).toBe('save_on');
        // Any other variant needs saving (the stricter mode), so a new recovery case can never inherit Save No.
        expect(adverseConsentMode('something-new')).toBe('save_on');
        expect(CONSENT_MODES[ADVERSE_RECOVERY_CONSENT_MODE]).toEqual({ transcriptSave: true, aiCoaching: false });
        expect(CONSENT_MODES[MIC_DENIED_CONSENT_MODE]).toEqual({ transcriptSave: false, aiCoaching: false });
        expect(journey).not.toMatch(/consentModeFrom|RWT_PRACTICE_CONSENT/);
        expect(journey).toContain('const consentMode = adverseConsentMode(variant);');
    });
    it('#1910\'s shared helpers settle the prompt and gate every press; the journey never writes a PASS row itself', () => {
        expect(journey).toContain('const gate = captureConsentGate({ consent, client, ownerId: owner.uid, mode: consentMode, record });');
        expect(journey).toContain("const record: ConsentRowRecorder = (status, detail, evidence) => receipt.row('practice privacy choice', status, detail, evidence);");
        expect(journey).not.toMatch(/receipt\.row\('practice privacy choice', 'PASS'/);
        expect(journey).not.toMatch(/settlePracticeConsent\(/);
        expect(journey.indexOf('const gate = captureConsentGate(')).toBeLessThan(journey.indexOf("await openProductsItem(page, 'open-mic');"));
    });
    it('every Start-control press (all five) reads consent back INSIDE the press, at its click (Sam, #1916)', () => {
        const presses = lines.flatMap((l, i) => (START_CLICK.test(l) ? [i] : []));
        expect(presses).toHaveLength(5);
        // No readback runs as a statement before a press, and no capture control is clicked through a locator.
        expect(lines.filter((l) => l.trim() === 'await gate.confirm();')).toHaveLength(0);
        expect(journey.match(/beforeClick: \(\) => gate\.confirm\(\)/g)).toHaveLength(5);
        expect(journey).not.toMatch(/getByTestId\('mic-(?:download|retry|start)'\)\.click\(|await (?:control|start)\.click\(/);
        expect(journey.match(/pressCaptureControl\(/g)).toHaveLength(5);
    });
    it('the first press of each variant records the row right after it; the recovery presses only confirm', () => {
        const recordPasses = lines.flatMap((l, i) => (l.trim() === 'gate.recordPass();' ? [i] : []));
        expect(recordPasses).toHaveLength(3);
        for (const i of recordPasses) {
            expect(lines[i - 1]).toMatch(START_CLICK);
            expect(lines[i - 1]).not.toContain("'mic-retry'");
        }
        const fn = (name: string) => journey.slice(journey.indexOf(`async function ${name}(`), journey.indexOf('\n}\n', journey.indexOf(`async function ${name}(`)));
        expect(fn('pressRecovery')).not.toContain('recordPass');
        expect(fn('pressRecovery')).toContain('gate: CaptureConsentGate');
        expect(journey).toContain("saveRecoveredTake(page, variant, failure.status === 'PASS', accountRows, `adverse-${variant}`, takes, gate);");
    });

    // Caller-level controls: the journey's order offline, with its own helpers and each variant's fixed mode. A press happens only
    // after the confirm before it passed, as in the journey. J7.b/c add Retry and Start, each confirmed first.
    const OWNER = 'owner-7';
    const SAVE_ON = { user_id: OWNER, transcript_save: true, ai_coaching: false, consent_version: 1 };
    const SAVE_OFF = { ...SAVE_ON, transcript_save: false };
    type Table = { rows: Array<Record<string, unknown>> };
    function client(table: Table | 'absent', broken: () => boolean = () => false): ChoiceClient {
        const fail = (code: string) => ({ data: null, error: { code } });
        return {
            from: () => ({
                select: () => ({
                    eq: (_col: string, v: string) => ({
                        maybeSingle: async () => table === 'absent' ? fail('PGRST205') : broken() ? fail('57014')
                            : { data: table.rows.find((r) => r.user_id === v) ?? null, error: null },
                    }),
                    limit: async () => table === 'absent' ? fail('42P01') : { data: [], error: null },
                }),
            }),
        };
    }
    /** The #1835 prompt as the product renders it: "Don't save" makes both AI options unavailable and shows the reason. */
    function prompt(onContinue: (save: boolean | null, ai: boolean | null) => void) {
        const state = { save: null as boolean | null, ai: null as boolean | null, open: true };
        const clicks: string[] = [];
        const P = PRACTICE_PRIVACY_PROMPT;
        const isAi = (id: string) => id === P.aiYes || id === P.aiNo;
        const control = (id: string) => ({
            click: async () => {
                if (isAi(id) && state.save === false) throw new Error('element is not enabled');
                clicks.push(id);
                if (id === P.saveYes || id === P.saveNo) { state.save = id === P.saveYes; if (!state.save) state.ai = null; }
                if (isAi(id)) state.ai = id === P.aiYes;
                if (id === P.continue) { state.open = false; onContinue(state.save, state.save === false ? false : state.ai); }
            },
            getAttribute: async (name: string) => {
                if (name === 'aria-disabled') return isAi(id) && state.save === false ? 'true' : null;
                if (name !== 'aria-checked') return null;
                if (isAi(id)) return String(state.ai !== null && state.ai === (id === P.aiYes));
                return String(state.save !== null && state.save === (id === P.saveYes));
            },
            isVisible: async () => (id === P.aiNeedsSave ? state.save === false : true),
        });
        const root = { waitFor: async (o?: { state?: string }) => { if (o?.state === 'hidden' && state.open) throw new Error('Timeout'); }, getByTestId: control };
        return { page: { getByTestId: (id: string) => (id === P.root ? root : control(id)) } as unknown as Page, clicks };
    }
    type Row = { status: string; evidence: Record<string, string> };
    async function run(variant: 'mic-denied' | 'download-fails' | 'offline-mid-download', opts: {
        files?: readonly string[] | null; absent?: boolean; onContinue?: (t: Table, save: boolean | null, ai: boolean | null) => void;
        beforeFirst?: (t: Table) => void; beforeRecovery?: { at: 0 | 1; change: (t: Table) => void }; broken?: () => boolean;
    } = {}) {
        const mode: ConsentMode = adverseConsentMode(variant);
        const table: Table = { rows: [] };
        const record_ = (t: Table, save: boolean | null, ai: boolean | null) =>
            t.rows.push({ user_id: OWNER, transcript_save: save, ai_coaching: ai, consent_version: 1 });
        const { page, clicks } = prompt((save, ai) => (opts.onContinue ?? record_)(table, save, ai));
        const rows: Row[] = [];
        const record = (status: 'PASS' | 'FAIL' | 'HOLD', _detail: string, evidence: Record<string, string>) => rows.push({ status, evidence });
        const c = opts.absent ? client('absent') : client(table, opts.broken);
        const presses: string[] = [];
        const outcome = await (async () => {
            const consent = await settleFixedConsentOnPractice({ page, client: c, ownerId: OWNER,
                migrationFiles: opts.files === undefined ? ['a.sql', PRIVACY_MIGRATION_1835] : opts.files, mode, record });
            const gate = captureConsentGate({ consent, client: c, ownerId: OWNER, mode, record });
            opts.beforeFirst?.(table);
            await gate.confirm();
            presses.push('first'); // J7.a's denied press, or J7.b/c's Download & start
            gate.recordPass();
            if (variant !== 'mic-denied') {
                for (const [i, name] of (['mic-retry', 'mic-start'] as const).entries()) {
                    if (opts.beforeRecovery?.at === i) opts.beforeRecovery.change(table);
                    await gate.confirm();
                    presses.push(name);
                }
            }
            return 'all presses';
        })().catch((e: Error) => e.message);
        return { outcome, presses, rows, clicks, table };
    }
    const P = PRACTICE_PRIVACY_PROMPT;
    const RECOVERY = ['download-fails', 'offline-mid-download'] as const;

    it('J7.a PASS with Save No: the prompt is answered Don\'t save, no AI option is pressed, and the denied press goes ahead', async () => {
        const r = await run('mic-denied');
        expect(r.outcome).toBe('all presses');
        expect(r.presses).toEqual(['first']);
        expect(r.clicks).toEqual([P.saveNo, P.continue]);
        expect(r.table.rows).toEqual([SAVE_OFF]);
        expect(r.rows).toEqual([{ status: 'PASS', evidence: { reason: 'choice_recorded', build: 'includes_1835', mode: 'save_off' } }]);
    });
    it('J7.b/c PASS with Save Yes, Coaching No: the row is PASS exactly once, through Retry and Start', async () => {
        for (const variant of RECOVERY) {
            const r = await run(variant);
            expect(r.outcome).toBe('all presses');
            expect(r.presses).toEqual(['first', 'mic-retry', 'mic-start']);
            expect(r.clicks).toEqual([P.saveYes, P.aiNo, P.continue]);
            expect(r.table.rows).toEqual([SAVE_ON]);
            expect(r.rows).toEqual([{ status: 'PASS', evidence: { reason: 'choice_recorded', build: 'includes_1835', mode: 'save_on' } }]);
        }
    });
    it('J7.b/c refuse Save No before recording: recorded at the prompt, before the first press, or before Retry/Start', async () => {
        for (const variant of RECOVERY) {
            const atPrompt = await run(variant, { onContinue: (t) => t.rows.push({ ...SAVE_OFF }) });
            expect(atPrompt.presses).toEqual([]);
            expect(atPrompt.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'choice_differs', mode: 'save_on' } }]);
            const beforeFirst = await run(variant, { beforeFirst: (t) => { t.rows[0] = { ...SAVE_OFF }; } });
            expect(beforeFirst.presses).toEqual([]);
            expect(beforeFirst.outcome).toBe('HOLD practice consent: readback_differs');
            expect(beforeFirst.rows).toEqual([expect.objectContaining({ status: 'FAIL', evidence: expect.objectContaining({ reason: 'readback_differs' }) })]);
            const beforeStart = await run(variant, { beforeRecovery: { at: 1, change: (t) => { t.rows[0] = { ...SAVE_OFF }; } } });
            expect(beforeStart.outcome).toBe('HOLD practice consent: readback_differs');
            expect(beforeStart.presses).toEqual(['first', 'mic-retry']); // the recording Start never happens
        }
    });
    it('J7.a is fixed to Save No: a Save Yes recorded for its account is not its choice and stops before the denied press', async () => {
        const r = await run('mic-denied', { onContinue: (t) => t.rows.push({ ...SAVE_ON }) });
        expect(r.presses).toEqual([]);
        expect(r.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'choice_differs', mode: 'save_off' } }]);
    });
    for (const variant of ['mic-denied', ...RECOVERY] as const) {
        const mode = adverseConsentMode(variant);
        it(`${variant} NEGATIVE (the gap): a pre-#1835 build, with no saved choice to read, records FAIL and presses nothing`, async () => {
            const r = await run(variant, { files: ['a.sql'], absent: true });
            expect(r.presses).toEqual([]);
            expect(r.outcome).toBe('HOLD practice consent: legacy_build');
            expect(r.clicks).toEqual([]);
            expect(r.rows).toEqual([{ status: 'FAIL', evidence: { reason: 'legacy_build', build: 'predates_1835', mode } }]);
        });
        it(`${variant} NEGATIVE: an unknown build or a prompt that saved no choice stops on Practice with HOLD`, async () => {
            const unknown = await run(variant, { files: null });
            expect(unknown.presses).toEqual([]);
            expect(unknown.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'build_unknown', mode } }]);
            const missing = await run(variant, { onContinue: () => undefined });
            expect(missing.presses).toEqual([]);
            expect(missing.outcome).toBe('HOLD practice consent: choice_missing');
            expect(missing.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'choice_missing', mode } }]);
        });
        it(`${variant} NEGATIVE: a saved choice removed or unreadable before the first press stops it`, async () => {
            const removed = await run(variant, { beforeFirst: (t) => { t.rows.length = 0; } });
            expect(removed.presses).toEqual([]);
            expect(removed.rows).toEqual([expect.objectContaining({ status: 'FAIL', evidence: expect.objectContaining({ reason: 'readback_missing' }) })]);
            let reads = 0;
            const unreadable = await run(variant, { broken: () => ++reads > 2 }); // settling reads twice; the first confirm cannot read
            expect(unreadable.presses).toEqual([]);
            expect(unreadable.rows).toEqual([expect.objectContaining({ status: 'HOLD', evidence: expect.objectContaining({ reason: 'readback_unreadable' }) })]);
        });
    }
    it('J7.b/c NEGATIVE: a saved choice removed before Retry stops it; the first press\'s row stays its own PASS', async () => {
        for (const variant of RECOVERY) {
            const r = await run(variant, { beforeRecovery: { at: 0, change: (t) => { t.rows.length = 0; } } });
            expect(r.outcome).toBe('HOLD practice consent: readback_missing');
            expect(r.presses).toEqual(['first']);
            expect(r.rows).toEqual([expect.objectContaining({ status: 'PASS' })]);
        }
    });

    for (const suite of [ADVERSE_MIC_DENIED_SUITE, ADVERSE_DOWNLOAD_FAILS_SUITE, ADVERSE_OFFLINE_SUITE]) {
        const inventory = requiredAutomatedRows(suite)!;
        const meta = suite === ADVERSE_MIC_DENIED_SUITE ? { samePageRecovery: SAME_PAGE_RECOVERY } : {};
        const rows: ReceiptRow[] = [...inventory.required, ...inventory.product].map((step) => ({ step, verdict: 'PASS', detail: 'fixture' }));
        const receipt = { suite, release: 'e'.repeat(40), meta, rows, readback: { journeys: [], reportedJourneyIds: [] } };
        it(`${suite}: the privacy choice row is mandatory exactly once`, () => {
            expect(inventory.product.filter((x) => x === CONSENT)).toHaveLength(1);
            const evaluate = (candidate: ReceiptRow[]) => automatedEvaluation({ ...receipt, rows: candidate });
            expect(evaluate(rows).errors).toEqual([]);
            expect(receiptAcceptance(evaluate(rows).rows).acceptance).toBe('PASS');
            expect(evaluate(rows.filter((r) => r.step !== CONSENT)).errors.some((e) => e.includes(CONSENT))).toBe(true);
        });
        it(`${suite}: a HOLD or FAIL privacy choice cannot become PASS`, () => {
            for (const verdict of ['HOLD', 'FAIL'] as const) {
                const evaluated = automatedEvaluation({ ...receipt, rows: rows.map((r) => (r.step === CONSENT ? { ...r, verdict } : r)) });
                expect(evaluated.errors).toEqual([]);
                expect(receiptAcceptance(evaluated.rows).acceptance).toBe(verdict === 'FAIL' ? 'FAIL' : 'INCOMPLETE');
            }
        });
    }
});
