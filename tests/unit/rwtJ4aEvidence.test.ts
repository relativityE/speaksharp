/**
 * J4.a evidence check (Sam, Nov 18). Each control must trip its own reason. The "gap" tests show what the existing save-retry
 * verdicts could not see, so the new checks are needed; J4.b evidence must never pass a J4.a verdict.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    COMPLETION_WRITTEN_COLUMNS, J4A_COACHING_MAXIMUM, J4A_COACHING_ROUTE, J4A_START_PRESS_BUDGET, j4aCoachingBlockedVerdict, j4aCoachingGuard, SAVED_ROW_AGREEMENT_COLUMNS, j4aNoSecondTakeVerdict,
    j4aOneSaveForAccountVerdict, j4aPrivacyCleanupVerdict, j4aRequestNeverReachedVerdict, saveRetryPrivacyVerdict,
    type J4aFaultObservation, type J4aSaveObservation,
} from '../live/helpers/rwtJ4aEvidence';
import { completionDropDisposition, savedTakeReadbackVerdict } from '../live/helpers/rwtSaveRetry';
import type { SavedRow } from '../live/helpers/rwtSaveRetryAttempts';
import { CONSENT_MODES, SAVE_RETRY_CONSENT_MODE } from '../live/helpers/rwtPracticeConsent';
import { SAVE_RETRY_REQUEST_LOST_SUITE, SAVE_RETRY_RESPONSE_LOST_SUITE, requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TAKE = '33333333-3333-4333-8333-333333333333';
const SECOND = '44444444-4444-4444-8444-444444444444';

const startRow = (): SavedRow => ({
    id: TAKE, user_id: OWNER, status: 'active', idempotency_key: 'key-1', lease_id: 'lease-1', duration: 12, status_reason: null,
    total_words: null, clarity_score: null, wpm: null, filler_counts: null, pause_metrics: null, next_action_signal: null,
    transcript: null, transcript_state: 'pending',
});
const savedRow = (over: Partial<SavedRow> = {}): SavedRow => ({
    ...startRow(), status: 'completed', duration: 14, total_words: 40, wpm: 120, filler_counts: {}, transcript: 'words', transcript_state: 'available', ...over,
});

const fault = (over: Partial<J4aFaultObservation> = {}): J4aFaultObservation => ({
    dropped: true, forwarded: false, droppedStatus: null, droppedSessionId: TAKE, startRow: startRow(),
    rowsBeforeRetry: [{ ...startRow(), duration: 30 }], ...over,
});
const save = (over: Partial<J4aSaveObservation> = {}): J4aSaveObservation => ({
    ownerId: OWNER, takeSessionId: TAKE, startIdempotencyKey: 'key-1', savedId: TAKE, ownerRows: [savedRow()],
    anyAccountById: [savedRow()], anyAccountByKey: [savedRow()], ...over,
});

describe('J4.a: the first save request never reached the server', () => {
    it('PASS: stopped in the browser, no answer, the take is still the active Start session (a heartbeat may move duration)', () => {
        expect(j4aRequestNeverReachedVerdict(fault())).toMatchObject({ status: 'PASS', reason: 'never_reached' });
    });
    it.each([
        ['no request was stopped', { dropped: false }, 'HOLD', 'fault_not_exercised'],
        ['the stopped request was forwarded to the server', { forwarded: true }, 'FAIL', 'request_reached_server'],
        ['the server answered the stopped request', { droppedStatus: 200 }, 'FAIL', 'request_reached_server'],
        ['the Start row was not read', { startRow: null }, 'HOLD', 'start_row_unread'],
        ['the stopped request named another session', { droppedSessionId: SECOND }, 'FAIL', 'fault_on_another_session'],
        ['the stopped request had no session id', { droppedSessionId: null }, 'FAIL', 'fault_on_another_session'],
        ['the rows could not be read', { rowsBeforeRetry: null }, 'HOLD', 'rows_unread'],
        ['the take was already saved', { rowsBeforeRetry: [savedRow()] }, 'FAIL', 'saved_before_retry'],
        ['no row is left for the take', { rowsBeforeRetry: [] }, 'FAIL', 'unexpected_rows'],
        ['a second row appeared', { rowsBeforeRetry: [startRow(), { ...startRow(), id: SECOND }] }, 'FAIL', 'unexpected_rows'],
        ['the take was marked failed', { rowsBeforeRetry: [{ ...startRow(), status: 'failed' }] }, 'FAIL', 'take_not_active'],
        ['the only row is another session', { rowsBeforeRetry: [{ ...startRow(), id: SECOND }] }, 'FAIL', 'take_not_active'],
        ['a transcript was written', { rowsBeforeRetry: [{ ...startRow(), transcript: 'words' }] }, 'FAIL', 'row_changed_before_retry'],
        ['metrics were written', { rowsBeforeRetry: [{ ...startRow(), total_words: 40 }] }, 'FAIL', 'row_changed_before_retry'],
        ['the lease changed', { rowsBeforeRetry: [{ ...startRow(), lease_id: 'lease-2' }] }, 'FAIL', 'row_changed_before_retry'],
    ] as const)('control: %s', (_name, change, status, reason) => {
        expect(j4aRequestNeverReachedVerdict(fault(change as never))).toMatchObject({ status, reason });
    });
    it('compares every column only a completion writes, and never duration', () => {
        expect(COMPLETION_WRITTEN_COLUMNS).not.toContain('duration');
        for (const column of COMPLETION_WRITTEN_COLUMNS) {
            const row = { ...startRow(), [column]: column === 'status' ? 'active' : 'changed' };
            if (column === 'status') continue;
            expect({ column, out: j4aRequestNeverReachedVerdict(fault({ rowsBeforeRetry: [row] })).status }).toEqual({ column, out: 'FAIL' });
        }
    });
    it('gap: the existing fault check passes a request that reached the server, as long as nothing was saved yet', () => {
        const forwarded = { completionPosts: 1, droppedStatus: 500, dropped: true };
        expect(completionDropDisposition('request-lost', forwarded, []).status).toBe('PASS');
        expect(j4aRequestNeverReachedVerdict(fault({ forwarded: true, droppedStatus: 500 })).status).toBe('FAIL');
    });
});

describe('J4.a: Retry Save saved one take for this account only', () => {
    it('PASS: one saved take, the lost one, under this account and no other', () => {
        expect(j4aOneSaveForAccountVerdict(save())).toMatchObject({ status: 'PASS', reason: 'one_save_this_account' });
    });
    it.each([
        ['the account is unknown', { ownerId: null }, 'HOLD', 'owner_unknown'],
        ['the take is unknown', { takeSessionId: null }, 'HOLD', 'take_unknown'],
        ['the account rows could not be read', { ownerRows: null }, 'HOLD', 'rows_unread'],
        ['the read by id failed', { anyAccountById: null }, 'HOLD', 'rows_unread'],
        ['the read by key failed', { anyAccountByKey: null }, 'HOLD', 'rows_unread'],
        ['the Start key is missing', { startIdempotencyKey: undefined }, 'HOLD', 'correlation_missing'],
        ['the Start key is null', { startIdempotencyKey: null }, 'HOLD', 'correlation_missing'],
        ['the Start key is empty', { startIdempotencyKey: '' }, 'HOLD', 'correlation_missing'],
        ['the Start key is blank', { startIdempotencyKey: '   ' }, 'HOLD', 'correlation_missing'],
        ['the Start key is not a string', { startIdempotencyKey: 42 }, 'HOLD', 'correlation_missing'],
        ['the take id is malformed', { takeSessionId: 'take-1' }, 'HOLD', 'correlation_missing'],
        ['zero saves', { ownerRows: [startRow()], anyAccountById: [startRow()], anyAccountByKey: [startRow()] }, 'FAIL', 'zero_saves'],
        ['zero rows', { ownerRows: [], anyAccountById: [], anyAccountByKey: [] }, 'FAIL', 'zero_saves'],
        ['duplicate saves in the account', { ownerRows: [savedRow(), savedRow({ id: SECOND, idempotency_key: 'key-2' })] }, 'FAIL', 'duplicate_saves'],
        ['a saved take plus a leftover active row', { ownerRows: [savedRow(), { ...startRow(), id: SECOND }] }, 'FAIL', 'duplicate_saves'],
        ['the same key saved twice across rows', { anyAccountByKey: [savedRow(), savedRow({ id: SECOND })] }, 'FAIL', 'duplicate_saves'],
        ['the same id read twice', { anyAccountById: [savedRow(), savedRow()] }, 'FAIL', 'duplicate_saves'],
        ['the take was saved under another account', { ownerRows: [startRow()], anyAccountById: [savedRow({ user_id: OTHER })], anyAccountByKey: [savedRow({ user_id: OTHER })] }, 'FAIL', 'wrong_account'],
        ['a copy was saved under another account', { anyAccountByKey: [savedRow(), savedRow({ id: SECOND, user_id: OTHER })] }, 'FAIL', 'wrong_account'],
        ['an account row belongs to another account', { ownerRows: [savedRow({ user_id: OTHER })] }, 'FAIL', 'wrong_account'],
        ['another session was saved', { ownerRows: [savedRow({ id: SECOND })], anyAccountById: [savedRow({ id: SECOND })], anyAccountByKey: [savedRow({ id: SECOND })] }, 'FAIL', 'another_session_saved'],
        ['the page bound another session', { savedId: SECOND }, 'FAIL', 'page_bound_other'],
        ['the page bound nothing', { savedId: null }, 'FAIL', 'page_bound_other'],
        ['the read by id missed the take', { anyAccountById: [] }, 'FAIL', 'cross_account_read_mismatch'],
        ['the read by key missed the take (saved under another key)', { anyAccountByKey: [] }, 'FAIL', 'cross_account_read_mismatch'],
        ['the read by id disagrees with the owner read', { anyAccountById: [savedRow({ transcript: 'other words' })] }, 'FAIL', 'readbacks_disagree'],
        ['the read by key disagrees with the owner read', { anyAccountByKey: [savedRow({ wpm: 99 })] }, 'FAIL', 'readbacks_disagree'],
        ['the cross-account rows carry another key', { anyAccountById: [savedRow({ idempotency_key: 'key-9' })], anyAccountByKey: [savedRow({ idempotency_key: 'key-9' })] }, 'FAIL', 'readbacks_disagree'],
        ['the cross-account rows carry another duration', { anyAccountById: [savedRow({ duration: 99 })] }, 'FAIL', 'readbacks_disagree'],
    ] as const)('control: %s', (_name, change, status, reason) => {
        expect(j4aOneSaveForAccountVerdict(save(change as never))).toMatchObject({ status, reason });
    });
    it('gap: the existing one-session check reads this account only, so a copy under another account passes it', () => {
        const facts = [{ id: TAKE, status: 'completed', hasIdempotencyKey: true, transcriptState: 'available', transcriptLength: 5 }];
        expect(savedTakeReadbackVerdict(facts, TAKE).status).toBe('PASS');
        expect(j4aOneSaveForAccountVerdict(save({ anyAccountByKey: [savedRow(), savedRow({ id: SECOND, user_id: OTHER })] })).status).toBe('FAIL');
    });
    it('the owner and cross-account reads must agree on every completion column, the id and the duration', () => {
        expect([...SAVED_ROW_AGREEMENT_COLUMNS]).toEqual(['id', ...COMPLETION_WRITTEN_COLUMNS, 'duration']);
    });
    it('fails before (Sam, Nov 18): with no Start key the old read was id-only, so a duplicate under another id passed', () => {
        // The old read merged the id read with a key read only when a key existed; with none it returned the id read alone.
        const idOnly = [savedRow()];
        expect(idOnly.length === 1 && idOnly[0].id === TAKE).toBe(true);
        expect(j4aOneSaveForAccountVerdict(save({ startIdempotencyKey: undefined }))).toMatchObject({ status: 'HOLD', reason: 'correlation_missing' });
        const spec = readFileSync('tests/live/rwt-save-retry-recovery.live.spec.ts', 'utf8');
        expect(spec).not.toContain("if (typeof idempotencyKey === 'string' && idempotencyKey.length > 0) {");
        expect(spec).toContain("if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') return null;");
        expect(spec).toMatch(/startIdempotencyKey,\s*savedId, ownerRows, anyAccountById: anyAccount\?\.byId \?\? null, anyAccountByKey: anyAccount\?\.byKey \?\? null \}\);/);
    });
});

describe('J4.a and J4.b keep separate verdicts', () => {
    it('J4.b evidence (the server saved, only the answer was lost) never passes the J4.a check', () => {
        const j4b = fault({ forwarded: true, droppedStatus: 200, rowsBeforeRetry: [savedRow()] });
        expect(j4aRequestNeverReachedVerdict(j4b)).toMatchObject({ status: 'FAIL', reason: 'request_reached_server' });
        expect(completionDropDisposition('response-lost', { completionPosts: 1, droppedStatus: 200, dropped: true }, [
            { id: TAKE, status: 'completed', hasIdempotencyKey: true, transcriptState: 'available', transcriptLength: 5 }]).status).toBe('PASS');
    });
    it('only the request-lost suite requires the J4.a rows; the response-lost suite (J4.b) is unchanged and carries none', () => {
        const j4a = ['practice privacy choice', 'J4.a: the first save request never reached the server', 'J4.a: Retry Save saved one take for this account only',
            'J4.a: one take, nothing after Retry', 'J4.a: cleanup removed the privacy choice'];
        const lost = requiredAutomatedRows(SAVE_RETRY_REQUEST_LOST_SUITE)!;
        const response = requiredAutomatedRows(SAVE_RETRY_RESPONSE_LOST_SUITE)!;
        for (const row of j4a) {
            expect(lost.product).toContain(row);
            expect(response.product).not.toContain(row);
        }
        // J4.a stops after the Retry readback: the second-take rows are J4.b's only, and J4.a must not carry them.
        for (const row of ['next take saves only itself', 'review reopens the saved take']) {
            expect(lost.product).not.toContain(row);
            expect(lost.absent).toContain(row);
            expect(response.product).toContain(row);
        }
        expect(response.product).toEqual(expect.arrayContaining(['Retry Save leaves one saved session', 'Retry Save saved the exact payload once',
            'completion attempts are the fault and one Retry', 'coaching request budget']));
    });
    it('the spec writes the J4.a rows for request lost only, and marks only the response-lost request as forwarded', () => {
        const spec = readFileSync('tests/live/rwt-save-retry-recovery.live.spec.ts', 'utf8');
        expect(spec).toContain("const j4a = variant === 'request-lost';");
        const gated = spec.split('if (j4a) {');
        expect(gated.length).toBe(7);
        expect(gated[1]).toContain("row('J4.a: one take, nothing after Retry'");
        expect(gated[2]).toContain("row('J4.a: cleanup removed the privacy choice'");
        expect(gated[3]).toContain('await page.context().route(J4A_COACHING_ROUTE, (route) => coachingGuard.handler(route));');
        expect(gated[4]).toContain("receipt.row('practice privacy choice'");
        expect(gated[5]).toContain("receipt.row('J4.a: the first save request never reached the server'");
        expect(gated[6]).toContain("receipt.row('J4.a: Retry Save saved one take for this account only'");
        expect(spec.indexOf('drop.forwarded = true;')).toBeGreaterThan(spec.indexOf("if (variant === 'request-lost') return route.abort('failed');"));
        expect(spec.indexOf('drop.forwarded = true;')).toBeLessThan(spec.indexOf('const response = await route.fetch();'));
    });
});

describe('J4.a bounds (Sam, Nov 19; PO: one take, coaching off): stop after the Retry readback', () => {
    const spec = readFileSync('tests/live/rwt-save-retry-recovery.live.spec.ts', 'utf8');
    it('one Start press in all (the faulted take), never the review\'s Practice again; zero coaching requests', () => {
        expect(J4A_START_PRESS_BUDGET).toEqual({ total: 1, perControl: { 'mic-download': 1, 'mic-start': 1 } });
        expect(J4A_COACHING_MAXIMUM).toBe(0);
        expect(spec).toContain('j4a ? J4A_START_PRESS_BUDGET : SAVE_RETRY_START_PRESS_BUDGET');
        expect(spec).toContain('{ maximum: j4a ? J4A_COACHING_MAXIMUM : 2, oneRequestPerSession: takes }');
    });
    it('fails before (Sam, Nov 19): J4.a returns right after its Retry readback, before the second take and the Analytics reopen', () => {
        const ret = spec.indexOf('            return;\n        }\n\n        // The next Start');
        expect(ret).toBeGreaterThan(spec.indexOf("receipt.row('J4.a: Retry Save saved one take for this account only'"));
        expect(ret).toBeLessThan(spec.indexOf("const again = page.getByTestId('verdict-practice-again');"));
        expect(ret).toBeLessThan(spec.indexOf('await reopenFromAnalytics('));
    });
    it('the one-take check runs at the final boundary (after every owned page closed), before cleanup', () => {
        const one = spec.indexOf("await steps.step('J4.a one take'");
        expect(one).toBeGreaterThan(spec.indexOf("await steps.step('owned pages closed'"));
        expect(one).toBeLessThan(spec.indexOf('accountDeleted = (await finalizeOwnedCleanup('));
        const gone = spec.indexOf("await steps.step('J4.a privacy choice cleanup'");
        expect(gone).toBeGreaterThan(spec.indexOf('accountDeleted = (await finalizeOwnedCleanup('));
        expect(spec).toContain(".from('practice_privacy_choices').select('user_id', { count: 'exact', head: true }).eq('user_id', owner.uid)");
    });

    const take = (over: Partial<SavedRow> = {}) => savedRow({ ...over });
    const one = (over: Partial<Parameters<typeof j4aNoSecondTakeVerdict>[0]> = {}) => j4aNoSecondTakeVerdict({
        takeSessionId: TAKE, ownerRows: [take()], attemptSessionIds: [TAKE, TAKE], ...over });
    it('PASS: exactly the one saved take and no save request for another session', () => {
        expect(one()).toMatchObject({ status: 'PASS', reason: 'one_take' });
    });
    it.each([
        ['a second take was started (active row)', { ownerRows: [take(), savedRow({ id: SECOND, status: 'active' })] }, 'FAIL', 'second_take'],
        ['a second take was saved', { ownerRows: [take(), savedRow({ id: SECOND })] }, 'FAIL', 'second_take'],
        ['a save request was sent for another session', { attemptSessionIds: [TAKE, TAKE, SECOND] }, 'FAIL', 'second_take_save'],
        ['an unreadable save request body', { attemptSessionIds: [TAKE, null] }, 'FAIL', 'second_take_save'],
        ['the one take is not saved', { ownerRows: [take({ status: 'active' })] }, 'FAIL', 'take_not_saved'],
        ['no row at all', { ownerRows: [] }, 'FAIL', 'take_not_saved'],
        ['rows unread', { ownerRows: null }, 'HOLD', 'rows_unread'],
        ['take unknown', { takeSessionId: null }, 'HOLD', 'take_unknown'],
    ] as const)('control: %s', (_name, change, status, reason) => {
        expect(one(change as never)).toMatchObject({ status, reason });
    });

    const gone = (over: Partial<Parameters<typeof j4aPrivacyCleanupVerdict>[0]> = {}) => j4aPrivacyCleanupVerdict({
        ownerId: OWNER, choiceVerified: true, accountDeleted: true, count: 0, readError: false, ...over });
    it('PASS: the owner\'s privacy choice row is a counted zero after the verified deletion', () => {
        expect(gone()).toMatchObject({ status: 'PASS', reason: 'privacy_row_gone' });
    });
    it.each([
        ['the privacy row survived', { count: 1 }, 'FAIL', 'privacy_row_left'],
        ['an uncounted read', { count: null }, 'HOLD', 'residue_uncounted'],
        ['a negative count', { count: -1 }, 'HOLD', 'residue_uncounted'],
        ['a fractional count', { count: 0.5 }, 'HOLD', 'residue_uncounted'],
        ['the read failed', { readError: true }, 'HOLD', 'residue_unread'],
        ['the account was not deleted', { accountDeleted: false }, 'HOLD', 'account_not_deleted'],
        ['no verified choice', { choiceVerified: false }, 'HOLD', 'choice_unverified'],
        ['owner unknown', { ownerId: null }, 'HOLD', 'choice_unverified'],
    ] as const)('control: %s', (_name, change, status, reason) => {
        expect(gone(change as never)).toMatchObject({ status, reason });
    });
});

describe('#1835: J4.a opts its own account in to saving before Start, on the post-#1835 build only (Sam, Nov 18-19)', () => {
    const spec = readFileSync('tests/live/rwt-save-retry-recovery.live.spec.ts', 'utf8');
    it('the fixed choice is Save: Yes, Coaching: No', () => {
        expect(CONSENT_MODES[SAVE_RETRY_CONSENT_MODE]).toEqual({ transcriptSave: true, aiCoaching: false });
    });
    it('the choice is settled and read back on the Practice page before any Start, and is never taken from the environment', () => {
        const settle = spec.indexOf('await settlePracticeConsent(');
        expect(settle).toBeGreaterThan(spec.indexOf("await page.goto('/practice');"));
        expect(settle).toBeLessThan(spec.indexOf("await openProductsItem(page, 'open-mic');"));
        expect(settle).toBeLessThan(spec.indexOf('await startBenchmarkRecording('));
        expect(settle).toBeLessThan(spec.indexOf('await preparePrivateModelIfPrompted('));
        expect(spec).toContain('mode: SAVE_RETRY_CONSENT_MODE });');
        expect(spec).not.toMatch(/consentModeFrom|RWT_PRACTICE_CONSENT/);
    });
    it('fails before (Sam, Nov 19): the row was written as PASS with no choice, and a legacy build went on to record', () => {
        expect(spec).not.toContain("receipt.row('practice privacy choice', 'PASS'");
        expect(spec).toContain("receipt.row('practice privacy choice', privacy.status, privacy.detail,");
        // ANY verdict but PASS, a pre-#1835 build included, stops before Open Mic.
        expect(spec).toContain("if (privacy.status !== 'PASS') throw new Error(`HOLD practice consent: ${privacy.reason}`);");
        expect(spec).not.toContain("consent.build === 'includes_1835' && privacy.status !== 'PASS'");
    });
    it('the owner consent is read back again right before Start, and a failed readback stops before any take', () => {
        const read = spec.indexOf('await readPracticeChoice(');
        expect(read).toBeGreaterThan(spec.indexOf('await settlePracticeConsent('));
        expect(read).toBeLessThan(spec.indexOf("await openProductsItem(page, 'open-mic');"));
        expect(spec.indexOf('throw new Error(`HOLD practice consent: ${privacy.reason}`)')).toBeLessThan(spec.indexOf("await openProductsItem(page, 'open-mic');"));
        expect(spec.indexOf('j4aChoiceVerified = true;')).toBeGreaterThan(spec.indexOf('throw new Error(`HOLD practice consent: ${privacy.reason}`)'));
    });
});

describe('#1835: the required privacy row PASSes only on the exact post-#1835 owner readback (Sam, Nov 18-19)', () => {
    const row = (over: Record<string, unknown> = {}) => ({ user_id: OWNER, transcript_save: true, ai_coaching: false, consent_version: 1, ...over });
    const verdict = (over: Partial<Parameters<typeof saveRetryPrivacyVerdict>[0]> = {}) => saveRetryPrivacyVerdict({
        build: 'includes_1835', mode: SAVE_RETRY_CONSENT_MODE, readback: { state: 'read', row: row() }, ownerId: OWNER, ...over });
    it('PASS: post-#1835 build, Save: Yes / Coaching: No, read back as exactly that for this owner', () => {
        expect(verdict()).toMatchObject({ status: 'PASS', reason: 'save_yes_coaching_no' });
    });
    it.each([
        ['a pre-#1835 build shows no privacy prompt', { build: 'predates_1835' as const, readback: null }, 'FAIL', 'legacy_build'],
        ['a pre-#1835 build even with a readback', { build: 'predates_1835' as const }, 'FAIL', 'legacy_build'],
        ['an unknown build', { build: 'unknown' as const }, 'HOLD', 'build_unknown'],
        ['another mode was chosen', { mode: 'save_on_coaching_on' as const }, 'FAIL', 'wrong_mode'],
        ['no mode', { mode: null }, 'FAIL', 'wrong_mode'],
        ['the readback was not taken', { readback: null }, 'HOLD', 'readback_missing'],
        ['the owner is unknown', { ownerId: null }, 'HOLD', 'readback_missing'],
        ['the readback was unreadable', { readback: { state: 'unreadable' as const } }, 'HOLD', 'readback_unreadable'],
        ['the choice row is missing', { readback: { state: 'read' as const, row: null } }, 'FAIL', 'readback_missing'],
        ['the choice table is absent', { readback: { state: 'absent' as const } }, 'FAIL', 'readback_missing'],
        ['the row is another owner\'s', { readback: { state: 'read' as const, row: row({ user_id: OTHER }) } }, 'FAIL', 'readback_wrong_owner'],
        ['coaching was recorded on', { readback: { state: 'read' as const, row: row({ ai_coaching: true }) } }, 'FAIL', 'readback_differs'],
        ['saving was recorded off', { readback: { state: 'read' as const, row: row({ transcript_save: false }) } }, 'FAIL', 'readback_differs'],
        ['the row is malformed', { readback: { state: 'read' as const, row: row({ consent_version: 2 }) } }, 'FAIL', 'readback_malformed'],
    ] as const)('control: %s', (_name, change, status, reason) => {
        expect(verdict(change as never)).toMatchObject({ status, reason });
    });
});

describe('J4.a coaching block (Sam, Nov 19 on c558f4c): an unexpected coaching call never leaves the browser', () => {
    const spec = readFileSync('tests/live/rwt-save-retry-recovery.live.spec.ts', 'utf8');
    const fakeRoute = () => {
        const calls: string[] = [];
        return { calls, route: {
            abort: async (code?: string) => { calls.push(`abort:${code}`); },
            continue: async () => { calls.push('continue'); },
            fulfill: async () => { calls.push('fulfill'); },
            fetch: async () => { calls.push('fetch'); },
        } };
    };
    it('the guard aborts every request it sees, counts it, and never lets one through', async () => {
        const guard = j4aCoachingGuard();
        const a = fakeRoute(); const b = fakeRoute();
        await guard.handler(a.route); await guard.handler(b.route);
        expect(a.calls).toEqual(['abort:blockedbyclient']);
        expect(b.calls).toEqual(['abort:blockedbyclient']);
        expect(guard.blocked).toBe(2);
    });
    it('the route covers the coaching endpoint with any query, on the whole browser context', () => {
        expect(J4A_COACHING_ROUTE).toBe('**/functions/v1/get-ai-suggestions**');
        expect(spec).toContain('await page.context().route(J4A_COACHING_ROUTE, (route) => coachingGuard.handler(route));');
        // Armed before the first page of the run (account sign-up), after the click recorder.
        const armed = spec.indexOf('coachingGuard.armed = true;');
        expect(armed).toBeGreaterThan(spec.indexOf('await parity.attach(page.context());'));
        expect(armed).toBeLessThan(spec.indexOf('claimed = await prepareRunOwnedAccount('));
        expect(spec).not.toMatch(/unroute\(J4A_COACHING_ROUTE/);
    });
    it.each([
        [{ armed: false, blocked: 0 }, 'HOLD', 'block_not_armed'],
        [{ armed: true, blocked: -1 }, 'HOLD', 'block_uncounted'],
        [{ armed: true, blocked: 1.5 }, 'HOLD', 'block_uncounted'],
        [{ armed: true, blocked: 1 }, 'FAIL', 'coaching_requested'],
        [{ armed: true, blocked: 3 }, 'FAIL', 'coaching_requested'],
        [{ armed: true, blocked: 0 }, 'PASS', 'none_requested'],
    ] as const)('%o → %s %s', (o, status, reason) => {
        expect(j4aCoachingBlockedVerdict(o)).toMatchObject({ status, reason });
    });
    it('the block row is J4.a-only, required for request lost, and written at the final boundary', () => {
        expect(spec).toContain("if (j4a) await steps.step('J4.a coaching blocked'");
        expect(spec.indexOf("await steps.step('J4.a coaching blocked'")).toBeGreaterThan(spec.indexOf("await steps.step('coaching budget'"));
        expect(requiredAutomatedRows(SAVE_RETRY_REQUEST_LOST_SUITE)!.product).toContain('J4.a: no coaching request left the browser');
        expect(requiredAutomatedRows(SAVE_RETRY_RESPONSE_LOST_SUITE)!.product).not.toContain('J4.a: no coaching request left the browser');
    });
});
