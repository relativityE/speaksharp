// AHT-12/13/14 (fifteen-case front-run review, 2026-11-10): the adverse journey's recovery is judged at the harness's `ownSaved`
// bar, Retry waits for the model to reach ready before ONE Start (Retry never records), and the Start-press budgets cite every
// press the journey can make. Pure verdicts with their failing controls, plus source-order checks on rwtAdverseJourney.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    RECOVERY_CONTROLS, type RecoveryAttempt, type ReopenObservation, isRecoveryControl, recoverySavedVerdict, retrySetupOutcome,
    reviewReopenVerdict, savedTranscriptDigest,
} from '../live/helpers/rwtAdverseRecovery';
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
