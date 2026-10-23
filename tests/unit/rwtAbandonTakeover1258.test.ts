// @vitest-environment node
/**
 * #1258 R2 (row 16) — the leaving/returning and two-tab live spec's verdicts, each with the failing controls a real run
 * could produce, and the guards that keep the spec, the acceptance map and the product's copy in step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BLOCKED_COPY, CLOUD_STT_REQUEST, DISPLACED_COPY, LEAVE_PROMPT_COPY, SAME_BROWSER_TAB_COPY, STOP_FAILED_ALERT_COPY, type TabState,
    TWO_TAB_SUITE, RECOVERY_NOTICE_COPY, answerLeaveDialog, classifyRecoveryClaim, leavePromptVerdict, leftTakeSavedOnce, leftTakeSavedVerdict, newLeaveDialogs, newRowsSince, nextTakeOnlyItselfVerdict, priorTakeSaved, noCloudVerdict, recoveryNoticeVerdict, releasedVerdict, returnStartVerdict,
    secondTabBlockedVerdict, takeOverRowsVerdict, takeOverVerdict, leaseRefusalWindowVerdict, modelWorkBeforeRefusal, type LeaseRefusalWindow, type ObservationClose, pressPrivateStartForLease,
} from '../live/helpers/rwtAbandonTakeover';
import {
    ABANDON_CLOSE_TAB_SUITE, ABANDON_NAVIGATE_SUITE, finalizeReceipt, humanWorksheet, parseHumanWorksheet, receiptAcceptance,
    requiredAutomatedRows, requiredHumanObservations, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const idle: TabState = { runtimeState: 'READY', recorderVisible: false, liveTracks: 0 };
const live: TabState = { runtimeState: 'RECORDING', recorderVisible: true, liveTracks: 1 };

describe('case 11 first activation waits for the cold/warm decision, never for a cold download', () => {
    afterEach(() => vi.unstubAllGlobals());
    function scheduledPage(states: Array<{ status: string | null; ready?: boolean; control?: string; disabled?: boolean; hidden?: boolean }>) {
        let index = 0;
        const clicks: string[] = [];
        const current = () => states[index];
        const control = () => ({
            disabled: current().disabled === true,
            getAttribute: (name: string) => name === 'aria-disabled' ? String(current().disabled === true) : null,
            getClientRects: () => current().hidden ? [] : [{}],
        });
        vi.stubGlobal('document', {
            documentElement: { getAttribute: (name: string) => name === 'data-model-status' ? current().status
                : name === 'data-stt-ready' ? String(current().ready === true) : null },
            querySelector: (selector: string) => selector === `[data-testid="${current().control}"]` ? control() : null,
        });
        vi.stubGlobal('getComputedStyle', () => ({ visibility: current().hidden ? 'hidden' : 'visible', display: current().hidden ? 'none' : 'block' }));
        const page = {
            evaluate: async (fn: () => unknown) => fn(),
            waitForFunction: vi.fn(async (fn: () => unknown, _arg: unknown, options: { timeout: number }) => {
                expect(options.timeout).toBe(30_000);
                for (; index < states.length; index++) {
                    const value = fn();
                    if (value) return { jsonValue: async () => value, dispose: vi.fn() };
                }
                index = states.length - 1;
                throw new Error('no actionable private control within the bound');
            }),
            getByTestId: (id: string) => ({ click: async () => {
                expect(id).toBe(current().control);
                expect(current().disabled).not.toBe(true);
                clicks.push(id);
            } }),
        };
        // Model readiness cannot happen on a cold device before its consent/Start press. This is the existing
        // waitForPrivateEngineReady predicate; a readiness wait here reproduces the pre-press timeout deterministically.
        const waitReady = vi.fn(async () => {
            index = states.length - 1;
            if (current().status !== 'ready' && !current().ready) throw new Error('cold model cannot become ready before Start');
        });
        return { page: page as never, waitReady, clicks };
    }
    it.each([null, 'idle'])('mode resolves before availability: %s then download-required still presses cold once', async (status) => {
        const s = scheduledPage([{ status, control: 'mic-start' }, { status: 'download-required', control: 'mic-download' }]);
        expect(await pressPrivateStartForLease(s.page, s.waitReady)).toBe(true);
        expect(s.clicks).toEqual(['mic-download']);
        expect(s.waitReady).not.toHaveBeenCalled();
    });
    it('a settled cold control does not wait for engine readiness', async () => {
        const s = scheduledPage([{ status: 'download-required', control: 'mic-download' }]);
        expect(await pressPrivateStartForLease(s.page, s.waitReady)).toBe(true);
        expect(s.clicks).toEqual(['mic-download']); expect(s.waitReady).not.toHaveBeenCalled();
    });
    it('warm readiness still checks the engine then presses Start once', async () => {
        const s = scheduledPage([{ status: 'loading', control: 'mic-start', disabled: true }, { status: 'ready', control: 'mic-start' }]);
        expect(await pressPrivateStartForLease(s.page, s.waitReady)).toBe(false);
        expect(s.clicks).toEqual(['mic-start']);
        expect(s.waitReady).toHaveBeenCalledExactlyOnceWith(s.page, 30_000);
    });
    it.each([
        { status: null, control: 'mic-start' }, { status: 'idle', control: 'mic-start' },
        { status: 'error', control: 'mic-retry' }, { status: 'download-required', control: 'mic-download', disabled: true },
        { status: 'download-required', control: 'mic-download', hidden: true }, { status: 'ready', control: 'mic-start', disabled: true },
    ])('unresolved, failed, hidden or disabled state never starts: %j', async (state) => {
        const s = scheduledPage([state]);
        await expect(pressPrivateStartForLease(s.page, s.waitReady)).rejects.toThrow('no actionable private control within the bound');
        expect(s.clicks).toEqual([]); expect(s.waitReady).not.toHaveBeenCalled();
    });
    it('the live caller supplies both observation windows to the first-press callback before checking refusal', () => {
        const spec = src('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
        const press = spec.indexOf('const coldB = await pressPrivateStartForLease(deviceB, waitForPrivateEngineReady, async () => {');
        expect(press).toBeGreaterThan(-1);
        expect(spec.indexOf('openedB = await deviceB.evaluate(openObservationWindow')).toBeGreaterThan(press);
        expect(press).toBeLessThan(spec.indexOf('const refusalShownB = deviceB.getByText(BLOCKED_COPY)'));
    });
    it('opens observation after delayed availability settles, before the single actual cold press', async () => {
        const s = scheduledPage([{ status: 'idle', control: 'mic-start' }, { status: 'download-required', control: 'mic-download' }]);
        const open = vi.fn(async () => {
            expect(document.documentElement.getAttribute('data-model-status')).toBe('download-required');
            expect(s.clicks).toEqual([]);
        });
        await pressPrivateStartForLease(s.page, s.waitReady, open);
        expect(open).toHaveBeenCalledOnce(); expect(s.clicks).toEqual(['mic-download']);
    });
});

describe('releasedVerdict — leaving ends the recording and the microphone', () => {
    it('nothing records and no track is live → PASS', () => { expect(releasedVerdict(idle, 'after leaving').status).toBe('PASS'); });
    it('a live track, a recorder, or a RECORDING state → FAIL', () => {
        expect(releasedVerdict({ ...idle, liveTracks: 1 }, 'x').detail).toMatch(/microphone track is still live/);
        expect(releasedVerdict({ ...idle, recorderVisible: true }, 'x').status).toBe('FAIL');
        expect(releasedVerdict({ ...idle, runtimeState: 'RECORDING' }, 'x').status).toBe('FAIL');
    });
});

describe('answerLeaveDialog — only the first exact leave confirm is ever accepted (Sam 6218709582)', () => {
    it('the first confirm with the product\'s exact copy → accept, counted once', () => {
        const seen = newLeaveDialogs();
        expect(answerLeaveDialog(seen, { type: 'confirm', message: LEAVE_PROMPT_COPY })).toBe('accept');
        expect(seen).toEqual({ prompts: 1, unexpectedDialogs: 0, stopFailedAlerts: 0 });
    });
    it.each([
        ['a confirm with other copy', { type: 'confirm', message: 'Discard this recording?' }],
        ['a prompt', { type: 'prompt', message: LEAVE_PROMPT_COPY }],
        ['a beforeunload', { type: 'beforeunload', message: '' }],
        ['an unrelated alert', { type: 'alert', message: 'Something else' }],
    ])('%s → dismissed, never accepted, and the verdict FAILs', (_label, d) => {
        const seen = newLeaveDialogs();
        expect(answerLeaveDialog(seen, d)).toBe('dismiss');
        expect(seen.unexpectedDialogs).toBe(1);
        expect(leavePromptVerdict({ ...seen, arrived: true }).status).toBe('FAIL');
    });
    it('a REPEATED exact confirm → dismissed and counted unexpected; the verdict FAILs even though the page arrived', () => {
        const seen = newLeaveDialogs();
        answerLeaveDialog(seen, { type: 'confirm', message: LEAVE_PROMPT_COPY });
        expect(answerLeaveDialog(seen, { type: 'confirm', message: LEAVE_PROMPT_COPY })).toBe('dismiss');
        expect(seen).toEqual({ prompts: 1, unexpectedDialogs: 1, stopFailedAlerts: 0 });
        expect(leavePromptVerdict({ ...seen, arrived: true }).status).toBe('FAIL');
    });
    it('the guard\'s stop-failure alert → dismissed and counted as a stop failure; the verdict FAILs', () => {
        const seen = newLeaveDialogs();
        answerLeaveDialog(seen, { type: 'confirm', message: LEAVE_PROMPT_COPY });
        expect(answerLeaveDialog(seen, { type: 'alert', message: STOP_FAILED_ALERT_COPY })).toBe('dismiss');
        expect(seen.stopFailedAlerts).toBe(1);
        const v = leavePromptVerdict({ ...seen, arrived: true });
        expect(v.status).toBe('FAIL');
        expect(v.detail).toMatch(/could not stop/);
    });
});

describe('leavePromptVerdict — navigate away answers the product\'s own leave prompt (#1258 run 38876623812)', () => {
    const asked = { prompts: 1, unexpectedDialogs: 0, stopFailedAlerts: 0, arrived: true };
    it('asked once in the product\'s words, nothing else, and the page arrived → PASS', () => {
        expect(leavePromptVerdict(asked).status).toBe('PASS');
    });
    it('no prompt, an unexpected dialog, a stop failure, or no arrival → FAIL status', () => {
        for (const o of [{ ...asked, prompts: 0 }, { ...asked, unexpectedDialogs: 1 }, { ...asked, stopFailedAlerts: 1 }, { ...asked, arrived: false }]) {
            expect({ o, status: leavePromptVerdict(o).status }).toEqual({ o, status: 'FAIL' });
        }
        expect(leavePromptVerdict({ ...asked, prompts: 0 }).detail).toMatch(/did not ask/);
        expect(leavePromptVerdict({ ...asked, arrived: false }).detail).toMatch(/did not reach/);
    });
});

describe('leftTakeSavedVerdict — navigate away\'s Leave must leave a saved row (Codex P1 r4296551953, Sam 6219377681)', () => {
    const baseline = [{ id: 'old', status: 'completed' }];
    const saved = (rows: { id: string; status: string | null }[]) => leftTakeSavedVerdict(leftTakeSavedOnce(baseline, rows));
    it('the left take holds a new completed row → PASS', () => {
        expect(saved([...baseline, { id: 'left', status: 'completed' }]).status).toBe('PASS');
    });
    it.each([
        ['absent', [...baseline]],
        ['still active', [...baseline, { id: 'left', status: 'active' }]],
        ['failed', [...baseline, { id: 'left', status: 'failed' }]],
        // Codex P1 r4297070691: a duplicate save is not "saved once", and neither is a second new row in any state.
        ['DUPLICATED (two completed)', [...baseline, { id: 'left', status: 'completed' }, { id: 'dup', status: 'completed' }]],
        ['completed plus a stray active', [...baseline, { id: 'left', status: 'completed' }, { id: 'stray', status: 'active' }]],
        ['completed plus a failed', [...baseline, { id: 'left', status: 'completed' }, { id: 'stray', status: 'failed' }]],
        ['only active and failed', [...baseline, { id: 'a', status: 'active' }, { id: 'f', status: 'failed' }]],
    ])('a prior row that is %s → FAIL', (_label, rows) => {
        expect(saved(rows).status).toBe('FAIL');
    });
    it('arrived + no notice + no saved row still FAILs: arrival and silence are not persistence', () => {
        const leave = leavePromptVerdict({ prompts: 1, unexpectedDialogs: 0, stopFailedAlerts: 0, arrived: true });
        const noNotice = recoveryNoticeVerdict({ shown: false, state: null, claimsSavedTranscript: false, claimsUnsavedTranscript: false, priorTakeSaved: false });
        const kept = saved(baseline);
        expect([leave.status, noNotice.status, kept.status]).toEqual(['PASS', 'PASS', 'FAIL']);
        const rows: ReceiptRow[] = [
            { step: 'leave prompt answered Leave', verdict: leave.status, detail: leave.detail },
            { step: 'recovery notice is truthful', verdict: noNotice.status, detail: noNotice.detail },
            { step: 'leaving saved the left take', verdict: kept.status, detail: kept.detail },
        ];
        expect(receiptAcceptance(rows).acceptance).toBe('FAIL');
    });
});

describe('persistence vs idempotency — grouped controls (Codex P1 r4297070691, Sam 6220514829)', () => {
    const baseline = [{ id: 'old', status: 'completed' }];
    const cases = {
        'one completed': { rows: [{ id: 'l', status: 'completed' }], anySaved: true, once: true },
        'two completed': { rows: [{ id: 'l', status: 'completed' }, { id: 'd', status: 'completed' }], anySaved: true, once: false },
        'mixed completed + active': { rows: [{ id: 'l', status: 'completed' }, { id: 'a', status: 'active' }], anySaved: true, once: false },
        'zero': { rows: [], anySaved: false, once: false },
        'only failed': { rows: [{ id: 'f', status: 'failed' }], anySaved: false, once: false },
    } as const;
    it.each(Object.entries(cases))('%s → persistence and the saved-once gate as expected', (_label, c) => {
        const atReturn = [...baseline, ...c.rows];
        expect(priorTakeSaved(baseline, atReturn)).toBe(c.anySaved);
        expect(leftTakeSavedVerdict(leftTakeSavedOnce(baseline, atReturn)).status).toBe(c.once ? 'PASS' : 'FAIL');
    });
    it('notice truth follows persistence, not idempotency: a truthful "saved" notice PASSes with two completed rows; a false one FAILs', () => {
        const two = [...baseline, ...cases['two completed'].rows];
        const saved = { shown: true, state: 'finalized_pending_save', claimsSavedTranscript: true, claimsUnsavedTranscript: false };
        expect(recoveryNoticeVerdict({ ...saved, priorTakeSaved: priorTakeSaved(baseline, two) }).status, 'truthful saved').toBe('PASS');
        const unsaved = { shown: true, state: 'active_interrupted', ...classifyRecoveryClaim(RECOVERY_NOTICE_COPY.interrupted) };
        expect(recoveryNoticeVerdict({ ...unsaved, priorTakeSaved: priorTakeSaved(baseline, two) }).status, 'false unsaved').toBe('FAIL');
        expect(recoveryNoticeVerdict({ ...saved, priorTakeSaved: priorTakeSaved(baseline, baseline) }).status, 'false saved').toBe('FAIL');
    });
    it('the SCENARIO fails on a duplicate even after a successful arrival and no recovery notice', () => {
        const two = [...baseline, ...cases['two completed'].rows];
        const leave = leavePromptVerdict({ prompts: 1, unexpectedDialogs: 0, stopFailedAlerts: 0, arrived: true });
        const noNotice = recoveryNoticeVerdict({ shown: false, state: null, claimsSavedTranscript: false, claimsUnsavedTranscript: false, priorTakeSaved: priorTakeSaved(baseline, two) });
        const kept = leftTakeSavedVerdict(leftTakeSavedOnce(baseline, two));
        expect([leave.status, noNotice.status, kept.status]).toEqual(['PASS', 'PASS', 'FAIL']);
        expect(receiptAcceptance([
            { step: 'leave prompt answered Leave', verdict: leave.status, detail: leave.detail },
            { step: 'recovery notice is truthful', verdict: noNotice.status, detail: noNotice.detail },
            { step: 'leaving saved the left take', verdict: kept.status, detail: kept.detail },
        ]).acceptance).toBe('FAIL');
    });
});

describe('acceptance map — the saved-row requirement is navigate-away only', () => {
    const SHA = 'c'.repeat(40);
    const canonical = (suite: string, drop?: string, fail?: string) => {
        const inv = requiredAutomatedRows(suite)!;
        const rows: ReceiptRow[] = [...inv.required, ...inv.product]
            .filter((step) => step !== drop)
            .map((step): ReceiptRow => (step === 'signup-stage telemetry received' || step === 'journey telemetry received'
                ? { step, verdict: 'HOLD', detail: 'pending' }
                : { step, verdict: step === fail ? 'FAIL' : 'PASS', detail: 'ok' }));
        // No journey readback is qualified for these suites (like pending Start): the receipt carries an empty one.
        return { suite, release: SHA, meta: { fixtureKind: 'synthetic' }, rows, readback: { journeys: [], reportedJourneyIds: [], missingBindings: [] } };
    };
    const finalize = (r: ReturnType<typeof canonical>) =>
        finalizeReceipt(r, parseHumanWorksheet(humanWorksheet(r.suite, SHA, [], r.rows)), undefined);

    it('navigate away requires it; close-tab does not', () => {
        expect(requiredAutomatedRows(ABANDON_NAVIGATE_SUITE)!.product).toContain('leaving saved the left take');
        expect(requiredAutomatedRows(ABANDON_CLOSE_TAB_SUITE)!.product).not.toContain('leaving saved the left take');
        expect(requiredAutomatedRows(ABANDON_CLOSE_TAB_SUITE)!.product).not.toContain('leave prompt answered Leave');
    });
    it('complete receipts finalize PASS for both variants', () => {
        expect(finalize(canonical(ABANDON_NAVIGATE_SUITE))).toMatchObject({ status: 'final', finalAcceptance: 'PASS' });
        expect(finalize(canonical(ABANDON_CLOSE_TAB_SUITE))).toMatchObject({ status: 'final', finalAcceptance: 'PASS' });
    });
    it('navigate away: a MISSING saved-row row never passes; a FAILING one fails the run', () => {
        const missing = finalize(canonical(ABANDON_NAVIGATE_SUITE, 'leaving saved the left take'));
        expect({ status: missing.status, pass: missing.finalAcceptance === 'PASS' }).toEqual({ status: 'binding_error', pass: false });
        expect(finalize(canonical(ABANDON_NAVIGATE_SUITE, undefined, 'leaving saved the left take')).finalAcceptance).toBe('FAIL');
    });
});

describe('returnStartVerdict — Start on return records, or says why and records on the explicit second press', () => {
    it('records at once → PASS; refused truthfully then records → PASS', () => {
        expect(returnStartVerdict({ firstPressRecorded: true, refusalCopyShown: false, secondPressRecorded: null }).status).toBe('PASS');
        expect(returnStartVerdict({ firstPressRecorded: false, refusalCopyShown: true, secondPressRecorded: true }).status).toBe('PASS');
    });
    it('a silent refusal, or a truthful refusal whose take-over never records → FAIL', () => {
        expect(returnStartVerdict({ firstPressRecorded: false, refusalCopyShown: false, secondPressRecorded: null }).detail).toMatch(/no truthful reason/);
        expect(returnStartVerdict({ firstPressRecorded: false, refusalCopyShown: true, secondPressRecorded: false }).status).toBe('FAIL');
    });
});

describe('recoveryNoticeVerdict — the notice tells the truth about the left take, as the server holds it (Sam 6218709582)', () => {
    const notice = { shown: true, state: 'active_interrupted', claimsSavedTranscript: false, claimsUnsavedTranscript: false, priorTakeSaved: false };
    it('no notice, or a known state that claims nothing → PASS', () => {
        expect(recoveryNoticeVerdict({ ...notice, shown: false, state: null }).status).toBe('PASS');
        expect(recoveryNoticeVerdict(notice).status).toBe('PASS');
        expect(recoveryNoticeVerdict({ ...notice, state: 'finalized_pending_save' }).status).toBe('PASS');
    });
    it('TRUTHFUL: saved and says saved → PASS; unsaved and says unsaved → PASS', () => {
        expect(recoveryNoticeVerdict({ ...notice, claimsSavedTranscript: true, priorTakeSaved: true }).status).toBe('PASS');
        expect(recoveryNoticeVerdict({ ...notice, claimsUnsavedTranscript: true, priorTakeSaved: false }).status).toBe('PASS');
    });
    it('FALSELY SAVED: says saved, but the left take was not → FAIL', () => {
        const v = recoveryNoticeVerdict({ ...notice, claimsSavedTranscript: true, priorTakeSaved: false });
        expect(v.status).toBe('FAIL');
        expect(v.detail).toMatch(/claims a transcript was saved/);
    });
    it('FALSELY UNSAVED: says none was saved, but the left take was → FAIL', () => {
        const v = recoveryNoticeVerdict({ ...notice, claimsUnsavedTranscript: true, priorTakeSaved: true });
        expect(v.status).toBe('FAIL');
        expect(v.detail).toMatch(/says no transcript was saved/);
    });
    it('an unknown state → FAIL', () => {
        expect(recoveryNoticeVerdict({ ...notice, state: 'interrupted' }).status).toBe('FAIL');
    });
    it('CLASSIFIER: the interrupted wordings are unsaved claims; the finalized (unconfirmed) wording claims neither (#1474)', () => {
        for (const [state, text] of Object.entries(RECOVERY_NOTICE_COPY)) {
            const unsaved = state !== 'finalized_pending_save';
            expect({ state, claim: classifyRecoveryClaim(text) }).toEqual({ state, claim: { claimsSavedTranscript: false, claimsUnsavedTranscript: unsaved } });
        }
        expect(classifyRecoveryClaim('Your transcript was saved.')).toEqual({ claimsSavedTranscript: true, claimsUnsavedTranscript: false });
        expect(classifyRecoveryClaim('')).toEqual({ claimsSavedTranscript: false, claimsUnsavedTranscript: false });
    });
    it('WIRED (#1474, Sam 1792278508): the actual finalized_pending_save notice is truthful whether the server saved the take (response lost) or not (request lost)', () => {
        const pending = { shown: true, state: 'finalized_pending_save', ...classifyRecoveryClaim(RECOVERY_NOTICE_COPY.finalized_pending_save) };
        expect(recoveryNoticeVerdict({ ...pending, priorTakeSaved: true }).status, 'response-lost: server saved it').toBe('PASS');
        expect(recoveryNoticeVerdict({ ...pending, priorTakeSaved: false }).status, 'request-lost: server holds nothing').toBe('PASS');
        // The OLD definite wording is exactly the false claim a lost response produced, and the oracle still catches it.
        const oldDefinite = classifyRecoveryClaim('Your last session finished but was not saved. Its measurements were kept on this device; no transcript was stored.');
        expect(recoveryNoticeVerdict({ shown: true, state: 'finalized_pending_save', ...oldDefinite, priorTakeSaved: true }).status, 'old copy after a lost response').toBe('FAIL');
        const interrupted = { shown: true, state: 'active_interrupted', ...classifyRecoveryClaim(RECOVERY_NOTICE_COPY.interrupted) };
        expect(recoveryNoticeVerdict({ ...interrupted, priorTakeSaved: true }).status).toBe('FAIL');
        expect(recoveryNoticeVerdict({ ...interrupted, priorTakeSaved: false }).status).toBe('PASS');
    });
    it('priorTakeSaved reads the SERVER: only a new completed row counts; a pre-existing or still-active row does not', () => {
        const baseline = [{ id: 'old', status: 'completed' }];
        expect(priorTakeSaved(baseline, [...baseline, { id: 'left', status: 'completed' }])).toBe(true);
        expect(priorTakeSaved(baseline, baseline), 'only the pre-existing row').toBe(false);
        expect(priorTakeSaved(baseline, [...baseline, { id: 'left', status: 'active' }]), 'left take still active').toBe(false);
        expect(priorTakeSaved([], [])).toBe(false);
        // Persistence (notice truth) is "any completed"; idempotency is "exactly one" — kept distinct (Sam 6220514829).
        const two = [...baseline, { id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }];
        expect(priorTakeSaved(baseline, two), 'a transcript WAS persisted').toBe(true);
        expect(leftTakeSavedOnce(baseline, two), 'but not exactly once').toBe(false);
        expect(newRowsSince(baseline, [...baseline, { id: 'a', status: 'completed' }, { id: 'b', status: 'active' }]).map((r) => r.id)).toEqual(['a', 'b']);
    });
    it('the states it accepts are the recovery draft\'s own', () => {
        const draft = src('frontend/src/services/sessionRecoveryDraft.ts');
        expect(draft).toContain("export type RecoveryState = 'finalized_pending_save' | 'active_interrupted';");
    });
});

describe('nextTakeOnlyItselfVerdict — one new completed row, none left active', () => {
    const before = [{ id: 'abandoned', status: 'active' }];
    it('the abandoned take closed and one new completed row bound by the page → PASS', () => {
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'abandoned', status: 'failed' }, { id: 'next', status: 'completed' }], 'next').status).toBe('PASS');
    });
    it('the abandoned take left active (orphan) → FAIL', () => {
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'abandoned', status: 'active' }, { id: 'next', status: 'completed' }], 'next').detail)
            .toMatch(/still active/);
    });
    it('two new rows, an unbound or different row, or an uncompleted take → FAIL', () => {
        expect(nextTakeOnlyItselfVerdict(before, [...before, { id: 'next', status: 'completed' }, { id: 'extra', status: 'completed' }], 'next').status).toBe('FAIL');
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'next', status: 'completed' }], null).status).toBe('FAIL');
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'other', status: 'completed' }], 'next').status).toBe('FAIL');
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'next', status: 'failed' }], 'next').status).toBe('FAIL');
    });
});

describe('two tabs — refused truthfully, one engine after the take-over, both takes closed', () => {
    it('the refused tab starts nothing while the first keeps recording → PASS; any leak → FAIL', () => {
        expect(secondTabBlockedVerdict({ refusalCopyShown: true, tabB: idle, tabA: live }).status).toBe('PASS');
        expect(secondTabBlockedVerdict({ refusalCopyShown: false, tabB: idle, tabA: live }).status).toBe('FAIL');
        expect(secondTabBlockedVerdict({ refusalCopyShown: true, tabB: { ...idle, liveTracks: 1 }, tabA: live }).status).toBe('FAIL');
        expect(secondTabBlockedVerdict({ refusalCopyShown: true, tabB: idle, tabA: idle }).detail).toMatch(/first tab stopped/);
    });
    it('B records and A stopped and said why → PASS; two engines, none, or a silent stop → FAIL', () => {
        expect(takeOverVerdict({ tabA: idle, tabB: live, displacedCopyShown: true }).status).toBe('PASS');
        expect(takeOverVerdict({ tabA: live, tabB: live, displacedCopyShown: true }).detail).toMatch(/still recording/);
        expect(takeOverVerdict({ tabA: idle, tabB: idle, displacedCopyShown: true }).status).toBe('FAIL');
        expect(takeOverVerdict({ tabA: idle, tabB: live, displacedCopyShown: false }).detail).toMatch(/did not say/);
    });
    it('both takes saved and none active → PASS; an active orphan or an unsaved displaced take → FAIL', () => {
        const done = [{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }];
        expect(takeOverRowsVerdict(done, 'a', 'b').status).toBe('PASS');
        expect(takeOverRowsVerdict([{ id: 'a', status: 'active' }, { id: 'b', status: 'completed' }], 'a', 'b').status).toBe('FAIL');
        expect(takeOverRowsVerdict(done, null, 'b').detail).toMatch(/no saved session was bound/);
        expect(takeOverRowsVerdict([{ id: 'a', status: 'failed' }, { id: 'b', status: 'completed' }], 'a', 'b').status).toBe('FAIL');
    });
    it('one completed row cannot stand in for two distinct takes', () => {
        expect(takeOverRowsVerdict([{ id: 'a', status: 'completed' }], 'a', 'a').status).toBe('FAIL');
    });
    it('any Cloud STT request → FAIL', () => {
        expect(noCloudVerdict(0).status).toBe('PASS');
        expect(noCloudVerdict(1).status).toBe('FAIL');
        expect(CLOUD_STT_REQUEST.test('https://x.supabase.co/functions/v1/assemblyai-token')).toBe(true);
        expect(CLOUD_STT_REQUEST.test('wss://streaming.assemblyai.com/v3/ws')).toBe(true);
    });
});

describe('guards — the spec, the acceptance map and the product copy stay in step', () => {
    const spec = src('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
    const written = `${spec}\n${src('tests/live/helpers/rwtDisposableAccount.ts')}`;

    it('the refusal and take-over copy is the product\'s own', () => {
        const policy = src('frontend/src/services/recordingLeasePolicy.ts');
        expect(policy).toContain(DISPLACED_COPY);
        expect(policy).toContain('Stop it there, or press Start again to take over here');
        expect(src('frontend/src/App.tsx'), 'the leave prompt is the product\'s own').toContain(`'${LEAVE_PROMPT_COPY}'`);
        expect(src('frontend/src/App.tsx'), 'the stop-failure alert is the product\'s own').toContain(`'${STOP_FAILED_ALERT_COPY}'`);
        const page = src('frontend/src/pages/SessionPage.tsx');
        for (const text of Object.values(RECOVERY_NOTICE_COPY)) expect(page, 'each recovery wording is the product\'s own').toContain(`'${text}'`);
        const notice = page.slice(page.indexOf('data-testid="session-recovery-message"'), page.indexOf('</span>', page.indexOf('data-testid="session-recovery-message"')));
        // Every user-facing sentence in the notice (the state token it branches on is not copy).
        expect((notice.match(/'Your [^']+'/g) ?? []).length, 'the notice has exactly these wordings').toBe(Object.keys(RECOVERY_NOTICE_COPY).length);
        expect(BLOCKED_COPY.test('A recording is active on another device. Stop it there, or press Start again to take over here')).toBe(true);
        for (const f of ['frontend/src/hooks/useSessionLifecycle.ts', 'frontend/src/services/SpeechRuntimeController.ts']) {
            const line = /'⛔ (Active session in another tab\.[^']*)'/.exec(src(f))?.[1] ?? '';
            expect({ f, matches: SAME_BROWSER_TAB_COPY.test(line) }).toEqual({ f, matches: true });
        }
    });

    it('every suite is known, fully automated, and requires each row the spec writes plus its own cleanup', () => {
        for (const suite of [ABANDON_NAVIGATE_SUITE, ABANDON_CLOSE_TAB_SUITE, TWO_TAB_SUITE]) {
            expect(requiredHumanObservations({ suite } as never)).toEqual([]);
            const inv = requiredAutomatedRows(suite)!;
            expect(inv.required).toContain('run-owned cleanup');
            expect(inv.absent).toContain('journey telemetry received');
            for (const step of inv.product) {
                expect({ suite, step, written: written.includes(`'${step}'`) || step === 'coaching request budget' }).toEqual({ suite, step, written: true });
            }
        }
        expect(spec).toContain('new RwtReceipt(`${ABANDON_SUITE}-${variant}`)');
        expect(spec).toContain('new RwtReceipt(TWO_TAB_SUITE)');
    });

    it('PM 6207105255: the local tab lock and the server lease are proved separately — another DEVICE is an isolated context on the same account', () => {
        expect(spec).toContain('sameBrowserTab = await tabA.context().newPage();');
        expect(spec).toContain("otherDevice = await browser.newContext({ baseURL, permissions: ['microphone'] });");
        expect(spec).toContain('await owner.signInOn(deviceB);');
        expect(spec).toContain('const refusalShownB = deviceB.getByText(BLOCKED_COPY).first();');
        expect(spec).not.toMatch(/tabB = await tabA\.context\(\)\.newPage\(\)/);
    });

    it('#1593 case 11: on a cold device the first press IS the Start the lease decides — never the download-only setup helper', () => {
        const deviceStart = spec.indexOf('await owner.signInOn(deviceB);');
        const device = spec.slice(deviceStart, spec.indexOf("receipt.row('another device is refused by the account lease'", deviceStart));
        expect(device, 'the first control is selected at the bounded activation boundary').toContain('const coldB = await pressPrivateStartForLease(deviceB, waitForPrivateEngineReady, async () => {');
        expect(device, 'no download-only helper on device B').not.toContain('preparePrivateModelIfPrompted(deviceB');
        // Sam, #1662 RETURN: the first press is refused within a bounded window and BEFORE any model work.
        expect(device).toContain('const refusedInTime = await refusalShownB.waitFor({ timeout: 30_000 })');
        // Sam, #1662 RETURN (item 10) + case-11 window: judged on the model-work HISTORY from before the first press through
        // the whole refused window (leaseRefusalWindowVerdict applies modelWorkBeforeRefusal to it), not a frozen snapshot.
        expect(device).toContain('const refusal = leaseRefusalWindowVerdict({');
        expect(device.indexOf('await deviceB.evaluate(installModelStatusHistory);'), 'history observed before the first press').toBeGreaterThan(-1);
        expect(device.indexOf('await deviceB.evaluate(installModelStatusHistory);')).toBeGreaterThan(device.indexOf('const coldB = await pressPrivateStartForLease(deviceB, waitForPrivateEngineReady, async () => {'));
        expect(spec, 'a refusal after model work is never a PASS: the row is the whole-window verdict').toContain("receipt.row('another device is refused by the account lease', refusal.status, refusal.detail");
        expect(device, 'no 900 s wait for the first refusal').not.toMatch(/refusalShownB\.waitFor\(\{ timeout: coldB \? 900_000/);
        const takeOver = spec.slice(spec.indexOf("// The person's explicit second press is the take-over"));
        expect(takeOver, 'the take-over presses the control the refused page renders').toContain(`await deviceB.locator('[data-testid="mic-start"], [data-testid="mic-download"]').first().click();`);
        expect(takeOver, 'a cold take-over gets the model budget, and a take-over that never records ends the scenario')
            .toContain("if (!(await isRecording(deviceB, coldB ? 900_000 : 60_000))) throw new Error('the explicit take-over press did not start a recording');");
        expect(takeOver.indexOf('watch.setStartRefusedAllowed(false);'), 'the expected refusal is spent before the take-over press')
            .toBeLessThan(takeOver.indexOf("await deviceB.locator('[data-testid=\"mic-start\"], [data-testid=\"mic-download\"]').first().click();"));
    });

    it('#1593 case 9: navigate away closes the Focus Points setup modal before using Products again', () => {
        const navStart = spec.indexOf("if (variant === 'navigate-away')");
        const nav = spec.slice(navStart, spec.indexOf("await openProductsItem(page, 'open-mic')", navStart));
        expect(nav.indexOf("await page.keyboard.press('Escape');"), 'the modal is closed').toBeGreaterThan(nav.indexOf("receipt.row('leaving mid-recording releases the microphone'"));
        expect(nav).toContain("await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0, { timeout: 10_000 });");
    });

    it('nothing is intercepted: the scenarios are the person\'s own actions', () => {
        expect(spec).not.toMatch(/\.route\(|route\.abort|route\.fulfill|setOffline/);
        expect(spec).toContain("await page.close({ runBeforeUnload: true });");
        expect(spec).toContain("if (d.type() === 'beforeunload') { leavePrompt = true; void d.accept(); }");
        // #1258 run 38876623812: navigate away ANSWERS the in-app leave prompt before pressing Products (an unanswered
        // confirm is dismissed, which keeps the person on the recording and timed the journey out).
        const navStart = spec.indexOf("if (variant === 'navigate-away')");
        const nav = spec.slice(navStart, spec.indexOf("await openProductsItem(page, 'open-mic')", navStart));
        expect(nav.indexOf("page.on('dialog', answerLeave)"), 'the prompt is answered').toBeGreaterThan(-1);
        expect(nav.indexOf("page.on('dialog', answerLeave)"), 'before the Products press').toBeLessThan(nav.indexOf("openProductsItem(page, 'focus-points')"));
        expect(nav, 'only the narrow handler decides').toContain('answerLeaveDialog(dialogs, { type: d.type(), message: d.message() })');
        expect(nav, 'the listener is removed in finally').toContain("} finally { page.off('dialog', answerLeave); }");
        expect(nav, 'a failed verdict stops the branch even if the page arrived').toContain("if (asked.status !== 'PASS') return;");
        expect(nav, 'no blanket accept').not.toMatch(/d\.type\(\) === 'confirm'\)[^\n]*accept/);
        expect(spec, 'the notice claim is classified, not matched ad hoc').toContain('...classifyRecoveryClaim(noticeText),');
        // Codex P1 r4296551963 (Sam 6219377681 option a): the OBSERVED persistence judges the notice for both variants.
        expect(spec, 'persistence is read from the server against the pre-take baseline')
            .toContain('const leftTakeSaved = priorTakeSaved(rowsBeforeFirst, rowsAtReturn);');
        expect(spec, 'the gate is the saved-ONCE observation').toContain('const kept = leftTakeSavedVerdict(leftTakeOnce);');
        expect(spec, 'idempotency is read from the same complete new-row set').toContain('const leftTakeOnce = leftTakeSavedOnce(rowsBeforeFirst, rowsAtReturn);');
        expect(spec, 'the row counts are recorded as evidence').toContain('receipt.row(\'leaving saved the left take\', kept.status, kept.detail, { leftTakeOnce, leftTakeSaved, ...leftTakeRowCounts });');
        expect(spec.indexOf('const rowsAtReturn = await readRows(owner.uid);'), 'observed before the next-take baseline').toBeLessThan(spec.indexOf('const rowsBeforeNext = await readRows(owner.uid);'));
        expect(spec, 'the notice is judged against observed persistence').toContain('            priorTakeSaved: leftTakeSaved,');
        expect(spec, 'no forced close-tab value').not.toMatch(/priorTakeSaved: variant/);
        // Codex P1 r4296551953: the saved-row row is navigate-away only, from the same observation, before the next take.
        const saveRow = spec.indexOf("receipt.row('leaving saved the left take'");
        expect(saveRow).toBeGreaterThan(spec.indexOf('const leftTakeSaved = priorTakeSaved('));
        expect(saveRow).toBeLessThan(spec.indexOf('const rowsBeforeNext = await readRows(owner.uid);'));
        expect(spec.slice(spec.indexOf('const leftTakeSaved = priorTakeSaved('), saveRow)).toContain("if (variant === 'navigate-away') {");
    });
});

describe('#1593 case 11 — the lease refusal is judged over its WHOLE window (Sam 13:13 ACCEPT of PM 9fc69b51; RETURN on c8e5d59f)', () => {
    // After the take-over (the windows are read then): A displaced and B recording NOW — the cut portions are what count.
    const recA: ObservationClose = { token: 'w-a', boundary: 'time', boundaryUncertain: false, gestureAt: null, runtimeTransitions: ['RECORDING'], runtimeNow: 'RECORDING', modelTransitions: ['ready'], modelNow: 'ready', micAcquisitionsSinceOpen: 0, tracksStoppedSinceOpen: 0, liveTracksAtOpen: 1, liveTracks: 0, recorderVisible: false };
    const refusedB: ObservationClose = { token: 'w-b', boundary: 'gesture', boundaryUncertain: false, gestureAt: 1_000, runtimeTransitions: ['READY'], runtimeNow: 'READY', modelTransitions: ['download-required'], modelNow: 'download-required', micAcquisitionsSinceOpen: 0, tracksStoppedSinceOpen: 0, liveTracksAtOpen: 0, liveTracks: 1, recorderVisible: true };
    const clean: LeaseRefusalWindow = { observed: true, refusalCopyShown: true, cold: true, modelRequests: 0, a: recA, b: refusedB };
    /** The row as it stood at a81fbb97: endpoint snapshots taken after the refusal, before the hold — both looked clean then. */
    const endpointRow = (w: LeaseRefusalWindow) => (
        modelWorkBeforeRefusal({ cold: w.cold, modelRequests: 0, statusHistory: [], statusAtRefusal: 'download-required' })
            ? 'FAIL' : secondTabBlockedVerdict({ refusalCopyShown: w.refusalCopyShown,
                tabB: { runtimeState: 'READY', recorderVisible: false, liveTracks: 0 },
                tabA: { runtimeState: 'RECORDING', recorderVisible: true, liveTracks: 1 } }).status);

    it('a clean cold refusal with A recording without interruption PASSes', () => {
        expect(leaseRefusalWindowVerdict(clean).status).toBe('PASS');
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, runtimeTransitions: ['RECORDING', 'RECORDING'] } }).status, 'RECORDING re-published is not an interruption').toBe('PASS');
    });

    it('PM counterexample 1: model work DURING the hold FAILs; the endpoint row passed it', () => {
        const w = { ...clean, modelRequests: 1, b: { ...refusedB, modelTransitions: ['download-required', 'loading', 'download-required'] } };
        expect(endpointRow(w), 'the frozen pre-hold snapshot saw nothing').toBe('PASS');
        expect(leaseRefusalWindowVerdict(w)).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('model preparation') });
    });

    it('PM counterexample 2: a transient B microphone acquisition that ended before the endpoint FAILs; the endpoint row passed it', () => {
        const w = { ...clean, b: { ...refusedB, micAcquisitionsSinceOpen: 1 } };
        expect(endpointRow(w)).toBe('PASS');
        expect(leaseRefusalWindowVerdict(w)).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('microphone') });
    });

    it('PM counterexample 3 / c8e5 #1: A stops and resumes (a transition, a stopped track, or a re-acquisition) FAILs; the endpoint row passed it', () => {
        for (const a of [{ ...recA, runtimeTransitions: ['RECORDING', 'STOPPING', 'RECORDING'] }, { ...recA, tracksStoppedSinceOpen: 1 }, { ...recA, micAcquisitionsSinceOpen: 1 }]) {
            const w = { ...clean, a };
            expect(endpointRow(w)).toBe('PASS');
            expect(leaseRefusalWindowVerdict(w)).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('continuously') });
        }
    });

    it('04920bce opening state: A already STOPPING (or trackless) when the window opens, or B already loading / holding a track, FAILs', () => {
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, runtimeTransitions: ['STOPPING', 'RECORDING'] } }).status, 'A was not recording at open').toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, liveTracksAtOpen: 0 } }).status, 'A had no live track at open').toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, runtimeTransitions: [] } }).status, 'no opening state is no continuity').toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, modelTransitions: ['loading', 'download-required'] } }).status, 'B already loading at open').toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, liveTracksAtOpen: 1, liveTracks: 0 } }).status, 'B held a track at open').toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, runtimeTransitions: ['READY', 'RECORDING', 'READY'] } }).status, 'B recorded mid-window').toBe('FAIL');
    });

    it('c8e5 #3: a lost observation is HOLD, never zero activity — a replaced document (no window), a missing counter, or a failed open', () => {
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, token: null } }).status).toBe('HOLD');
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, token: null } }).status).toBe('HOLD');
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, micAcquisitionsSinceOpen: null } }).status).toBe('HOLD');
        expect(leaseRefusalWindowVerdict({ ...clean, observed: false }).status).toBe('HOLD');
    });

    it('retained controls: no refusal copy, B recording before the gesture, model status left non-cold all FAIL', () => {
        expect(leaseRefusalWindowVerdict({ ...clean, refusalCopyShown: false }).status).toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, runtimeTransitions: ['READY', 'RECORDING'] } }).status).toBe('FAIL');
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, modelNow: 'ready' } }).status).toBe('FAIL');
    });

    it('16:15 tail RETURN: the post-gesture take-over (A displaced, B recording NOW) is never the refusal window\'s — it PASSes', () => {
        expect(leaseRefusalWindowVerdict(clean).status).toBe('PASS');
    });

    it('16:15 tail RETURN: no marked gesture, an uncut window, or an A change at the boundary is HOLD', () => {
        expect(leaseRefusalWindowVerdict({ ...clean, b: { ...refusedB, boundary: 'none', gestureAt: null } }).status).toBe('HOLD');
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, boundary: 'none' } }).status).toBe('HOLD');
        expect(leaseRefusalWindowVerdict({ ...clean, a: { ...recA, boundaryUncertain: true } }).status).toBe('HOLD');
    });

    it('the spec opens both windows before the first press and closes them just before the take-over press', () => {
        const spec = readFileSync(path.join(ROOT, 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts'), 'utf8');
        const openA = spec.indexOf('await tabA.evaluate(openObservationWindow');
        const openB = spec.indexOf('await deviceB.evaluate(openObservationWindow');
        const press = spec.indexOf('\n            });', openB); // completion of the awaited first-press helper
        const arm = spec.indexOf('await deviceB.evaluate(armTakeoverGesture');
        // The take-over's own click (the return retry earlier in the file has its own revocation).
        const takeover = spec.indexOf("await deviceB.locator('[data-testid=\"mic-start\"], [data-testid=\"mic-download\"]').first().click();");
        const closeB = spec.indexOf('await deviceB.evaluate(closeObservationWindow');
        const closeA = spec.indexOf('await tabA.evaluate(closeObservationWindow');
        const verdict = spec.indexOf('leaseRefusalWindowVerdict({');
        expect(Math.min(openA, openB, arm, takeover)).toBeGreaterThan(-1);
        expect(Math.max(openA, openB)).toBeLessThan(press);
        // 16:15 tail: the windows stay open THROUGH the gesture — armed before it, read only after it, cut at it.
        expect(arm).toBeGreaterThan(press);
        expect(arm).toBeLessThan(takeover);
        expect(Math.min(closeA, closeB)).toBeGreaterThan(takeover);
        expect(closeB).toBeLessThan(closeA);
        // A is cut at B's gesture mapped through MEASURED realm clocks, and a missing measurement is a lost observation.
        expect(spec.slice(closeB, closeA)).toContain('crossRealmBoundary(gestureAt, clockA, clockB)');
        expect(spec).toContain('boundaryA !== null && closedA?.token');
        expect(verdict).toBeGreaterThan(closeA);
        expect(spec.slice(arm, takeover)).toContain('const modelRequestsBeforeGesture = modelRequestsB;');
        expect(spec).not.toContain('tabStateOrNull');
    });
});
