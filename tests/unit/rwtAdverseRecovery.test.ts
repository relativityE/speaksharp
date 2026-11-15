// AHT-12/13/14 (fifteen-case front-run review, 2026-11-10): the adverse journey's recovery is judged at the harness's `ownSaved`
// bar, Retry waits for the model to reach ready before ONE Start (Retry never records), and the Start-press budgets cite every
// press the journey can make. Pure verdicts with their failing controls, plus source-order checks on rwtAdverseJourney.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    AHT12_CATALOG_CASE_OPEN, AHT12_STAND_IN_LABEL,
    RECOVERY_CONTROLS, type OfflineFaultIo, type OfflineFaultOutcome, type RecoveryAttempt, type ReopenObservation, attemptPhase,
    coldTakeSettledVerdict, isRecoveryControl, midDownloadFailureVerdict, modelBytesSeen, offlineInjectionGate, offlineNotExercisedVerdict,
    runOfflineFault, SETUP_RUNTIME_STATE, downloadingNow,
    recoverySavedVerdict, retrySetupOutcome, reviewReopenVerdict, savedTranscriptDigest,
} from '../live/helpers/rwtAdverseRecovery';
import { mapToRuntimeState } from '../../frontend/src/lib/forensicAnchors';
import { createProgressAggregator } from '../../frontend/src/services/transcription/engines/progressAggregator';
import { ModelTransferTracker } from '../live/helpers/rwtAdverse';
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
            "await page.getByTestId('mic-retry').click();",
            'attempt.retry = await waitForRetrySetup(page,',
            "if (attempt.retry !== 'ready') return attempt;",
            'await expect(start).toBeEnabled({ timeout: START_ENABLED_MS })',
            'await start.click();',
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
        expect(guard).toBeLessThan(body.indexOf('.click()'));
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
    const START_CLICK = /await (?:control|start|page\.getByTestId\('(?:mic-download|mic-retry|mic-start)'\))\.click\(\);/;
    const budgetComment = (src: string) => src.slice(src.indexOf(' * Harness parity (PO route 2026-11-10)'), src.indexOf('const AHT12_START_PRESS_BUDGET'));
    it('every cited line is a Start-control press, and every Start-control press in the journey is cited', () => {
        const src = aj();
        const lines = src.split('\n');
        const cited = new Set([...budgetComment(src).matchAll(/rwtAdverseJourney\.ts:(\d+)|, :(\d+)\)/g)].map((m) => Number(m[1] ?? m[2])));
        const presses = new Set(lines.flatMap((l, i) => (START_CLICK.test(l) ? [i + 1] : [])));
        expect(presses.size).toBe(6);
        for (const n of cited) expect(lines[n - 1], `line ${n}`).toMatch(START_CLICK);
        expect([...cited].sort((a, b) => a - b)).toEqual([...presses].sort((a, b) => a - b));
    });
    it('the budgets are the designed presses: AHT-12 two (cold control, either id), AHT-13/14 exactly download, Retry, Start', () => {
        const src = aj();
        expect(src).toContain("const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 2, perControl: { 'mic-download': 2, 'mic-start': 2 } };");
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
    it('each variant writes the reopen row right after its recovery row, on the page that saved the take', () => {
        const allowed = src.indexOf("receipt.row('after allowing the microphone a take saves'");
        expect(src.indexOf('await reopenRow(receipt, allowedPage, recovered);', allowed)).toBeGreaterThan(allowed);
        const retry = src.indexOf("receipt.row('Retry downloads the model and a take saves'");
        expect(src.indexOf('await reopenRow(receipt, page, recovered);', retry)).toBeGreaterThan(retry);
    });
    it('rwtJourney.ts is only imported; its analyticsThroughActions is not used', () => {
        expect(src).not.toContain('analyticsThroughActions(');
        const journeyImport = src.slice(src.lastIndexOf('import {', src.indexOf("} from './rwtJourney';")), src.indexOf("} from './rwtJourney';"));
        expect(journeyImport).not.toContain('analyticsThroughActions');
    });
});

describe('AHT-14 — offline only after model bytes were received, mid-transfer', () => {
    it('modelBytesSeen: 1–99 % while loading is bytes received mid-transfer; anything else is not', () => {
        expect(modelBytesSeen({ pct: 1, status: 'loading' })).toBe(true);
        expect(modelBytesSeen({ pct: 99, status: 'loading' })).toBe(true);
        expect(modelBytesSeen({ pct: 0, status: 'loading' })).toBe(false); // request issued, no byte yet
        expect(modelBytesSeen({ pct: 100, status: 'loading' })).toBe(false); // transfer finished: engine init, not mid-download
        expect(modelBytesSeen({ pct: null, status: 'loading' })).toBe(false); // unreadable
        expect(modelBytesSeen({ pct: 40, status: 'ready' })).toBe(false);
        expect(modelBytesSeen(null)).toBe(false);
    });
    const ok = { exercised: true, observed: true, statuses: ['download-required', 'loading', 'error'], finalStatus: 'error', retryOffered: true, mode: 'private' };
    it('PASS only with bytes seen before offline, the fault observed, and the AHT-13 rule passing', () => {
        expect(midDownloadFailureVerdict({ ...ok, bytesSeenBeforeOffline: true }).status).toBe('PASS');
    });
    it('HOLD, never PASS: offline before any byte arrived (offline-before-download)', () => {
        const v = midDownloadFailureVerdict({ ...ok, bytesSeenBeforeOffline: false });
        expect(v).toEqual({ status: 'HOLD', detail: expect.stringMatching(/no model bytes were seen before going offline/) });
    });
    it('HOLD, never PASS: bytes seen but no failed model request observed (worker fetches unobservable, or finished first)', () => {
        const v = midDownloadFailureVerdict({ ...ok, exercised: false, bytesSeenBeforeOffline: true });
        expect(v.status).toBe('HOLD');
        expect(v.detail).toMatch(/worker fetches may not reach Playwright/);
    });
    it('an incomplete status history stays HOLD; a contradiction still FAILs once exercised', () => {
        expect(midDownloadFailureVerdict({ ...ok, observed: false, bytesSeenBeforeOffline: true }).status).toBe('HOLD');
        expect(midDownloadFailureVerdict({ ...ok, statuses: ['loading', 'ready', 'error'], bytesSeenBeforeOffline: true }).status).toBe('FAIL');
        expect(midDownloadFailureVerdict({ ...ok, retryOffered: false, bytesSeenBeforeOffline: true }).status).toBe('FAIL');
    });
    it('the journey gates going offline on received bytes, after the press; the controller arms the fault before going offline', () => {
        const src = aj();
        const press = src.indexOf("await page.getByTestId('mic-download').click();", src.indexOf('let modelResponses = 0;'));
        const gate = src.indexOf('atOffline = await waitForTransfer(page, () => transfer.snapshot());', press);
        const run = src.indexOf('await runOfflineFault({', gate);
        expect(press).toBeGreaterThan(-1);
        expect(gate).toBeGreaterThan(press);
        expect(run).toBeGreaterThan(gate);
        // Going offline happens only inside runOfflineFault (arm-before-offline is proven by its scripted cases).
        expect(src).not.toContain('context.setOffline(true)');
        expect(src).toContain("armFault: () => { watch.setFaultPhase(true); fault.armFault(); transfer.armFault(); },");
        expect(src).toContain('setOffline: (offline) => context.setOffline(offline)');
        // The old gate fired when a model request was merely ISSUED.
        expect(src).not.toContain('modelRequests');
        expect(src).toContain('midDownloadFailureVerdict({ ...failureFacts, bytesSeenBeforeOffline })');
        // "Bytes seen before offline" is the gate itself (counted bytes AND a body in flight), never the percent alone.
        expect(src).toContain('const bytesSeenBeforeOffline = offlineInjectionGate(atOffline, transferAtGate).inject;');
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
    const inFlight = { openInBody: 1, failedUnderFault: 0 };
    const idle = { openInBody: 0, failedUnderFault: 0 };
    it('downloading = published ENGINE_INITIALIZING + counted bytes (any %, 100 included) + a body of this attempt in flight', () => {
        expect(downloadingNow(page, inFlight)).toBe(true);
        expect(downloadingNow({ ...page, pct: 100 }, inFlight)).toBe(true); // the aggregator holds 100 while a later file downloads
        expect(offlineInjectionGate({ ...page, pct: 100 }, inFlight)).toEqual({ inject: true });
        expect(downloadingNow(page, idle)).toBe(false); // a retained percent with nothing in flight is not a transfer
        expect(offlineInjectionGate(page, idle)).toEqual({ inject: false, reason: expect.stringMatching(/no model response of this attempt had its body in flight/) });
        expect(offlineInjectionGate(page, null).inject).toBe(false); // unobservable transfer: never injected
        for (const pct of [0, null]) expect(offlineInjectionGate({ ...page, pct }, inFlight).inject).toBe(false);
        expect(downloadingNow({ ...page, status: 'ready' }, inFlight)).toBe(false);
    });
    it('the run 43740031821 shape is refused (model `ready` while RECORDING), and every other published state', () => {
        expect(offlineInjectionGate({ pct: null, status: 'ready', runtimeState: 'RECORDING' }, inFlight))
            .toEqual({ inject: false, reason: expect.stringMatching(/runtime state was RECORDING, not ENGINE_INITIALIZING/) });
        for (const runtimeState of ['IDLE', 'INITIATING', 'DOWNLOAD_REQUIRED', 'READY', 'STOPPING', 'FAILED', 'FAILED_VISIBLE', 'TERMINATED', 'DOWNLOADING', null]) {
            expect(offlineInjectionGate({ ...page, runtimeState }, inFlight).inject).toBe(false);
        }
        expect(offlineInjectionGate({ pct: 40, status: 'loading' }, inFlight).inject).toBe(false); // no runtime read: never assumed
        expect(offlineInjectionGate(null, inFlight)).toEqual({ inject: false, reason: 'the page state was unreadable' });
    });
});

describe('AHT-14 — ModelTransferTracker: a body in flight is a started response that has not finished or failed', () => {
    it('only this attempt\'s model-asset requests count; started → in flight; finished or failed → not; failures count only under the fault', () => {
        const t = new ModelTransferTracker<object>();
        const before = {}; t.onRequest(before, 'https://x.test/models/whisper-base.en/a.onnx'); t.onResponse(before);
        expect(t.snapshot()).toEqual({ openInBody: 0, failedUnderFault: 0 }); // before the press: not this attempt
        t.startAttempt();
        const a = {}; const b = {}; const other = {};
        t.onRequest(a, 'https://x.test/models/whisper-base.en/encoder.onnx');
        t.onRequest(other, 'https://x.test/api/thing'); t.onResponse(other);
        expect(t.snapshot().openInBody).toBe(0); // requested, no response yet: no body in flight
        t.onResponse(a);
        expect(t.snapshot().openInBody).toBe(1);
        t.onFinished(a);
        expect(t.snapshot().openInBody).toBe(0); // between sequential files
        t.onRequest(b, 'https://x.test/models/whisper-base.en/decoder.onnx'); t.onResponse(b);
        expect(t.snapshot().openInBody).toBe(1);
        t.onFailed(b);
        expect(t.snapshot()).toEqual({ openInBody: 0, failedUnderFault: 0 }); // failed before the fault: not the fault's
        const c = {}; t.onRequest(c, 'https://x.test/models/whisper-base.en/c.onnx'); t.onResponse(c);
        t.armFault(); t.onFailed(c);
        expect(t.snapshot()).toEqual({ openInBody: 0, failedUnderFault: 1 });
        t.disarm();
        const d = {}; t.onRequest(d, 'https://x.test/models/whisper-base.en/d.onnx'); t.onResponse(d);
        expect(t.snapshot().openInBody).toBe(0); // after the cause is removed: not this attempt's window
    });
});

describe('AHT-14 — with the REAL publisher: sequential assets and stale progress (Sam, #1868 on 887a76f6)', () => {
    // The product's own aggregator, fed per-file events in the order transformers.js reports them.
    const pctAfter = (events: Parameters<ReturnType<typeof createProgressAggregator>>[0][]) => {
        const agg = createProgressAggregator(); let last: number | null = null;
        for (const e of events) { const v = agg(e); if (v !== null) last = Math.round(v); }
        return last;
    };
    const encoderDone = [{ file: 'encoder_model.onnx', loaded: 0, total: 100, status: 'progress' }, { file: 'encoder_model.onnx', loaded: 100, total: 100, status: 'done' }];
    const decoderHalf = [{ file: 'decoder_model_merged.onnx', loaded: 0, total: 300, status: 'progress' }, { file: 'decoder_model_merged.onnx', loaded: 150, total: 300, status: 'progress' }];
    it('sequential assets: the publisher shows 100 % while the second file is half downloaded — the gate still injects, from the network', () => {
        const pct = pctAfter([...encoderDone, ...decoderHalf]);
        expect(pct).toBe(100); // the real aggregator holds 100 mid-transfer
        const read = { pct, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' };
        expect(offlineInjectionGate(read, { openInBody: 1, failedUnderFault: 0 })).toEqual({ inject: true });
    });
    it('sequential assets: between files (first done, second not started) the publisher shows 100 % and nothing is in flight — refused', () => {
        const pct = pctAfter(encoderDone);
        expect(pct).toBe(100);
        expect(offlineInjectionGate({ pct, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' }, { openInBody: 0, failedUnderFault: 0 }).inject).toBe(false);
    });
    it('stale progress: the publisher stops at a mid value with no body in flight (finished or stalled) — refused; under the fault it restores', async () => {
        const pct = pctAfter([{ file: 'encoder_model.onnx', loaded: 0, total: 100, status: 'progress' }, { file: 'encoder_model.onnx', loaded: 40, total: 100, status: 'progress' }]);
        expect(pct).toBe(40);
        expect(offlineInjectionGate({ pct, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' }, { openInBody: 0, failedUnderFault: 0 }).inject).toBe(false);
        // Offline while in flight, then the body completes during setOffline(true) with the percent left stale at 40: restored.
        const t = scriptedIo({ pct, onOffline: { openInBody: 0 } });
        expect(await runOfflineFault(t.io, { pct, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' }, bound))
            .toMatchObject({ kind: 'not-exercised', restored: true, reason: expect.stringMatching(/transfer ended before the fault reached it/) });
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
 * A scripted page: the published runtime log, this attempt's network transfer, the network, and hooks that change them at exact
 * points of the controller's sequence (during `setOffline(true)`, during `setOffline(false)`, or right after the n-th phase read).
 */
type Step = { states?: string[]; openInBody?: number; failedUnderFault?: number };
function scriptedIo(o: {
    states?: string[]; pct?: number | null; openInBody?: number; onOffline?: Step; onRestore?: Step; afterRead?: Record<number, Step>;
    offlineRejects?: boolean; restoreRejects?: boolean; onlineAfterRestore?: boolean | null; observed?: boolean;
}) {
    const states = [...(o.states ?? ['IDLE', 'ENGINE_INITIALIZING'])];
    const transfer = { openInBody: o.openInBody ?? 1, failedUnderFault: 0 };
    const calls: string[] = [];
    let offline = false; let reads = 0; let clock = 0;
    const apply = (step?: Step) => {
        if (!step) return;
        states.push(...(step.states ?? []));
        if (step.openInBody !== undefined) transfer.openInBody = step.openInBody;
        if (step.failedUnderFault !== undefined) transfer.failedUnderFault = step.failedUnderFault;
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
        transfer: () => { calls.push('transfer'); return { ...transfer }; },
        isOnline: async () => (offline ? false : (o.onlineAfterRestore === undefined ? true : o.onlineAfterRestore)),
        armFault: () => { calls.push('arm'); },
        disarmFault: () => { calls.push('disarm'); },
        sleep: async (ms) => { clock += ms; },
        now: () => clock,
    };
    return { io, calls, isOffline: () => offline };
}
const bound = { boundMs: 1_000, pollMs: 50 };
const gateOk = { pct: 40, status: 'loading', runtimeState: 'ENGINE_INITIALIZING' };
const notExercised = (o: OfflineFaultOutcome) => offlineNotExercisedVerdict(o as Exclude<OfflineFaultOutcome, { kind: 'exercised' }>);

describe('AHT-14 — runOfflineFault: deterministic interleavings (Sam, #1868 HOLDs; Codex P1 on df4db146)', () => {
    it('gate refused: the browser is never taken offline; not exercised; HOLD', async () => {
        const t = scriptedIo({});
        const out = await runOfflineFault(t.io, { pct: null, status: 'ready', runtimeState: 'RECORDING' }, bound);
        expect(out.kind).toBe('not-exercised');
        expect(t.calls).not.toContain('setOffline(true)');
        expect(notExercised(out).status).toBe('HOLD');
        const idle = scriptedIo({ openInBody: 0 });
        expect((await runOfflineFault(idle.io, gateOk, bound)).kind).toBe('not-exercised');
        expect(idle.calls).not.toContain('setOffline(true)');
    });
    it('the attempt log contradicts the gate snapshot (already recorded): fail closed without going offline', async () => {
        const t = scriptedIo({ states: ['ENGINE_INITIALIZING', 'READY', 'RECORDING'] });
        expect(await runOfflineFault(t.io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', reason: expect.stringMatching(/recorded before going offline/) });
        expect(t.calls).not.toContain('setOffline(true)');
    });
    it('exercised: the in-flight body fails under the fault, then the setup fails from this attempt; armed before offline; left offline', async () => {
        const t = scriptedIo({ onOffline: { openInBody: 0, failedUnderFault: 1 }, afterRead: { 3: { states: ['FAILED'] } } });
        expect(await runOfflineFault(t.io, gateOk, bound)).toEqual({ kind: 'exercised', settled: true });
        expect(t.calls.indexOf('arm')).toBeLessThan(t.calls.indexOf('setOffline(true)'));
        expect(t.calls).not.toContain('setOffline(false)');
        expect(t.isOffline()).toBe(true);
    });
    it('the body COMPLETES during setOffline(true) (no failure under the fault): restored at once, online proven → HOLD', async () => {
        const t = scriptedIo({ onOffline: { openInBody: 0 } });
        const out = await runOfflineFault(t.io, gateOk, bound);
        expect(out).toMatchObject({ kind: 'not-exercised', restored: true });
        const offlineAt = t.calls.indexOf('setOffline(true)');
        // The very next read restores (after one log re-read that could only turn it into exercised or fail-closed).
        expect(t.calls.slice(offlineAt + 1, offlineAt + 5)).toEqual(['phase', 'transfer', 'phase', 'setOffline(false)']);
        expect(t.isOffline()).toBe(false);
        expect(notExercised(out).status).toBe('HOLD');
    });
    it('straight into a recording DURING setOffline(true): restored, and FAIL closed', async () => {
        const t = scriptedIo({ onOffline: { states: ['READY', 'RECORDING'], openInBody: 0 } });
        const out = await runOfflineFault(t.io, gateOk, bound);
        expect(out).toMatchObject({ kind: 'fail-closed', restored: true, reason: expect.stringMatching(/recorded under the fault/) });
        expect(t.isOffline()).toBe(false);
        expect(notExercised(out).status).toBe('FAIL');
    });
    it('JUST AFTER a landing read (read says in setup, then a recording starts): the next read restores and FAILs closed', async () => {
        const t = scriptedIo({ afterRead: { 2: { states: ['READY', 'RECORDING'], openInBody: 0 } } });
        expect(await runOfflineFault(t.io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', restored: true });
        const offlineAt = t.calls.indexOf('setOffline(true)');
        expect(t.calls.slice(offlineAt + 1)).toEqual(['phase', 'transfer', 'phase', 'setOffline(false)', 'disarm']);
    });
    it('just after a landing read the body completes, and the recording starts while the network comes back: FAIL closed', async () => {
        const t = scriptedIo({ afterRead: { 2: { openInBody: 0 } }, onRestore: { states: ['READY', 'RECORDING'] } });
        expect(await runOfflineFault(t.io, gateOk, bound))
            .toMatchObject({ kind: 'fail-closed', restored: true, reason: expect.stringMatching(/recorded when the network came back/) });
    });
    it('the engine became READY under the fault (no recording yet): restored with online proven → HOLD', async () => {
        expect(await runOfflineFault(scriptedIo({ afterRead: { 2: { states: ['READY'] } } }).io, gateOk, bound))
            .toMatchObject({ kind: 'not-exercised', restored: true });
    });
    it('restoration not proven (the page does not report itself online, or the restore rejects): FAIL closed', async () => {
        expect(await runOfflineFault(scriptedIo({ onOffline: { openInBody: 0 }, onlineAfterRestore: false }).io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', restored: false });
        expect(await runOfflineFault(scriptedIo({ onOffline: { openInBody: 0 }, restoreRejects: true }).io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', restored: false });
    });
    it('going offline fails: restored and not exercised when online is proven; FAIL closed otherwise', async () => {
        expect(await runOfflineFault(scriptedIo({ offlineRejects: true }).io, gateOk, bound)).toMatchObject({ kind: 'not-exercised', restored: true });
        expect(await runOfflineFault(scriptedIo({ offlineRejects: true, onlineAfterRestore: null }).io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', restored: false });
    });
    it('a failure not bound to this attempt, or a lost log, under the fault: restored and FAIL closed', async () => {
        const lost = scriptedIo({});
        lost.io.phase = (() => { let n = 0; return async () => (++n === 1 ? 'in-setup' : 'unobserved'); })();
        expect(await runOfflineFault(lost.io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', reason: expect.stringMatching(/unobserved under the fault/) });
        const foreign = scriptedIo({});
        foreign.io.phase = (() => { let n = 0; return async () => (++n === 1 ? 'in-setup' : 'unattributed-failure'); })();
        expect(await runOfflineFault(foreign.io, gateOk, bound)).toMatchObject({ kind: 'fail-closed', restored: true });
    });
    it('the fault reached the transfer but the setup has not failed by the bound: exercised, unsettled; the poll sleeps', async () => {
        const t = scriptedIo({ onOffline: { openInBody: 0, failedUnderFault: 1 } });
        expect(await runOfflineFault(t.io, gateOk, bound)).toEqual({ kind: 'exercised', settled: false });
        expect(t.calls.filter((c) => c === 'phase').length).toBe(1 + bound.boundMs / bound.pollMs + 1);
        expect(t.calls).not.toContain('setOffline(false)');
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
        const index = src.indexOf('const pressIndex = (await page.evaluate(readRuntimeStateLog)');
        const press = src.indexOf("await page.getByTestId('mic-download').click();", index);
        const gate = src.indexOf('atOffline = await waitForTransfer(page, () => transfer.snapshot());', press);
        const run = src.indexOf('const offlineOutcome = await runOfflineFault({', gate);
        for (const [a, b] of [[index, press], [press, gate], [gate, run]]) { expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); }
        expect(src).toContain('phase: () => attemptPhaseOf(page, pressIndex),');
        expect(src).toContain('transfer: () => transfer.snapshot(),');
        expect(src).toContain("context.on('response', (r) => transfer.onResponse(r.request()));");
        expect(src).toContain("context.on('requestfinished', (r) => transfer.onFinished(r));");
        expect(src).toContain("context.on('requestfailed', (r) => transfer.onFailed(r));");
        expect(src.indexOf('transfer.startAttempt();')).toBeLessThan(src.indexOf("await page.getByTestId('mic-download').click();", src.indexOf('transfer.startAttempt();')));
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
    it('the transfer wait decides from the page AND the network (downloadingNow), polls every 50 ms, and settles on ready, recording or failure', () => {
        const src = aj();
        const wait = src.slice(src.indexOf('async function waitForTransfer('), src.indexOf('\n}\n', src.indexOf('async function waitForTransfer(')));
        expect(wait).toContain('read = await readModelBytes(page);');
        expect(wait).toContain('if (downloadingNow(read, transfer())) return read;');
        expect(wait).toContain('setTimeout(resolve, 50)');
        for (const st of ['READY', 'RECORDING', 'STOPPING', 'FAILED', 'TERMINATED']) expect(wait).toContain(`'${st}'`);
        expect(wait).not.toContain("'DOWNLOADING'"); // never published
        expect(src).toContain("getAttribute('data-runtime-state')");
    });
});

describe('AHT-12 is labelled a fresh-browser stand-in; the catalog case stays open (Sam, 2026-11-11)', () => {
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
    it('the recovery row carries the label and the open catalog case in its detail and evidence', () => {
        const row = src.slice(src.indexOf("receipt.row('after allowing the microphone a take saves'"));
        const call = row.slice(0, row.indexOf(');') + 2);
        expect(call).toContain('${AHT12_STAND_IN_LABEL}');
        expect(call).toContain('standIn: true');
        expect(call).toContain('catalogCaseOpen: AHT12_CATALOG_CASE_OPEN');
    });
    it('the catalog still asks three Starts for AHT-12 (not silently changed to two); the stand-in is designed for two', () => {
        expect(findCase(catalog)?.minimumStarts).toBe(3);
        expect(src).toContain("const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 2,");
    });
});
