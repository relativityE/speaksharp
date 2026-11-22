// AHT-12/13/14 (fifteen-case front-run review, 2026-11-10): the adverse journey's recovery is judged at the harness's `ownSaved`
// bar, Retry waits for the model to reach ready before ONE Start (Retry never records), and the Start-press budgets cite every
// press the journey can make. Pure verdicts with their failing controls, plus source-order checks on rwtAdverseJourney.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    AHT12_CATALOG_CASE_OPEN, AHT12_STAND_IN_LABEL, MODEL_SETUP_FAILED_COPY, NOT_SUPPORTED_WORDING,
    RECOVERY_CONTROLS, type BetweenFilesSnapshot, type ModelBytesRead, type OfflineFaultIo, type OfflineFaultOutcome, type RecoveryAttempt,
    type ReopenObservation, type ShownFailure, attemptPhase, betweenFilesFailureVerdict, betweenFilesGate, coldTakeSettledVerdict,
    isRecoveryControl, offlineNotExercisedVerdict, runBetweenFilesFault, SETUP_RUNTIME_STATE, shownFailureVerdict, unprovenRestoreVerdict,
    faultUnprovenRecoveryVerdict, worstVerdict, recoverySavedVerdict, retrySetupOutcome, reviewReopenVerdict, savedTranscriptDigest,
} from '../live/helpers/rwtAdverseRecovery';
import { mapToRuntimeState } from '../../frontend/src/lib/forensicAnchors';
import { createProgressAggregator } from '../../frontend/src/services/transcription/engines/progressAggregator';
import { BetweenFilesHold, ModelTransferTracker } from '../live/helpers/rwtAdverse';
import type { SessionRowFacts } from '../live/helpers/rwtSaveRetry';

const here = path.dirname(fileURLToPath(import.meta.url));
const AJ_PATH = path.resolve(here, '../live/helpers/rwtAdverseJourney.ts');
const aj = () => readFileSync(AJ_PATH, 'utf8');

const ID = '11111111-2222-3333-4444-555555555555';
const row = (over: Partial<SessionRowFacts> = {}): SessionRowFacts => ({
    id: ID, status: 'completed', hasIdempotencyKey: true, transcriptState: 'available', transcriptLength: 42, ...over,
});
const retried = (over: Partial<RecoveryAttempt> = {}): RecoveryAttempt => ({
    offered: 'mic-retry', retry: 'ready', startEnabled: true, recorded: true, ...over,
});
const cold = (over: Partial<RecoveryAttempt> = {}): RecoveryAttempt => ({
    offered: 'mic-download', retry: 'not-pressed', startEnabled: null, recorded: true, ...over,
});
const judge = (attempt: RecoveryAttempt, over: Partial<Parameters<typeof recoverySavedVerdict>[0]> = {}) =>
    recoverySavedVerdict({ variant: 'download-fails', preconditionEstablished: true, attempt, savedId: ID, rows: [row()], ...over });

describe('retrySetupOutcome — Retry\'s setup, from the complete status history after the press', () => {
    it('loading then ready → ready', () => expect(retrySetupOutcome(['loading', 'ready'])).toBe('ready'));
    it('the old failed state only (press not picked up yet) → pending, never failed again', () => {
        expect(retrySetupOutcome([])).toBe('pending');
        expect(retrySetupOutcome(['error'])).toBe('pending');
    });
    it('left the failed state and failed again → failed-again', () => {
        expect(retrySetupOutcome(['loading', 'error'])).toBe('failed-again');
        expect(retrySetupOutcome(['error', 'loading', 'init-failed'])).toBe('failed-again');
    });
    it('the first decisive state wins, in order', () => {
        expect(retrySetupOutcome(['loading', 'ready', 'error'])).toBe('ready');
        expect(retrySetupOutcome(['loading', 'error', 'loading', 'ready'])).toBe('failed-again');
    });
    it('still loading, or download-required (a second download press is not this design) → pending', () => {
        expect(retrySetupOutcome(['loading'])).toBe('pending');
        expect(retrySetupOutcome(['download-required'])).toBe('pending');
    });
    it('an unobserved history → unobserved', () => expect(retrySetupOutcome(null)).toBe('unobserved'));
});

describe('recoverySavedVerdict — deliberate/allowed recovery saved, at the ownSaved bar', () => {
    it('PASS: Retry → ready → Start recorded, one new completed row, page-bound, key, transcript kept', () => {
        expect(judge(retried())).toEqual({ status: 'PASS', detail: expect.stringMatching(/one completed session for the take/) });
    });
    it('AHT-12: the allowing browser\'s one cold press recorded and saved → PASS', () => {
        expect(judge(cold(), { variant: 'mic-denied' }).status).toBe('PASS');
        expect(judge(cold({ offered: 'mic-start' }), { variant: 'mic-denied' }).status).toBe('PASS');
    });
    it('FAIL: more than one new row (a stray or double save beside the take)', () => {
        expect(judge(retried(), { rows: [row(), row({ id: 'other' })] })).toEqual({ status: 'FAIL', detail: '2 session rows exist for one take' });
    });
    it('FAIL: no new row, though the page bound one', () => expect(judge(retried(), { rows: [] }).status).toBe('FAIL'));
    it('FAIL: the row is not the page-bound id', () => {
        expect(judge(retried(), { rows: [row({ id: 'other' })] }).detail).toMatch(/not the session the page bound/);
    });
    it('FAIL: completed only is no longer enough — the idempotency key is required', () => {
        expect(judge(retried(), { rows: [row({ hasIdempotencyKey: false })] }).detail).toMatch(/no idempotency key/);
    });
    it('FAIL: the transcript is not available, or empty', () => {
        expect(judge(retried(), { rows: [row({ transcriptState: 'expired' })] }).status).toBe('FAIL');
        expect(judge(retried(), { rows: [row({ transcriptLength: 0 })] }).status).toBe('FAIL');
    });
    it('FAIL: not completed', () => expect(judge(retried(), { rows: [row({ status: 'active' })] }).detail).toMatch(/active, not completed/));
    it('FAIL: the page bound no saved id', () => expect(judge(retried(), { savedId: null }).detail).toMatch(/did not bind/));
    it('FAIL: Retry failed again, never reached ready, or Start never enabled; no recording', () => {
        expect(judge(retried({ retry: 'failed-again', startEnabled: null, recorded: false })).detail).toMatch(/failed again/);
        expect(judge(retried({ retry: 'pending', startEnabled: null, recorded: false })).detail).toMatch(/did not reach ready/);
        expect(judge(retried({ startEnabled: false, recorded: false })).detail).toMatch(/Start never became enabled/);
        expect(judge(retried({ recorded: false })).detail).toMatch(/no take recorded/);
        expect(judge(cold({ recorded: false }), { variant: 'mic-denied' }).status).toBe('FAIL');
    });
    it('HOLD: the status after Retry was not observed', () => expect(judge(retried({ retry: 'unobserved' })).status).toBe('HOLD'));
    it('FAIL: the page offered another control than the variant\'s designed recovery (nothing pressed)', () => {
        expect(judge(cold({ offered: 'mic-start' }))).toEqual({ status: 'FAIL', detail: 'the page offered mic-start, not mic-retry, for the recovery' });
        expect(judge(retried(), { variant: 'mic-denied' }).status).toBe('FAIL');
        expect(judge(cold({ offered: null })).detail).toMatch(/no recovery control/);
    });
    it('HOLD, never PASS: no failure was established (13/14) and Retry was not offered', () => {
        expect(judge(cold({ offered: 'mic-start' }), { preconditionEstablished: false }).status).toBe('HOLD');
        expect(judge(cold({ offered: null }), { preconditionEstablished: false }).status).toBe('HOLD');
    });
    it('the designed controls: AHT-12 cold Start only; AHT-13/14 Retry only', () => {
        expect(RECOVERY_CONTROLS['mic-denied']).toEqual(['mic-download', 'mic-start']);
        expect(RECOVERY_CONTROLS['download-fails']).toEqual(['mic-retry']);
        expect(RECOVERY_CONTROLS['offline-mid-download']).toEqual(['mic-retry']);
        expect(isRecoveryControl('mic-retry')).toBe(true);
        expect(isRecoveryControl('verdict-practice-again')).toBe(false);
    });
});

describe('savedTranscriptDigest — the saved transcript, trimmed like the harness readback', () => {
    it('digests the trimmed text; surrounding whitespace never changes it', () => {
        const d = savedTranscriptDigest({ transcript_state: 'available', transcript: 'hello there' });
        expect(d).toMatch(/^[0-9a-f]{64}$/);
        expect(savedTranscriptDigest({ transcript_state: 'available', transcript: '  hello there\n' })).toBe(d);
    });
    it('null when not available, absent, empty or whitespace only', () => {
        expect(savedTranscriptDigest({ transcript_state: 'expired', transcript: 'x' })).toBeNull();
        expect(savedTranscriptDigest({ transcript_state: 'available', transcript: null })).toBeNull();
        expect(savedTranscriptDigest({ transcript_state: 'available', transcript: '  ' })).toBeNull();
        expect(savedTranscriptDigest(null)).toBeNull();
    });
});

describe('rwtAdverseJourney.ts — the recovery presses, in source order', () => {
    const fn = (src: string, name: string) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));
    it('Retry is pressed, then the model must reach ready, then Start is enabled and pressed, then RECORDING is awaited', () => {
        const body = fn(aj(), 'pressRecovery');
        const order = [
            "await pressCaptureControl(page, ['mic-retry'], { beforeClick: () => gate.confirm() });",
            'attempt.retry = await waitForRetrySetup(page,',
            "if (attempt.retry !== 'ready') return attempt;",
            'await expect(start).toBeEnabled({ timeout: START_ENABLED_MS })',
            "await pressCaptureControl(page, ['mic-start'], { beforeClick: () => gate.confirm() });",
            'attempt.recorded = await isRecording(page, RECORDING_MS);',
        ].map((m) => body.indexOf(m));
        expect(order.filter((i) => i < 0)).toEqual([]);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // No recording wait between the Retry press and the Start press: Retry never starts one (MicCard.tsx).
        expect(body.slice(order[0], order[4])).not.toContain('isRecording(');
    });
    it('the old loop that waited up to 600 s for a recording after Retry is gone', () => {
        const src = aj();
        expect(src).not.toContain('pressUntilRecording');
        expect(src).not.toContain('PRIMARY_CONTROLS');
        expect(src).not.toContain('recoveredTakeVerdict');
    });
    it('nothing is pressed unless the page offers the variant\'s designed control', () => {
        const body = fn(aj(), 'pressRecovery');
        const guard = body.indexOf('if (attempt.offered === null || !RECOVERY_CONTROLS[variant].includes(attempt.offered)) return attempt;');
        expect(guard).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(body.indexOf('pressCaptureControl('));
        expect(body).not.toContain('.click(');
    });
    it('the recovery is judged on the full own-saved readback against the pre-press baseline', () => {
        const src = aj();
        expect(fn(src, 'readNewTakeRows')).toContain(".select('id,status,idempotency_key,transcript_state,transcript,created_at')");
        expect(fn(src, 'saveRecoveredTake')).toContain('recoverySavedVerdict({ variant, preconditionEstablished, attempt, savedId, rows: read.rows })');
        const baseline = src.indexOf('baseline: await readSessionIds(owner.uid)');
        expect(baseline).toBeGreaterThan(src.indexOf('claimed = await prepareRunOwnedAccount('));
        expect(baseline).toBeLessThan(src.indexOf("await page.goto('/practice');"));
        // 13/14: Retry is judged only after the failed download was stated with Retry.
        expect(src).toContain("saveRecoveredTake(page, variant, failure.status === 'PASS', accountRows,");
    });
});

describe('rwtAdverseJourney.ts — Start-press budgets cite every press', () => {
    // #1835 (Sam, #1916): every Start-control press is ONE pressCaptureControl call, its readback inside the press.
    const START_CLICK = /await pressCaptureControl\(page, \[(?:'mic-(?:download|retry|start)'(?:, )?)+\], \{ beforeClick: \(\) => gate\.confirm\(\) \}\);/;
    const budgetComment = (src: string) => src.slice(src.indexOf(' * Harness parity (PO route 2026-11-10)'), src.indexOf('const AHT12_START_PRESS_BUDGET'));
    it('every cited line is a Start-control press, and every Start-control press in the journey is cited', () => {
        const src = aj();
        const lines = src.split('\n');
        const cited = new Set([...budgetComment(src).matchAll(/rwtAdverseJourney\.ts:(\d+)|, :(\d+)\)/g)].map((m) => Number(m[1] ?? m[2])));
        const presses = new Set(lines.flatMap((l, i) => (START_CLICK.test(l) ? [i + 1] : [])));
        expect(presses.size).toBe(5);
        for (const n of cited) expect(lines[n - 1], `line ${n}`).toMatch(START_CLICK);
        expect([...cited].sort((a, b) => a - b)).toEqual([...presses].sort((a, b) => a - b));
    });
    it('the budgets are the designed presses: AHT-12 one (the denied press, either id; J7.a), AHT-13/14 exactly download, Retry, Start', () => {
        const src = aj();
        expect(src).toContain("const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 1, perControl: { 'mic-download': 1, 'mic-start': 1 } };");
        for (const c of ['AHT13', 'AHT14']) {
            expect(src).toContain(`const ${c}_START_PRESS_BUDGET: StartPressBudget = { total: 3, perControl: { 'mic-download': 1, 'mic-retry': 1, 'mic-start': 1 } };`);
        }
    });
});

describe('reviewReopenVerdict — the recovery take reopens from Analytics with its saved transcript, before and after reload', () => {
    const SAVED = 'a'.repeat(64);
    const seen = (over: Partial<ReopenObservation & { savedId: string | null; savedDigest: string | null }> = {}) => ({
        listed: true, detailShown: true, before: SAVED, reloadShown: true, after: SAVED, savedId: ID, savedDigest: SAVED, ...over,
    });
    it('PASS: listed, opened, digest equal before and after reload', () => expect(reviewReopenVerdict(seen()).status).toBe('PASS'));
    it('HOLD: no saved take, or no readable saved transcript to compare (the harness NOT RUN)', () => {
        expect(reviewReopenVerdict(seen({ savedId: null })).status).toBe('HOLD');
        expect(reviewReopenVerdict(seen({ savedDigest: null })).status).toBe('HOLD');
        expect(reviewReopenVerdict(seen({ savedDigest: 'not-a-digest' })).status).toBe('HOLD');
    });
    it('FAIL: Analytics does not list the take', () => expect(reviewReopenVerdict(seen({ listed: false })).detail).toMatch(/does not list/));
    it('FAIL: the detail showed no readable transcript', () => {
        expect(reviewReopenVerdict(seen({ detailShown: false })).status).toBe('FAIL');
        expect(reviewReopenVerdict(seen({ before: null })).status).toBe('FAIL');
    });
    it('FAIL: the reopened transcript differs, before or after reload', () => {
        expect(reviewReopenVerdict(seen({ before: 'b'.repeat(64) })).detail).toMatch(/reopened transcript differs/);
        expect(reviewReopenVerdict(seen({ after: 'b'.repeat(64) })).detail).toMatch(/after reload the transcript differs/);
    });
    it('FAIL: nothing readable after reload', () => {
        expect(reviewReopenVerdict(seen({ reloadShown: false })).status).toBe('FAIL');
        expect(reviewReopenVerdict(seen({ after: null })).status).toBe('FAIL');
    });
    it('the page digest and the saved digest agree on trimming (same SHA-256 of the trimmed text)', async () => {
        const text = '  the take words \n';
        const page = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()))))
            .map((b) => b.toString(16).padStart(2, '0')).join('');
        expect(savedTranscriptDigest({ transcript_state: 'available', transcript: text })).toBe(page);
    });
});

describe('rwtAdverseJourney.ts — review-reopen, in source order', () => {
    const src = aj();
    const at = src.indexOf('async function reopenSavedTake(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    it('opens /analytics, the take\'s own detail control, digests, reloads, digests again', () => {
        const order = [
            "await page.goto('/analytics',",
            'page.getByTestId(`open-session-detail-${sessionId}`)',
            'await open.click();',
            'seen.before = await detailTranscriptDigest(page);',
            'await page.reload(',
            'seen.after = await detailTranscriptDigest(page);',
        ].map((m) => body.indexOf(m));
        expect(order.filter((i) => i < 0)).toEqual([]);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
    it('the rendered transcript is trimmed and digested in the page; only the digest leaves', () => {
        const from = src.indexOf('const detailTranscriptDigest');
        const digest = src.slice(from, src.indexOf('.catch(() => null);', from));
        expect(digest).toContain("getByTestId('session-detail-transcript').evaluate(");
        expect(digest).toContain('innerText.trim()');
        expect(digest).toContain("crypto.subtle.digest('SHA-256'");
    });
    it('each recovering variant writes the reopen row right after its recovery row; mic denied (J7.a) recovers nothing', () => {
        expect(src).not.toContain("receipt.row('after allowing the microphone a take saves'");
        expect(src).not.toContain('allowedPage');
        const retry = src.indexOf("receipt.row('Retry downloads the model and a take saves'");
        expect(src.indexOf('await reopenRow(receipt, page, recovered);', retry)).toBeGreaterThan(retry);
    });
    it('rwtJourney.ts is only imported; its analyticsThroughActions is not used', () => {
        expect(src).not.toContain('analyticsThroughActions(');
        const journeyImport = src.slice(src.lastIndexOf('import {', src.indexOf("} from './rwtJourney';")), src.indexOf("} from './rwtJourney';"));
        expect(journeyImport).not.toContain('analyticsThroughActions');
    });
});

describe('J7.c option B — the failure row: dropped between model files, the fault observed, then the AHT-13 rule', () => {
    const ok = { exercised: true, observed: true, statuses: ['download-required', 'loading', 'error'], finalStatus: 'error', retryOffered: true, mode: 'private' };
    it('PASS only when the network dropped between files, a failed model request was observed under the fault, and AHT-13 passes', () => {
        expect(betweenFilesFailureVerdict({ ...ok, droppedBetweenFiles: true }).status).toBe('PASS');
    });
    it('HOLD, never PASS: the network was not dropped between model files', () => {
        expect(betweenFilesFailureVerdict({ ...ok, droppedBetweenFiles: false }))
            .toEqual({ status: 'HOLD', detail: expect.stringMatching(/not dropped between model files/) });
    });
    it('HOLD, never PASS: dropped between files, but no failed model request of this download was observed under the fault', () => {
        expect(betweenFilesFailureVerdict({ ...ok, exercised: false, droppedBetweenFiles: true }))
            .toEqual({ status: 'HOLD', detail: expect.stringMatching(/fault's reach is unproven/) });
    });
    it('an incomplete status history stays HOLD; a contradiction still FAILs once exercised', () => {
        expect(betweenFilesFailureVerdict({ ...ok, observed: false, droppedBetweenFiles: true }).status).toBe('HOLD');
        expect(betweenFilesFailureVerdict({ ...ok, statuses: ['loading', 'ready', 'error'], droppedBetweenFiles: true }).status).toBe('FAIL');
        expect(betweenFilesFailureVerdict({ ...ok, retryOffered: false, droppedBetweenFiles: true }).status).toBe('FAIL');
    });
    it('the journey: the hold route is installed before the press; offline only inside runBetweenFilesFault, armed first', () => {
        const src = aj();
        const branch = src.slice(src.indexOf('// J7.c option B (PO, 2026-11-22'), src.indexOf('const history = await modelStatuses(page);'));
        const route = branch.indexOf('await context.route(MODEL_ASSETS, (route) =>');
        const index = branch.indexOf('pressIndex = (await page.evaluate(readRuntimeStateLog)');
        const starts = branch.indexOf('hold.startAttempt();');
        const press = branch.indexOf("await pressCaptureControl(page, ['mic-download'], { beforeClick: () => gate.confirm() });");
        const run = branch.indexOf('const run = await runBetweenFilesFault({');
        for (const [a, b] of [[route, index], [index, starts], [starts, press], [press, run]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
        expect(branch).toContain('hold.onRoute(route.request(), route.request().url(), transfer.snapshot().finished, () => route.continue())');
        // A held request is only ever continued: the drop is the browser's own offline switch, never a route abort.
        expect(branch).not.toMatch(/route\.(abort|fulfill)\(/);
        expect(src).not.toContain('context.setOffline(true)');
        expect(branch).toContain("armFault: () => { watch.setFaultPhase(true); fault.armFault(); transfer.armFault(); },");
        expect(branch).toContain('release: () => hold.release(),');
        expect(branch).toContain('read: () => readModelBytes(page),');
        expect(branch).toContain("context.on('requestfinished', (r) => transfer.onFinished(r));");
        expect(branch).toContain("context.on('requestfailed', (r) => transfer.onFailed(r));");
        expect(src).toContain('const droppedBetweenFiles = betweenFilesGate(gateRead, gateFiles).inject;');
        expect(src).toContain('worstVerdict(betweenFilesFailureVerdict({ ...failureFacts, droppedBetweenFiles }), shownFailureVerdict(shown))');
        // Finalization sends any still-held file on before the route is removed and the context is closed.
        const release = src.indexOf("await steps.step('held model file release', () => hold.releaseAll());");
        const unroute = src.indexOf("await steps.step('model route restore', () => context.unroute(MODEL_ASSETS));");
        expect(release).toBeGreaterThan(src.indexOf("await steps.step('offline restore', () => context.setOffline(false));"));
        expect(unroute).toBeGreaterThan(release);
    });
});

describe('J7.c option B — what the person sees on the failed attempt (PO and Sam, 2026-11-22)', () => {
    const shown = (over: Partial<ShownFailure> = {}): ShownFailure => ({
        sameAttempt: true, cardText: `Retry Private setup\n${MODEL_SETUP_FAILED_COPY}`, toastTexts: ['file was not found locally at /models/x'],
        retryVisible: true, retryEnabled: true, ...over,
    });
    it('PASS: the card states that setup did not finish, Retry is enabled, and nothing calls it not supported', () => {
        expect(shownFailureVerdict(shown()).status).toBe('PASS');
        expect(shownFailureVerdict(shown({ toastTexts: [] })).status).toBe('PASS'); // the card itself is the visible message
    });
    it('FAIL: any "not supported" wording, on the card or in a toast, is a product bug, not a pass', () => {
        for (const text of ['no available backend found. ERR: [wasm] RuntimeError: not supported', 'This browser is unsupported',
            'Private mode isn’t supported here', "Private mode isn't supported here", 'NOT SUPPORTED']) {
            expect(shownFailureVerdict(shown({ toastTexts: ['first toast', text] })))
                .toEqual({ status: 'FAIL', detail: expect.stringMatching(/not supported: a product bug, not a pass/) });
        }
        expect(shownFailureVerdict(shown({ cardText: `Not supported\n${MODEL_SETUP_FAILED_COPY}` })).status).toBe('FAIL');
        // It is the finding reported first, even when Retry is missing too.
        expect(shownFailureVerdict(shown({ toastTexts: ['unsupported'], retryVisible: false })).detail).toMatch(/not supported/);
        // Words that merely contain the letters are not the wording.
        expect(NOT_SUPPORTED_WORDING.test('supported formats: wav')).toBe(false);
        expect(NOT_SUPPORTED_WORDING.test('notsupportedish')).toBe(false);
    });
    it('FAIL: Retry not shown or disabled; or the card does not state the failure', () => {
        expect(shownFailureVerdict(shown({ retryVisible: false, retryEnabled: false })))
            .toEqual({ status: 'FAIL', detail: expect.stringMatching(/no enabled Retry \(not shown\)/) });
        expect(shownFailureVerdict(shown({ retryEnabled: false }))).toEqual({ status: 'FAIL', detail: expect.stringMatching(/\(disabled\)/) });
        expect(shownFailureVerdict(shown({ retryEnabled: null })).status).toBe('FAIL');
        expect(shownFailureVerdict(shown({ cardText: 'Download Private model' })))
            .toEqual({ status: 'FAIL', detail: 'the failed attempt did not state that setup did not finish' });
    });
    it('HOLD: nothing read, not bound to the failed attempt, or unreadable', () => {
        expect(shownFailureVerdict(null).status).toBe('HOLD');
        for (const sameAttempt of [false, null]) expect(shownFailureVerdict(shown({ sameAttempt, toastTexts: ['not supported'] })).status).toBe('HOLD');
        expect(shownFailureVerdict(shown({ cardText: null })).status).toBe('HOLD');
        expect(shownFailureVerdict(shown({ toastTexts: null })).status).toBe('HOLD');
    });
    it('one row from both verdicts: FAIL over HOLD over PASS, the first of the worst speaking', () => {
        const pass = { status: 'PASS' as const, detail: 'p' }; const hold = { status: 'HOLD' as const, detail: 'h' };
        const fail = { status: 'FAIL' as const, detail: 'f' }; const fail2 = { status: 'FAIL' as const, detail: 'f2' };
        expect(worstVerdict(pass, hold)).toBe(hold);
        expect(worstVerdict(hold, fail, fail2)).toBe(fail);
        expect(worstVerdict(pass, { status: 'PASS', detail: 'p2' })).toBe(pass);
    });
    it('the copy is MicCard’s own failed-setup line, character for character', () => {
        const card = readFileSync(path.resolve(here, '../../frontend/src/components/session/MicCard.tsx'), 'utf8');
        expect(card).toContain(`: modelError ? '${MODEL_SETUP_FAILED_COPY}'`);
    });
    it('the journey reads it on the same failed attempt, still offline, before any restore or press; never the telemetry code', () => {
        const src = aj();
        const exercised = src.indexOf("if (offlineOutcome.kind !== 'exercised') {");
        const read = src.indexOf('shown = await readShownFailure(page, pressIndex);', exercised);
        const restore = src.indexOf('else await context.setOffline(false);', read);
        const press = src.indexOf('const recovered = await saveRecoveredTake(', restore);
        for (const [a, b] of [[exercised, read], [read, restore], [restore, press]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
        const fn = src.slice(src.indexOf('async function readShownFailure('), src.indexOf('\n}\n', src.indexOf('async function readShownFailure(')));
        // Bound to the attempt before AND after the reads, so a log that moved on never binds them.
        expect(fn.match(/\(await attemptPhaseOf\(page, fromIndex\)\) === 'setup-failed'/g)?.length).toBe(2);
        expect(fn).toContain("page.getByTestId('mic-card').innerText(");
        expect(fn).toContain("page.locator('[data-sonner-toast]').allInnerTexts()");
        expect(fn).toContain("page.getByTestId('mic-retry')");
        expect(fn).toContain('retry.isEnabled()');
        expect(fn).not.toMatch(/\.click\(|\.press\(|setOffline|unsupported|acquisition/i);
    });
});

describe('AHT-14 — the page publishes no downloading state: the gate reads what it does publish (Codex P1 on df4db146)', () => {
    it('the product mapper: raw DOWNLOADING and ENGINE_INITIALIZING publish ENGINE_INITIALIZING; recordings, failures and the rest as pinned', () => {
        expect(mapToRuntimeState('DOWNLOADING')).toBe(SETUP_RUNTIME_STATE);
        expect(mapToRuntimeState('ENGINE_INITIALIZING')).toBe(SETUP_RUNTIME_STATE);
        expect(mapToRuntimeState('DOWNLOAD_COMPLETE')).toBe('IDLE');
        expect(mapToRuntimeState('DOWNLOAD_REQUIRED')).toBe('IDLE');
        expect(mapToRuntimeState('RECORDING')).toBe('RECORDING');
        expect(mapToRuntimeState('PAUSED')).toBe('RECORDING');
        expect(mapToRuntimeState('STOPPING')).toBe('STOPPING');
        expect(mapToRuntimeState('INIT_FAILED')).toBe('FAILED');
        expect(mapToRuntimeState('FAILED')).toBe('FAILED');
        expect(mapToRuntimeState('READY')).toBe('READY');
    });
    it('the cold download runs inside ENGINE_INITIALIZING: the service never dispatches DOWNLOAD_STARTED', () => {
        const svc = readFileSync(path.resolve(here, '../../frontend/src/services/transcription/TranscriptionService.ts'), 'utf8');
        expect(svc).not.toContain("type: 'DOWNLOAD_STARTED'");
        expect(svc).toContain("this.fsm.transition({ type: 'ENGINE_INIT_REQUESTED' });");
    });
    const page = { pct: 40, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' };
    const between: BetweenFilesSnapshot = { finished: 1, failedUnderFault: 0, held: 'pending' };
    it('the gate: published setup + counted bytes (any %, 100 included) + one finished file + the next held, unsent', () => {
        expect(betweenFilesGate(page, between)).toEqual({ inject: true });
        expect(betweenFilesGate({ ...page, pct: 100 }, between)).toEqual({ inject: true }); // the aggregator holds 100 between files
        expect(betweenFilesGate(page, { ...between, finished: 4 })).toEqual({ inject: true });
    });
    it('each missing piece is refused, with its own reason, in order', () => {
        expect(betweenFilesGate(null, between)).toEqual({ inject: false, reason: 'the page state was unreadable' });
        expect(betweenFilesGate({ ...page, runtimeState: 'READY' }, between))
            .toEqual({ inject: false, reason: 'the runtime state was READY, not ENGINE_INITIALIZING' });
        for (const pct of [0, null]) expect(betweenFilesGate({ ...page, pct }, between)).toEqual({ inject: false, reason: 'no model bytes were counted yet' });
        expect(betweenFilesGate({ ...page, status: 'ready' }, between).inject).toBe(false);
        expect(betweenFilesGate(page, null)).toEqual({ inject: false, reason: 'no model file of this attempt had finished' });
        expect(betweenFilesGate(page, { ...between, finished: 0 })).toEqual({ inject: false, reason: 'no model file of this attempt had finished' });
        for (const held of ['none', 'unseen', 'finished', 'failed'] as const) {
            expect(betweenFilesGate(page, { ...between, held }))
                .toEqual({ inject: false, reason: 'no next model file of this attempt was held at the start of its request' });
        }
    });
    it('the run 43740031821 shape is refused (model `ready` while RECORDING), and every other published state', () => {
        expect(betweenFilesGate({ pct: null, status: 'ready', runtimeState: 'RECORDING' }, between))
            .toEqual({ inject: false, reason: expect.stringMatching(/runtime state was RECORDING, not ENGINE_INITIALIZING/) });
        for (const runtimeState of ['IDLE', 'INITIATING', 'DOWNLOAD_REQUIRED', 'READY', 'STOPPING', 'FAILED', 'FAILED_VISIBLE', 'TERMINATED', 'DOWNLOADING', null]) {
            expect(betweenFilesGate({ ...page, runtimeState }, between).inject).toBe(false);
        }
        expect(betweenFilesGate({ pct: 40, status: 'loading' }, between).inject).toBe(false); // no runtime read: never assumed
    });
});

describe('J7.c option B — ModelTransferTracker: this attempt\'s model requests, from the network', () => {
    it('only this attempt\'s model requests count; finished files are counted once; failures count only under the fault', () => {
        const t = new ModelTransferTracker<object>();
        const before = {}; t.onRequest(before, 'https://x.test/models/whisper-base.en/a.onnx'); t.onFinished(before);
        expect(t.snapshot()).toEqual({ finished: 0, failedUnderFault: 0 }); // before the press: not this attempt
        expect(t.stateOf(before)).toBe('none');
        t.startAttempt();
        const a = {}; const b = {}; const c = {}; const other = {};
        t.onRequest(a, 'https://x.test/models/whisper-base.en/config.json');
        t.onRequest(other, 'https://x.test/api/thing'); t.onFinished(other);
        expect(t.stateOf(a)).toBe('pending');
        expect(t.stateOf(other)).toBe('none');
        expect(t.stateOf(null)).toBe('none');
        expect(t.snapshot().finished).toBe(0);
        t.onFinished(a);
        expect(t.stateOf(a)).toBe('finished');
        expect(t.snapshot()).toEqual({ finished: 1, failedUnderFault: 0 });
        t.onFinished(a); // a repeated event never counts twice
        expect(t.snapshot().finished).toBe(1);
        t.onRequest(b, 'https://x.test/models/whisper-base.en/onnx/encoder_model.onnx'); t.onFailed(b);
        expect(t.stateOf(b)).toBe('failed');
        expect(t.snapshot()).toEqual({ finished: 1, failedUnderFault: 0 }); // failed before the fault: not the fault's
        t.onRequest(c, 'https://x.test/models/whisper-base.en/onnx/decoder_model_merged.onnx');
        t.armFault(); t.onFailed(c); t.onFailed(c);
        expect(t.snapshot()).toEqual({ finished: 1, failedUnderFault: 1 });
        t.disarm();
        const d = {}; t.onRequest(d, 'https://x.test/models/whisper-base.en/d.onnx');
        expect(t.stateOf(d)).toBe('none'); // after the cause is removed: not this attempt's window
    });
});

describe('J7.c option B — BetweenFilesHold: the next model file, held at its start until released', () => {
    const sentBy = (sent: string[]) => (name: string) => async () => { sent.push(name); };
    it('lets everything through until one file of this attempt finished; then holds exactly one model request, unsent, until release', async () => {
        const sent: string[] = []; const go = sentBy(sent);
        const h = new BetweenFilesHold<object>();
        await h.onRoute({}, 'https://x.test/models/a.onnx', 3, go('before-press')); // before the press: never held
        h.startAttempt();
        await h.onRoute({}, 'https://x.test/models/config.json', 0, go('first')); // nothing finished yet
        await h.onRoute({}, 'https://x.test/api/thing', 1, go('api')); // not a model file
        expect(h.held()).toBeNull();
        const next = {};
        const handler = h.onRoute(next, 'https://x.test/models/onnx/encoder_model.onnx', 1, go('next'));
        expect(h.held()).toBe(next);
        await h.onRoute({}, 'https://x.test/models/onnx/decoder_model_merged.onnx', 1, go('later')); // only one is ever held
        expect(sent).toEqual(['before-press', 'first', 'api', 'later']);
        expect(await h.release()).toBe(true);
        await handler; // the route handler settles once the held request has been sent
        expect(sent).toEqual(['before-press', 'first', 'api', 'later', 'next']);
        expect(await h.release()).toBe(false); // sent once
        expect(h.held()).toBe(next); // still the request the gate judged
    });
    it('release with nothing held is false; releaseAll sends a held request and holds nothing more', async () => {
        const sent: string[] = []; const go = sentBy(sent);
        const idle = new BetweenFilesHold<object>();
        expect(await idle.release()).toBe(false);
        await idle.releaseAll();
        const h = new BetweenFilesHold<object>();
        h.startAttempt();
        const handler = h.onRoute({}, 'https://x.test/models/b.onnx', 1, go('held'));
        await h.releaseAll();
        await handler;
        expect(sent).toEqual(['held']);
        const late = new BetweenFilesHold<object>();
        late.startAttempt(); await late.releaseAll();
        await late.onRoute({}, 'https://x.test/models/c.onnx', 2, go('after-finalization')); // finalization closed the attempt
        expect(late.held()).toBeNull();
        expect(sent).toEqual(['held', 'after-finalization']);
    });
    it('a continue that throws (the page or route already gone) is reported as not sent, and the route handler still settles', async () => {
        const h = new BetweenFilesHold<object>();
        h.startAttempt();
        const handler = h.onRoute({}, 'https://x.test/models/b.onnx', 1, async () => { throw new Error('Target page, context or browser has been closed'); });
        expect(await h.release()).toBe(false);
        await expect(handler).resolves.toBeUndefined();
    });
});

describe('J7.c option B — with the REAL publisher: sequential files and stale progress (Sam, #1868 on 887a76f6)', () => {
    // The product's own aggregator, fed per-file events in the order transformers.js reports them.
    const pctAfter = (events: Parameters<ReturnType<typeof createProgressAggregator>>[0][]) => {
        const agg = createProgressAggregator(); let last: number | null = null;
        for (const e of events) { const v = agg(e); if (v !== null) last = Math.round(v); }
        return last;
    };
    const encoderDone = [{ file: 'encoder_model.onnx', loaded: 0, total: 100, status: 'progress' }, { file: 'encoder_model.onnx', loaded: 100, total: 100, status: 'done' }];
    it('between files the publisher shows 100 % (first file done, next not started): the gate injects from the network, not the percent', () => {
        const pct = pctAfter(encoderDone);
        expect(pct).toBe(100);
        const read = { pct, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' };
        expect(betweenFilesGate(read, { finished: 1, failedUnderFault: 0, held: 'pending' })).toEqual({ inject: true });
        // The same 100 % with no file finished on the network, or nothing held, is refused.
        expect(betweenFilesGate(read, { finished: 0, failedUnderFault: 0, held: 'pending' }).inject).toBe(false);
        expect(betweenFilesGate(read, { finished: 1, failedUnderFault: 0, held: 'none' }).inject).toBe(false);
    });
    it('stale progress mid-file (40 %) with no file of this attempt finished: refused', () => {
        const pct = pctAfter([{ file: 'encoder_model.onnx', loaded: 0, total: 100, status: 'progress' }, { file: 'encoder_model.onnx', loaded: 40, total: 100, status: 'progress' }]);
        expect(pct).toBe(40);
        expect(betweenFilesGate({ pct, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' }, { finished: 0, failedUnderFault: 0, held: 'none' }))
            .toEqual({ inject: false, reason: 'no model file of this attempt had finished' });
    });
});

describe('AHT-14 — attemptPhase: one attempt, from its complete PUBLISHED runtime log (Sam, #1868 HOLD on f62e94c3)', () => {
    const log = (...states: string[]) => ({ observed: true, states });
    it('a setup failure counts only when reached from THIS attempt\'s ENGINE_INITIALIZING with no READY before it', () => {
        expect(attemptPhase(log('IDLE', 'ENGINE_INITIALIZING'), 0)).toBe('in-setup');
        expect(attemptPhase(log('IDLE', 'ENGINE_INITIALIZING', 'FAILED'), 0)).toBe('setup-failed');
        expect(attemptPhase(log('IDLE', 'ENGINE_INITIALIZING', 'FAILED_VISIBLE'), 0)).toBe('setup-failed');
        expect(attemptPhase(log('IDLE', 'FAILED'), 0)).toBe('unattributed-failure'); // bare FAILED: never a setup failure
        // A previous attempt's ENGINE_INITIALIZING (before the press index) never binds this attempt's FAILED.
        expect(attemptPhase(log('ENGINE_INITIALIZING', 'FAILED', 'IDLE', 'FAILED'), 2)).toBe('unattributed-failure');
        expect(attemptPhase(log('ENGINE_INITIALIZING', 'READY', 'FAILED'), 0)).toBe('left-setup'); // failed after ready: not setup
    });
    it('a recording anywhere in the attempt is `recorded`, whatever came after (the run 43740031821 shape)', () => {
        expect(attemptPhase(log('IDLE', 'ENGINE_INITIALIZING', 'READY', 'RECORDING', 'FAILED'), 0)).toBe('recorded');
        expect(attemptPhase(log('ENGINE_INITIALIZING', 'STOPPING'), 0)).toBe('recorded');
    });
    it('left setup without failing: READY, or IDLE / TERMINATED after it; nothing decisive is pre-setup', () => {
        expect(attemptPhase(log('ENGINE_INITIALIZING', 'READY'), 0)).toBe('left-setup');
        expect(attemptPhase(log('ENGINE_INITIALIZING', 'IDLE'), 0)).toBe('left-setup');
        expect(attemptPhase(log('ENGINE_INITIALIZING', 'TERMINATED'), 0)).toBe('left-setup');
        expect(attemptPhase(log('IDLE', 'INITIATING'), 0)).toBe('pre-setup');
    });
    it('unobserved: no log in this document, a replaced document, or an index beyond the log', () => {
        expect(attemptPhase(null, 0)).toBe('unobserved');
        expect(attemptPhase({ observed: false, states: ['ENGINE_INITIALIZING'] }, 0)).toBe('unobserved');
        expect(attemptPhase(log('ENGINE_INITIALIZING'), 2)).toBe('unobserved');
        expect(attemptPhase(log('ENGINE_INITIALIZING'), -1)).toBe('unobserved');
    });
});

/**
 * A scripted page: the published runtime log, this attempt's model files (finished, failed under the fault, the held next file),
 * the network, and hooks that change them at exact points of the controller's sequence (during `setOffline(true)`, when the
 * held file is sent, during `setOffline(false)`, or right after the n-th phase read).
 */
type Step = { states?: string[]; held?: BetweenFilesSnapshot['held']; finished?: number; failedUnderFault?: number };
const gateOk: ModelBytesRead = { pct: 100, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' };
function scriptedIo(o: {
    states?: string[]; read?: ModelBytesRead | null; files?: Partial<BetweenFilesSnapshot>; onOffline?: Step; onRelease?: Step;
    onRestore?: Step; afterRead?: Record<number, Step>; offlineRejects?: boolean; restoreRejects?: boolean; releaseFails?: boolean;
    onlineAfterRestore?: boolean | null; observed?: boolean;
}) {
    const states = [...(o.states ?? ['IDLE', 'ENGINE_INITIALIZING'])];
    const files: BetweenFilesSnapshot = { finished: 1, failedUnderFault: 0, held: 'pending', ...o.files };
    const calls: string[] = [];
    let offline = false; let reads = 0; let clock = 0;
    const apply = (step?: Step) => {
        if (!step) return;
        states.push(...(step.states ?? []));
        if (step.held !== undefined) files.held = step.held;
        if (step.finished !== undefined) files.finished = step.finished;
        if (step.failedUnderFault !== undefined) files.failedUnderFault = step.failedUnderFault;
    };
    const io: OfflineFaultIo = {
        setOffline: async (on) => {
            calls.push(`setOffline(${on})`);
            if (on && o.offlineRejects) throw new Error('setOffline failed');
            if (!on && o.restoreRejects) throw new Error('restore failed');
            offline = on;
            apply(on ? o.onOffline : o.onRestore);
            return true;
        },
        phase: async () => {
            reads += 1; calls.push('phase');
            const p = attemptPhase({ observed: o.observed ?? true, states }, 0);
            apply(o.afterRead?.[reads]);
            return p;
        },
        files: () => { calls.push('files'); return { ...files }; },
        read: async () => { calls.push('read'); return o.read === undefined ? gateOk : o.read; },
        release: async () => {
            calls.push('release');
            if (o.releaseFails || files.held === 'none') return false;
            apply(o.onRelease);
            return true;
        },
        isOnline: async () => (offline ? false : (o.onlineAfterRestore === undefined ? true : o.onlineAfterRestore)),
        armFault: () => { calls.push('arm'); },
        disarmFault: () => { calls.push('disarm'); },
        sleep: async (ms) => { clock += ms; },
        now: () => clock,
    };
    return { io, calls, isOffline: () => offline };
}
const bound = { holdBoundMs: 1_000, boundMs: 1_000, pollMs: 50 };
const notExercised = (o: OfflineFaultOutcome) => offlineNotExercisedVerdict(o as Exclude<OfflineFaultOutcome, { kind: 'exercised' }>);
const neverOffline = (calls: string[]) => { expect(calls).not.toContain('setOffline(true)'); expect(calls).not.toContain('arm'); };

describe('J7.c option B — runBetweenFilesFault: deterministic interleavings', () => {
    it('exercised: waits for the next file to be held, gates, arms, goes offline, and only THEN sends the held file; left offline', async () => {
        const t = scriptedIo({ files: { held: 'none', finished: 0 }, afterRead: { 2: { held: 'pending', finished: 1 } },
            onRelease: { held: 'failed', failedUnderFault: 1, states: ['FAILED'] } });
        const run = await runBetweenFilesFault(t.io, bound);
        expect(run).toEqual({ outcome: { kind: 'exercised', settled: true }, gateRead: gateOk, gateFiles: { finished: 1, failedUnderFault: 0, held: 'pending' } });
        const arm = t.calls.indexOf('arm'); const off = t.calls.indexOf('setOffline(true)'); const send = t.calls.indexOf('release');
        expect(t.calls.indexOf('read')).toBeLessThan(arm);
        expect(arm).toBeLessThan(off);
        expect(off).toBeLessThan(send);
        expect(t.calls.filter((c) => c === 'release')).toHaveLength(1);
        expect(t.calls).not.toContain('setOffline(false)');
        expect(t.isOffline()).toBe(true);
    });
    it('no next file is held within the bound: never offline; not exercised; HOLD', async () => {
        const t = scriptedIo({ files: { held: 'none' } });
        const run = await runBetweenFilesFault(t.io, bound);
        expect(run.outcome).toEqual({ kind: 'not-exercised', reason: 'no model file of this attempt was requested after one had finished, within the bound', restored: true });
        expect(run.gateFiles).toBeNull();
        neverOffline(t.calls);
        expect(notExercised(run.outcome).status).toBe('HOLD');
    });
    it('a held request the network never showed as this attempt\'s (unseen) is waited on, never gated or taken offline', async () => {
        const t = scriptedIo({ files: { held: 'unseen' } });
        expect((await runBetweenFilesFault(t.io, bound)).outcome.kind).toBe('not-exercised');
        expect(t.calls).not.toContain('read');
        neverOffline(t.calls);
    });
    it('before any file is held: a recording, a lost log or an unattributed failure fails closed; a setup that ended is not exercised', async () => {
        const rec = scriptedIo({ files: { held: 'none' }, states: ['ENGINE_INITIALIZING', 'READY', 'RECORDING'] });
        expect((await runBetweenFilesFault(rec.io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', reason: expect.stringMatching(/recorded before any next model file was held/) });
        neverOffline(rec.calls);
        expect((await runBetweenFilesFault(scriptedIo({ files: { held: 'none' }, observed: false }).io, bound)).outcome.kind).toBe('fail-closed');
        expect((await runBetweenFilesFault(scriptedIo({ files: { held: 'none' }, states: ['IDLE', 'FAILED'] }).io, bound)).outcome.kind).toBe('fail-closed');
        expect((await runBetweenFilesFault(scriptedIo({ files: { held: 'none' }, states: ['ENGINE_INITIALIZING', 'FAILED'] }).io, bound)).outcome)
            .toMatchObject({ kind: 'not-exercised', reason: expect.stringMatching(/setup-failed before any next model file was held/) });
        expect((await runBetweenFilesFault(scriptedIo({ files: { held: 'none' }, states: ['ENGINE_INITIALIZING', 'READY'] }).io, bound)).outcome.kind).toBe('not-exercised');
    });
    it('gate refused, for each reason: the held file is sent on, online; never offline; the gate inputs are returned', async () => {
        const cases: [Parameters<typeof scriptedIo>[0], string][] = [
            [{ read: null }, 'the page state was unreadable'],
            [{ read: { ...gateOk, runtimeState: 'RECORDING' } }, 'the runtime state was RECORDING, not ENGINE_INITIALIZING'],
            [{ read: { ...gateOk, pct: 0 } }, 'no model bytes were counted yet'],
            [{ files: { finished: 0 } }, 'no model file of this attempt had finished'],
            [{ files: { held: 'finished' } }, 'no next model file of this attempt was held at the start of its request'],
        ];
        for (const [setup, reason] of cases) {
            const t = scriptedIo(setup);
            const run = await runBetweenFilesFault(t.io, bound);
            expect(run.outcome).toEqual({ kind: 'not-exercised', reason, restored: true });
            expect(run.gateFiles).not.toBeNull();
            expect(t.calls).toContain('release');
            neverOffline(t.calls);
        }
    });
    it('the attempt log contradicts the gate (already recorded): fail closed, held file sent on, never offline', async () => {
        const t = scriptedIo({ states: ['ENGINE_INITIALIZING', 'READY', 'RECORDING'] });
        expect((await runBetweenFilesFault(t.io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', reason: expect.stringMatching(/recorded before going offline/) });
        expect(t.calls).toContain('release');
        neverOffline(t.calls);
    });
    it('the held file DOWNLOADS although offline (no failure under the fault): restored at once, online proven → HOLD', async () => {
        const t = scriptedIo({ onRelease: { held: 'finished', finished: 2 } });
        const { outcome } = await runBetweenFilesFault(t.io, bound);
        expect(outcome).toMatchObject({ kind: 'not-exercised', restored: true, reason: expect.stringMatching(/downloaded although the browser was offline/) });
        expect(t.isOffline()).toBe(false);
        expect(notExercised(outcome).status).toBe('HOLD');
    });
    it('the log reaches the setup failure between the phase read and a finished held file: exercised, not a benign miss', async () => {
        // Phase reads: 1 at the gate, 2 in the first poll (then FAILED lands), 3 the re-read for the finished held file.
        const t = scriptedIo({ onRelease: { held: 'finished' }, afterRead: { 2: { states: ['FAILED'] } } });
        expect((await runBetweenFilesFault(t.io, bound)).outcome).toEqual({ kind: 'exercised', settled: true });
        expect(t.calls).not.toContain('setOffline(false)');
    });
    it('straight into a recording under the fault: restored, and FAIL closed', async () => {
        const t = scriptedIo({ onOffline: { states: ['READY', 'RECORDING'] } });
        const { outcome } = await runBetweenFilesFault(t.io, bound);
        expect(outcome).toMatchObject({ kind: 'fail-closed', restored: true, reason: expect.stringMatching(/recorded under the fault/) });
        expect(t.isOffline()).toBe(false);
        expect(notExercised(outcome).status).toBe('FAIL');
    });
    it('a benign miss whose recording starts while the network comes back: FAIL closed', async () => {
        const t = scriptedIo({ onRelease: { held: 'finished' }, onRestore: { states: ['READY', 'RECORDING'] } });
        expect((await runBetweenFilesFault(t.io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', restored: true, reason: expect.stringMatching(/recorded when the network came back/) });
    });
    it('the engine became READY under the fault (no recording yet): restored with online proven → HOLD', async () => {
        expect((await runBetweenFilesFault(scriptedIo({ onOffline: { states: ['READY'] } }).io, bound)).outcome)
            .toMatchObject({ kind: 'not-exercised', restored: true });
    });
    it('restoration not proven (the page does not report itself online, or the restore rejects): FAIL closed', async () => {
        expect((await runBetweenFilesFault(scriptedIo({ onRelease: { held: 'finished' }, onlineAfterRestore: false }).io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', restored: false });
        expect((await runBetweenFilesFault(scriptedIo({ onRelease: { held: 'finished' }, restoreRejects: true }).io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', restored: false });
    });
    it('going offline fails: restored, then the held file is sent; not exercised when online is proven, FAIL closed otherwise', async () => {
        const t = scriptedIo({ offlineRejects: true });
        expect((await runBetweenFilesFault(t.io, bound)).outcome).toMatchObject({ kind: 'not-exercised', restored: true });
        expect(t.calls.indexOf('release')).toBeGreaterThan(t.calls.indexOf('setOffline(false)'));
        expect((await runBetweenFilesFault(scriptedIo({ offlineRejects: true, onlineAfterRestore: null }).io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', restored: false });
    });
    it('the held file cannot be sent once offline: restored; not exercised with online proven', async () => {
        const t = scriptedIo({ releaseFails: true });
        expect((await runBetweenFilesFault(t.io, bound)).outcome)
            .toMatchObject({ kind: 'not-exercised', restored: true, reason: expect.stringMatching(/could not be sent/) });
        expect(t.isOffline()).toBe(false);
    });
    it('a failure not bound to this attempt, or a lost log, under the fault: restored and FAIL closed', async () => {
        const lost = scriptedIo({});
        lost.io.phase = (() => { let n = 0; return async () => (++n === 1 ? 'in-setup' : 'unobserved'); })();
        expect((await runBetweenFilesFault(lost.io, bound)).outcome)
            .toMatchObject({ kind: 'fail-closed', restored: true, reason: expect.stringMatching(/unobserved under the fault/) });
        const foreign = scriptedIo({});
        foreign.io.phase = (() => { let n = 0; return async () => (++n === 1 ? 'in-setup' : 'unattributed-failure'); })();
        expect((await runBetweenFilesFault(foreign.io, bound)).outcome).toMatchObject({ kind: 'fail-closed', restored: true });
    });
    it('the held file failed under the fault but the setup has not failed by the bound: exercised, unsettled; stays offline; polls', async () => {
        const t = scriptedIo({ onRelease: { held: 'failed', failedUnderFault: 1 } });
        expect((await runBetweenFilesFault(t.io, bound)).outcome).toEqual({ kind: 'exercised', settled: false });
        expect(t.calls.filter((c) => c === 'phase').length).toBe(1 + bound.boundMs / bound.pollMs + 1);
        expect(t.calls).not.toContain('setOffline(false)');
    });
    it('nothing failed under the fault by the bound (the held file still pending): restored → HOLD', async () => {
        const t = scriptedIo({});
        expect((await runBetweenFilesFault(t.io, bound)).outcome)
            .toMatchObject({ kind: 'not-exercised', restored: true, reason: expect.stringMatching(/no model request of this attempt failed under the fault within the bound/) });
    });
});

describe('AHT-14 callers: nothing that can write a take runs without the page proven online (Sam on 481ae722)', () => {
    it('the verdicts are FAIL and say nothing was stopped, saved or pressed', () => {
        expect(unprovenRestoreVerdict('stop-and-save')).toEqual({ status: 'FAIL', detail: expect.stringMatching(/not proven.*not stopped or saved/) });
        expect(unprovenRestoreVerdict('recovery-press')).toEqual({ status: 'FAIL', detail: expect.stringMatching(/not proven.*no recovery control was pressed/) });
    });
    it('caller 1: a not-exercised outcome with restored:false returns before settleColdTake (no Stop/save)', () => {
        const src = aj();
        const branch = src.slice(src.indexOf("if (offlineOutcome.kind !== 'exercised') {"), src.indexOf('const history = await modelStatuses(page);'));
        const guard = branch.indexOf('if (!offlineOutcome.restored) {');
        const verdict = branch.indexOf("unprovenRestoreVerdict('stop-and-save')", guard);
        const ret = branch.indexOf('return;', verdict);
        const settle = branch.indexOf('await settleColdTake(');
        for (const [a, b] of [[guard, verdict], [verdict, ret], [ret, settle]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
    });
    it('caller 2: after the exercised fault is removed, AHT-14 checks navigator.onLine and returns before any recovery press', () => {
        const src = aj();
        const restore = src.indexOf("else await context.setOffline(false);");
        const check = src.indexOf("if (variant === 'offline-mid-download' && (await page.evaluate(() => navigator.onLine).catch(() => null)) !== true) {", restore);
        const verdict = src.indexOf("unprovenRestoreVerdict('recovery-press')", check);
        const ret = src.indexOf('return;', verdict);
        const press = src.indexOf('const recovered = await saveRecoveredTake(page, variant, failure.status', ret);
        for (const [a, b] of [[restore, check], [check, verdict], [verdict, ret], [ret, press]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
    });
});

describe('AHT-14: no Retry without a proven fault (Sam on f326a7b0)', () => {
    it('verdict: HOLD when nothing recorded or the take was saved; FAIL when a recorded take is unsaved or the attempt unknown', () => {
        expect(faultUnprovenRecoveryVerdict({ recorded: false, savedId: null })).toEqual({ status: 'HOLD', detail: 'the download failure was not proven, so no recovery control was pressed' });
        expect(faultUnprovenRecoveryVerdict({ recorded: true, savedId: 's1' }).status).toBe('HOLD');
        expect(faultUnprovenRecoveryVerdict({ recorded: true, savedId: null }).status).toBe('FAIL');
        expect(faultUnprovenRecoveryVerdict({ recorded: null, savedId: null }).status).toBe('FAIL');
    });
    it('regression: an unproven failure row returns before saveRecoveredTake (no Retry press); only Stop through settleColdTake', () => {
        const src = aj();
        const online = src.indexOf("unprovenRestoreVerdict('recovery-press')");
        const guard = src.indexOf("if (variant === 'offline-mid-download' && failure.status !== 'PASS') {", online);
        const settle = src.indexOf('await settleColdTake(page, `adverse-${variant}-cold`, takes, pressIndex);', guard);
        const verdict = src.indexOf('faultUnprovenRecoveryVerdict(cold)', settle);
        const ret = src.indexOf('return;', verdict);
        const press = src.indexOf('const recovered = await saveRecoveredTake(page, variant, failure.status', ret);
        for (const [a, b] of [[online, guard], [guard, settle], [settle, verdict], [verdict, ret], [ret, press]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
        const branch = src.slice(guard, ret);
        expect(branch).not.toMatch(/mic-retry|saveRecoveredTake|pressRecovery/);
    });
});

describe('AHT-14 — the cold take is judged from the attempt, never "nothing to recover" when it recorded', () => {
    it('recorded and saved: HOLD (Retry not judged); recorded but unsaved: FAIL; unknown: FAIL; no recording: HOLD', () => {
        expect(coldTakeSettledVerdict({ recorded: true, savedId: 's1' }).status).toBe('HOLD');
        const unsaved = coldTakeSettledVerdict({ recorded: true, savedId: null });
        expect(unsaved).toEqual({ status: 'FAIL', detail: expect.stringMatching(/recorded but its save was not confirmed/) });
        expect(unsaved.detail).not.toMatch(/nothing to recover/);
        expect(coldTakeSettledVerdict({ recorded: null, savedId: null }).status).toBe('FAIL');
        expect(coldTakeSettledVerdict({ recorded: false, savedId: null })).toEqual({ status: 'HOLD', detail: expect.stringMatching(/shows no recording/) });
    });
    it('the journey: log index read before the press; the controller decides; the cold take reads the attempt, not the current state', () => {
        const src = aj();
        const index = src.indexOf('pressIndex = (await page.evaluate(readRuntimeStateLog)');
        const press = src.indexOf("await pressCaptureControl(page, ['mic-download'], { beforeClick: () => gate.confirm() });", index);
        const run = src.indexOf('const run = await runBetweenFilesFault({', press);
        const outcome = src.indexOf('const offlineOutcome = run.outcome;', run);
        for (const [a, b] of [[index, press], [press, run], [run, outcome]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
        expect(src).toContain('phase: () => attemptPhaseOf(page, pressIndex),');
        expect(src).toContain("context.on('request', (r) => transfer.onRequest(r, r.url()));");
        expect(src).toContain("context.on('requestfinished', (r) => transfer.onFinished(r));");
        expect(src).toContain("context.on('requestfailed', (r) => transfer.onFailed(r));");
        expect(src.indexOf('transfer.startAttempt();')).toBeLessThan(src.indexOf("await pressCaptureControl(page, ['mic-download'], { beforeClick: () => gate.confirm() });", src.indexOf('transfer.startAttempt();')));
        expect(src).toContain('isOnline: () => page.evaluate(() => navigator.onLine)');
        expect(src).toContain('await settleColdTake(page, `adverse-${variant}-cold`, takes, pressIndex);');
        const settle = src.slice(src.indexOf('async function settleColdTake('), src.indexOf('\n}\n', src.indexOf('async function settleColdTake(')));
        expect(settle).toContain('attemptPhaseOf(page, fromIndex)');
        expect(settle).not.toMatch(/'FAILED'\]\.includes/); // no current-state FAILED shortcut
        expect(settle).toContain('stopBenchmarkRecording(page, label, 180_000)');
        expect(settle).not.toMatch(/getByTestId\('mic-(start|download|retry)'\)/); // no Start press
        const branch = src.slice(src.indexOf("if (offlineOutcome.kind !== 'exercised') {"), src.indexOf('const history = await modelStatuses(page);'));
        expect(branch).toContain('return;');
        expect(branch).not.toContain('mic-retry');
        expect(branch).not.toContain('saveRecoveredTake');
        expect(src).toContain('await page.evaluate(armRuntimeStateLog, runtimeStateToken);');
    });
    it('no separate transfer wait remains: the controller waits for the held file; the page read stays one immediate read', () => {
        const src = aj();
        expect(src).not.toContain('waitForTransfer');
        expect(src).not.toContain("context.on('response'");
        const read = src.slice(src.indexOf('const readModelBytes = (page: Page)'), src.indexOf('}).catch(() => null);', src.indexOf('const readModelBytes = (page: Page)')));
        expect(read.length).toBeGreaterThan(0);
        expect(read).toContain("getAttribute('data-runtime-state')");
        expect(read).not.toMatch(/waitFor|setTimeout|while|for \(/);
        expect(src).toContain('{ holdBoundMs: NEXT_FILE_MS, boundMs: 300_000, pollMs: 50 }');
    });
});

describe('AHT-12: the stand-in labels stay truthful; J7.a runs no stand-in and records same-page recovery UNTESTED (2026-11-19)', () => {
    const src = readFileSync(AJ_PATH, 'utf8');
    const catalog = JSON.parse(readFileSync(path.resolve(here, '../../tools/cloud-test/config/assertion-catalog.json'), 'utf8')) as
        Record<string, unknown>;
    const findCase = (o: unknown): { minimumStarts?: number } | null => {
        if (!o || typeof o !== 'object') return null;
        const rec = o as Record<string, unknown>;
        if (rec['AHT-12'] && typeof rec['AHT-12'] === 'object') return rec['AHT-12'] as { minimumStarts?: number };
        for (const v of Object.values(rec)) { const f = findCase(v); if (f) return f; }
        return null;
    };
    it('the label says what the test does not prove', () => {
        expect(AHT12_STAND_IN_LABEL).toMatch(/fresh-browser stand-in/);
        expect(AHT12_STAND_IN_LABEL).toMatch(/does not prove Allow → Retry on the original denied page/);
        expect(AHT12_CATALOG_CASE_OPEN).toMatch(/separate requirement this test does not meet/);
    });
    it('J7.a writes no fresh-browser stand-in row, and records same-page recovery as UNTESTED instead', () => {
        expect(src).not.toContain('AHT12_STAND_IN_LABEL');
        expect(src).not.toContain('standIn: true');
        expect(src).toContain('receipt.meta.samePageRecovery = SAME_PAGE_RECOVERY;');
    });
    it('the catalog still asks three Starts for AHT-12 (not silently changed); J7.a is designed for the one denied press', () => {
        expect(findCase(catalog)?.minimumStarts).toBe(3);
        expect(src).toContain("const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 1,");
    });
});
