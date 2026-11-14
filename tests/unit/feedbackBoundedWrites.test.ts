// @vitest-environment node
/**
 * AHT-07 bounded production writes (Sam's one-run limit, 2026-11-11): one disposable account, two Starts, two sessions, at most
 * 7 feedback insert attempts and at most 4 stored reports, exact run-owned cleanup and independent residue verification.
 * PASS / FAIL / HOLD controls for the pre-send cap, the three fault legs, the final-boundary ledger, the final submit's isolation
 * and the race-safe report cleanup; then source-order checks of the spec's wiring, and that AHT-08's path is untouched.
 */
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    FEEDBACK_ATTEMPT_CAP, FEEDBACK_BOUNDED_WRITE_ROWS, FEEDBACK_CAP_ROW, FEEDBACK_ERROR_COPY, FEEDBACK_FAULT_LEGS, FEEDBACK_ISOLATION_ROW,
    FEEDBACK_LEDGER_ROW, FEEDBACK_LEG_ROWS, FEEDBACK_REPORT_CAP, FeedbackAttemptLedger, type FeedbackAttempt, type FeedbackFaultLeg,
    type LegObservation, type RowVerdict, capDecision, feedbackCapVerdict, feedbackLedgerVerdict, feedbackLegRecovered, feedbackLegRows,
    finalIsolationVerdict, isNamedIdempotencyReplay, stableDraftSha, stickyFinalVerdict, syntheticRejection, withoutFaultLegSubmits,
    writeFeedbackAttemptRows,
} from '../live/helpers/feedbackAttemptLedger';
import {
    type CapturedReports, type ReportCleanupAdmin, type WriteUncertainty, ZERO_RESIDUE_ROW, captureRunReports, cleanupRunReports, mergeCapture,
    writeUncertainty, zeroResidueNotRun,
    zeroResidueVerdict,
} from '../live/helpers/feedbackReportCleanup';
import {
    FeedbackRecoveryInventory, RECOVERY_DIR_ENV, RECOVERY_SCHEMA, RECOVERY_STORE_MARKER, RECOVERY_STORE_SCHEMA, RECOVERY_STORE_STEP, type VerifiedStore,
    readRecoveryInventory, recordDurably, recoverFromInventory, recoveryFileName, settleRecoveryInventory, unresolvedAttempts, verifyRecoveryStore,
} from '../live/helpers/feedbackRecoveryInventory';
import { FEEDBACK_NO_SESSION_SUITE, FEEDBACK_OLDER_TAKE_SUITE, type ReadbackActionBinding, requiredAutomatedRows } from '../live/helpers/rwtAcceptance';
import { bindReadbackJourneys } from '../live/helpers/rwtOracles';

const here = path.dirname(fileURLToPath(import.meta.url));
const harnessFault = createRequire(import.meta.url)(path.resolve(here, '../../tools/cloud-test/harness/bundle/harness/feedback-fault.cjs')) as {
    isReplay: (error: unknown, key: string) => boolean; MODES: readonly string[];
};

const USER = '33333333-3333-4333-8333-333333333333';
const OLD = '11111111-1111-4111-8111-111111111111';
const K = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'];
const body = (key: string | null, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
    user_id: USER, session_id: OLD, category: 'bug', severity: 'high', title: 't', description: 'Automated RWT feedback retry control.',
    page_url: '/progress', include_audio: false, audio_attachment_note: null, idempotency_key: key,
    metadata: { feedback_type: 'broke', feedback_kind: 'issue', feedback_severity: null, releaseId: 'r', sentryLastEventId: null, ...meta }, ...over,
});
const replay409 = (key: string) => JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "user_issue_reports_idempotency_key_unique"', details: `Key (idempotency_key)=(${key}) already exists.`, hint: null });

/** What the spec's route does with each attempt's action, as the real server would answer. */
function settleAsServer(l: FeedbackAttemptLedger, a: FeedbackAttempt, stored: Set<string>): void {
    if (a.action === 'cap-abort' || a.action === 'fault-request-lost') return l.settle(a, { status: null, forwarded: false });
    if (a.action === 'fault-synthetic-42501') return l.settle(a, { status: 403, forwarded: false });
    const key = a.keys[0];
    if (stored.has(key)) return l.settle(a, { status: 409, forwarded: true, replayNamed: isNamedIdempotencyReplay(replay409(key), key) });
    stored.add(key);
    return l.settle(a, { status: 201, forwarded: true });
}

/** The designed run: each leg's fault and one same-key Retry (operational metadata rebuilt on Retry), then one final submit. */
function canonicalRun(): { ledger: FeedbackAttemptLedger; stored: Set<string> } {
    const ledger = new FeedbackAttemptLedger();
    const stored = new Set<string>();
    FEEDBACK_FAULT_LEGS.forEach((leg, i) => {
        ledger.armLeg(leg);
        settleAsServer(ledger, ledger.admit('POST', () => body(K[i], { description: leg })), stored);
        ledger.markRetry();
        settleAsServer(ledger, ledger.admit('POST', () => body(K[i], { description: leg }, { sentryLastEventId: 'rebuilt-on-retry' })), stored);
        ledger.endWindow();
    });
    ledger.beginFinal();
    settleAsServer(ledger, ledger.admit('POST', () => body(K[3], { description: 'final' })), stored);
    ledger.endWindow();
    return { ledger, stored };
}

describe('the pre-send cap (decided before the write leaves the browser)', () => {
    it('admits 7 attempts under 4 keys; the 8th is refused whatever it carries', () => {
        expect(capDecision({ seen: 6, admittedKeys: K.slice(0, 4) }, { method: 'POST', keys: [K[3]], unattributed: 0 })).toBeNull();
        expect(capDecision({ seen: 7, admittedKeys: K.slice(0, 4) }, { method: 'POST', keys: [K[0]], unattributed: 0 })).toBe('attempt-cap');
        expect(capDecision({ seen: 12, admittedKeys: [] }, { method: 'POST', keys: [K[0]], unattributed: 0 })).toBe('attempt-cap');
    });
    it('a fifth distinct key, an unkeyed or unreadable insert, and any non-insert write are refused', () => {
        expect(capDecision({ seen: 4, admittedKeys: K.slice(0, 4) }, { method: 'POST', keys: [K[4]], unattributed: 0 })).toBe('report-cap');
        expect(capDecision({ seen: 4, admittedKeys: K.slice(0, 4) }, { method: 'POST', keys: [K[2]], unattributed: 0 })).toBeNull();
        expect(capDecision({ seen: 0, admittedKeys: [] }, { method: 'POST', keys: [K[0]], unattributed: 1 })).toBe('unattributed-insert');
        expect(capDecision({ seen: 0, admittedKeys: [] }, { method: 'POST', keys: [], unattributed: 1 })).toBe('unattributed-insert');
        expect(capDecision({ seen: 0, admittedKeys: [] }, { method: 'PATCH', keys: [K[0]], unattributed: 0 })).toBe('not-an-insert');
        expect(capDecision({ seen: 0, admittedKeys: [] }, { method: 'POST', keys: [K[0], K[1], K[2], K[3], K[4]], unattributed: 0 })).toBe('report-cap');
    });
    it('the ledger records every write at entry, the capped ones too, and an aborted key never counts as admitted', () => {
        const { ledger, stored } = canonicalRun();
        expect(ledger.attempts).toHaveLength(FEEDBACK_ATTEMPT_CAP);
        expect(ledger.admittedKeys).toHaveLength(FEEDBACK_REPORT_CAP);
        const eighth = ledger.admit('POST', () => body(K[0]));
        settleAsServer(ledger, eighth, stored);
        expect(eighth).toMatchObject({ ordinal: 8, action: 'cap-abort', capReason: 'attempt-cap', window: 'outside', forwarded: false });
        const l2 = new FeedbackAttemptLedger();
        for (const k of K.slice(0, 4)) l2.admit('POST', () => body(k));
        expect(l2.admit('POST', () => body(K[4]))).toMatchObject({ action: 'cap-abort', capReason: 'report-cap' });
        expect(l2.admittedKeys).toHaveLength(4);
        expect(l2.seenKeys).toHaveLength(5);
        expect(l2.admit('POST', () => { throw new Error('unreadable'); })).toMatchObject({ action: 'cap-abort', capReason: 'unattributed-insert', unattributed: 1 });
    });
    it('a leg faults only its first admitted insert; the Retry and the final are forwarded untouched', () => {
        const { ledger } = canonicalRun();
        expect(ledger.attempts.map((a) => `${a.window}:${a.leg ?? '-'}:${a.action}:${a.afterRetryMark}`)).toEqual([
            'leg:synthetic-42501:fault-synthetic-42501:false', 'leg:synthetic-42501:forward:true',
            'leg:request-lost:fault-request-lost:false', 'leg:request-lost:forward:true',
            'leg:stored-response-lost:fault-stored-response-lost:false', 'leg:stored-response-lost:forward:true',
            'final:-:forward:false',
        ]);
    });
    it('the leg modes are the harness feedback-fault modes (request-lost is its transport-before-send)', () => {
        expect([...harnessFault.MODES].sort()).toEqual(['stored-response-lost', 'synthetic-42501', 'transport-before-send']);
        expect(FEEDBACK_FAULT_LEGS).toEqual(['synthetic-42501', 'request-lost', 'stored-response-lost']);
    });
});

describe('feedback attempts within the cap', () => {
    it('the designed run → PASS', () => expect(feedbackCapVerdict(canonicalRun().ledger.attempts).verdict).toBe('PASS'));
    it('any write aborted by the cap → FAIL, naming the reason', () => {
        const { ledger, stored } = canonicalRun();
        settleAsServer(ledger, ledger.admit('POST', () => body(K[0])), stored);
        expect(feedbackCapVerdict(ledger.attempts)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/attempt-cap/) });
    });
    it('the route never saw the final submit → HOLD', () => {
        const { ledger } = canonicalRun();
        expect(feedbackCapVerdict(ledger.attempts.filter((a) => a.window !== 'final')).verdict).toBe('HOLD');
    });
    it('evidence is counts and closed codes, never a key', () => {
        const v = feedbackCapVerdict(canonicalRun().ledger.attempts);
        expect(JSON.stringify(v.evidence)).not.toMatch(/aaaaaaaa/);
        expect(v.evidence).toMatchObject({ attempts: 7, admittedKeys: 4, capAborted: 0, attemptCap: 7, reportCap: 4 });
    });
});

describe('the exact ledger at the final boundary (harness classifyAttempt: 2 per leg, 1 final)', () => {
    it('the designed 7 → PASS', () => expect(feedbackLedgerVerdict(canonicalRun().ledger.attempts).verdict).toBe('PASS'));
    it('an extra, outside, early, re-keyed or changed attempt → FAIL', () => {
        const extra = canonicalRun().ledger;
        extra.armLeg('request-lost'); extra.markRetry(); extra.admit('POST', () => body(K[1], { description: 'request-lost' }));
        expect(feedbackLedgerVerdict(extra.attempts)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/cap|3 inserts/) });
        const third = new FeedbackAttemptLedger();
        third.armLeg('synthetic-42501');
        third.admit('POST', () => body(K[0])); third.markRetry(); third.admit('POST', () => body(K[0])); third.admit('POST', () => body(K[0]));
        expect(feedbackLedgerVerdict(third.attempts)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/sent 3 inserts/) });
        const late = canonicalRun().ledger;
        late.attempts.push({ ...late.attempts[6], ordinal: 8, window: 'outside', action: 'forward' });
        expect(feedbackLedgerVerdict(late.attempts)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/outside/) });
        const early = canonicalRun().ledger.attempts.map((a) => (a.ordinal === 2 ? { ...a, afterRetryMark: false } : a));
        expect(feedbackLedgerVerdict(early)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/before the explicit Retry/) });
        const rekeyed = canonicalRun().ledger.attempts.map((a) => (a.ordinal === 4 ? { ...a, keys: [K[4]] } : a));
        expect(feedbackLedgerVerdict(rekeyed)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/idempotency key/) });
        const changed = canonicalRun().ledger.attempts.map((a) => (a.ordinal === 6 ? { ...a, draftSha: 'x' } : a));
        expect(feedbackLedgerVerdict(changed)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/changed the draft/) });
        const twoFinals = canonicalRun().ledger;
        twoFinals.attempts.push({ ...twoFinals.attempts[6], ordinal: 8 });
        expect(feedbackLedgerVerdict(twoFinals.attempts)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/final submit sent 2/) });
    });
    it('a stored-response-lost Retry that STORED again (201) is the idempotency contradiction → FAIL', () => {
        const a = canonicalRun().ledger.attempts.map((x) => (x.ordinal === 6 ? { ...x, status: 201, replayNamed: null } : x));
        expect(feedbackLedgerVerdict(a)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/second row/) });
    });
    it('a missing Retry, a missing final, an unanswered or unexpected answer → HOLD (no extra attempt was observed)', () => {
        expect(feedbackLedgerVerdict(canonicalRun().ledger.attempts.filter((a) => a.ordinal !== 4)).verdict).toBe('HOLD');
        expect(feedbackLedgerVerdict(canonicalRun().ledger.attempts.filter((a) => a.window !== 'final')).verdict).toBe('HOLD');
        expect(feedbackLedgerVerdict(canonicalRun().ledger.attempts.map((a) => (a.ordinal === 2 ? { ...a, settled: false, status: null } : a))).verdict).toBe('HOLD');
        expect(feedbackLedgerVerdict(canonicalRun().ledger.attempts.map((a) => (a.ordinal === 6 ? { ...a, replayNamed: false } : a))).verdict).toBe('HOLD');
        expect(feedbackLedgerVerdict(canonicalRun().ledger.attempts.map((a) => (a.ordinal === 5 ? { ...a, status: 500 } : a))).verdict).toBe('HOLD');
    });
    it('an observed FAIL stays FAIL at the final boundary; otherwise the final verdict stands', () => {
        const pass = feedbackLedgerVerdict(canonicalRun().ledger.attempts);
        const failed: RowVerdict = { verdict: 'FAIL', detail: 'a leg sent 3 inserts' };
        expect(stickyFinalVerdict(failed, pass)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/observed before the final boundary/) });
        expect(stickyFinalVerdict(failed, { verdict: 'HOLD', detail: 'x' }).verdict).toBe('FAIL');
        expect(stickyFinalVerdict({ verdict: 'PASS', detail: 'x' }, { verdict: 'HOLD', detail: 'late' }).verdict).toBe('HOLD');
        expect(stickyFinalVerdict(null, pass).verdict).toBe('PASS');
        // A late attempt after the body's PASS is judged by the final ledger.
        const late = canonicalRun().ledger;
        late.attempts.push({ ...late.attempts[6], ordinal: 8, window: 'outside' });
        expect(stickyFinalVerdict(pass, feedbackLedgerVerdict(late.attempts)).verdict).toBe('FAIL');
    });
    it('both rows are written, cap first', () => {
        const rows: string[] = [];
        writeFeedbackAttemptRows({ row: (step, verdict) => { rows.push(`${step}=${verdict}`); } }, canonicalRun().ledger.attempts, null);
        expect(rows).toEqual([`${FEEDBACK_CAP_ROW}=PASS`, `${FEEDBACK_LEDGER_ROW}=PASS`]);
    });
});

describe('the Retry is compared on the persisted draft, as the harness stableDraft does', () => {
    it('rebuilt operational metadata keeps the draft; an edited description or session does not', () => {
        expect(stableDraftSha(body(K[0]))).toBe(stableDraftSha(body(K[0], {}, { sentryLastEventId: 'later', timezone: 'x' })));
        expect(stableDraftSha(body(K[0]))).not.toBe(stableDraftSha(body(K[0], { description: 'edited' })));
        expect(stableDraftSha(body(K[0]))).not.toBe(stableDraftSha(body(K[0], { session_id: null })));
        expect(stableDraftSha([body(K[0]), body(K[1])])).toBeNull();
        expect(stableDraftSha('x')).toBeNull();
    });
});

describe('the named idempotency replay agrees with the harness isReplay', () => {
    const cases: [string, unknown][] = [
        ['named, empty details', { code: '23505', message: 'duplicate key value violates unique constraint "user_issue_reports_idempotency_key_unique"', details: '' }],
        ['named, this key', JSON.parse(replay409(K[0]))],
        ['named, another key', JSON.parse(replay409(K[1]))],
        ['another index', { code: '23505', message: 'duplicate key value violates unique constraint "other_unique"', details: '' }],
        ['another code', { code: '42501', message: '"user_issue_reports_idempotency_key_unique"', details: '' }],
    ];
    for (const [name, error] of cases) {
        it(`${name}: agrees with the harness`, () => expect(isNamedIdempotencyReplay(JSON.stringify(error), K[0])).toBe(harnessFault.isReplay(error, K[0])));
    }
    it('an unreadable or absent body, or no key → not a replay', () => {
        expect(isNamedIdempotencyReplay('not json', K[0])).toBe(false);
        expect(isNamedIdempotencyReplay(null, K[0])).toBe(false);
        expect(isNamedIdempotencyReplay(replay409(K[0]), null)).toBe(false);
    });
    it('the synthetic 42501 is a labelled 403 control the cross-origin page can read', () => {
        const r = syntheticRejection('https://app.example');
        expect(r).toMatchObject({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://app.example' } });
        expect(JSON.parse(r.body)).toMatchObject({ code: '42501', message: expect.stringMatching(/^RWT SYNTHETIC CONTROL/) });
        expect(syntheticRejection(undefined).headers['access-control-allow-origin']).toBe('*');
    });
});

const goodObs = (over: Partial<LegObservation> = {}): LegObservation => ({
    alertShown: true, alertText: FEEDBACK_ERROR_COPY, dialogVisible: true, descriptionKept: true, typeKept: true, sessionKept: true, submitEnabled: true,
    freshBeforeRetry: 0, retried: true, dialogDetachedAfterRetry: true, freshAfterRetry: 1, storedRows: 1, storedSessionMatches: true,
    serviceErrors: 0, telemetry: { attempted: 2, storageFailed: 1, storageOk: 1 }, ...over,
});
const legRows = (leg: FeedbackFaultLeg, o: LegObservation, attempts = canonicalRun().ledger.legAttempts(leg)) =>
    Object.fromEntries(feedbackLegRows(leg, o, attempts).map((r) => [r.step, r.verdict]));
const verdictOf = (leg: FeedbackFaultLeg, key: keyof typeof FEEDBACK_LEG_ROWS[FeedbackFaultLeg], o: LegObservation, attempts?: FeedbackAttempt[]) =>
    legRows(leg, o, attempts)[FEEDBACK_LEG_ROWS[leg][key]];

describe('per-leg rows', () => {
    for (const leg of FEEDBACK_FAULT_LEGS) {
        it(`${leg}: the designed leg → seven PASS rows, in order`, () => {
            const rows = feedbackLegRows(leg, goodObs(), canonicalRun().ledger.legAttempts(leg));
            expect(rows.map((r) => r.step)).toEqual(Object.values(FEEDBACK_LEG_ROWS[leg]));
            expect(rows.every((r) => r.verdict === 'PASS')).toBe(true);
            expect(JSON.stringify(rows)).not.toMatch(/aaaaaaaa|Automated RWT/);
            expect(feedbackLegRecovered(goodObs())).toBe(true);
        });
    }
    it('alert copy: none, or other words → FAIL', () => {
        expect(verdictOf('request-lost', 'alert', goodObs({ alertShown: false, alertText: null }))).toBe('FAIL');
        expect(verdictOf('request-lost', 'alert', goodObs({ alertText: 'Something went wrong' }))).toBe('FAIL');
    });
    it('dialog kept open: closed, or a lost field → FAIL; an unread field → HOLD', () => {
        expect(verdictOf('synthetic-42501', 'dialog', goodObs({ dialogVisible: false }))).toBe('FAIL');
        expect(verdictOf('synthetic-42501', 'dialog', goodObs({ sessionKept: false }))).toBe('FAIL');
        expect(verdictOf('synthetic-42501', 'dialog', goodObs({ submitEnabled: null }))).toBe('HOLD');
    });
    it('same key on Retry: another key, a changed draft, no Retry insert or a third insert → FAIL; no Retry pressed → HOLD', () => {
        const a = canonicalRun().ledger.legAttempts('request-lost');
        expect(verdictOf('request-lost', 'sameKey', goodObs(), [a[0], { ...a[1], keys: [K[4]] }])).toBe('FAIL');
        expect(verdictOf('request-lost', 'sameKey', goodObs(), [a[0], { ...a[1], draftSha: 'edited' }])).toBe('FAIL');
        expect(verdictOf('request-lost', 'sameKey', goodObs(), [a[0]])).toBe('FAIL');
        expect(verdictOf('request-lost', 'sameKey', goodObs(), [a[0], a[1], a[1]])).toBe('FAIL');
        expect(verdictOf('request-lost', 'sameKey', goodObs(), [a[0], { ...a[1], afterRetryMark: false }])).toBe('FAIL');
        expect(verdictOf('request-lost', 'sameKey', goodObs({ retried: false }), [a[0]])).toBe('HOLD');
    });
    it('no fresh acknowledgement before the Retry: one shown → FAIL; uncounted → HOLD', () => {
        expect(verdictOf('stored-response-lost', 'noAck', goodObs({ freshBeforeRetry: 1 }))).toBe('FAIL');
        expect(verdictOf('stored-response-lost', 'noAck', goodObs({ freshBeforeRetry: null }))).toBe('HOLD');
    });
    it('Retry treated as stored: the stored-response-lost Retry must meet the real named 409 and close with one acknowledgement', () => {
        const a = canonicalRun().ledger.legAttempts('stored-response-lost');
        expect(a[1]).toMatchObject({ status: 409, replayNamed: true });
        expect(verdictOf('stored-response-lost', 'retry', goodObs(), [a[0], { ...a[1], status: 201, replayNamed: null }])).toBe('FAIL');
        expect(verdictOf('stored-response-lost', 'retry', goodObs(), [a[0], { ...a[1], replayNamed: false }])).toBe('FAIL');
        expect(verdictOf('stored-response-lost', 'retry', goodObs({ dialogDetachedAfterRetry: false }))).toBe('FAIL');
        expect(verdictOf('stored-response-lost', 'retry', goodObs({ freshAfterRetry: 2 }))).toBe('FAIL');
        expect(verdictOf('stored-response-lost', 'retry', goodObs({ freshAfterRetry: null }))).toBe('HOLD');
        expect(verdictOf('stored-response-lost', 'retry', goodObs(), [a[0], { ...a[1], settled: false }])).toBe('HOLD');
        const s = canonicalRun().ledger.legAttempts('synthetic-42501');
        expect(verdictOf('synthetic-42501', 'retry', goodObs(), [s[0], { ...s[1], status: 409 }])).toBe('FAIL');
    });
    it('fault exercised: the synthetic answer never reached the server; the lost answer followed a real 201; otherwise HOLD', () => {
        const s = canonicalRun().ledger.legAttempts('synthetic-42501');
        expect(s[0]).toMatchObject({ status: 403, forwarded: false });
        const r = canonicalRun().ledger.legAttempts('stored-response-lost');
        expect(r[0]).toMatchObject({ status: 201, forwarded: true });
        expect(verdictOf('stored-response-lost', 'fault', goodObs(), [{ ...r[0], status: 403 }, r[1]])).toBe('HOLD');
        expect(verdictOf('stored-response-lost', 'fault', goodObs(), [])).toBe('HOLD');
        expect(verdictOf('stored-response-lost', 'fault', goodObs(), [{ ...r[0], action: 'cap-abort' }, r[1]])).toBe('FAIL');
    });
    it('exactly one stored row for the leg key: zero or two, or the wrong take → FAIL; unread → HOLD', () => {
        expect(verdictOf('synthetic-42501', 'stored', goodObs({ storedRows: 0 }))).toBe('FAIL');
        expect(verdictOf('synthetic-42501', 'stored', goodObs({ storedRows: 2, storedSessionMatches: null }))).toBe('FAIL');
        expect(verdictOf('synthetic-42501', 'stored', goodObs({ storedSessionMatches: false }))).toBe('FAIL');
        expect(verdictOf('synthetic-42501', 'stored', goodObs({ storedRows: null }))).toBe('HOLD');
    });
    it('a leg recovers only when its Retry closed the dialog', () => {
        expect(feedbackLegRecovered(goodObs({ retried: false }))).toBe(false);
        expect(feedbackLegRecovered(goodObs({ dialogDetachedAfterRetry: null }))).toBe(false);
    });
});

describe('final submit isolated from the fault legs', () => {
    const ev = (journeyId: string, outcome: string) => ({ event: 'feedback_submit', journeyId, fields: { outcome } });
    const legs = ['jl1', 'jl2', 'jl3'];
    const events = [ev('jl1', 'attempted'), ev('jl1', 'storage_failed'), ev('jl1', 'attempted'), ev('jl1', 'storage_ok'), ev('jf', 'attempted'), ev('jf', 'storage_ok')];
    const base = { boundJourneys: ['jf'], legJourneys: legs, events, legKeys: K.slice(0, 3), finalKeys: [K[3]] };
    it('one binding to a fresh journey holding only attempted + storage_ok, with a fresh key → PASS', () => expect(finalIsolationVerdict(base).verdict).toBe('PASS'));
    it('a leg journey bound, a leg event in the bound journey, a second binding or a reused key → FAIL', () => {
        expect(finalIsolationVerdict({ ...base, boundJourneys: ['jl1'] }).verdict).toBe('FAIL');
        expect(finalIsolationVerdict({ ...base, events: [...events, ev('jf', 'storage_failed')] }).verdict).toBe('FAIL');
        expect(finalIsolationVerdict({ ...base, boundJourneys: ['jf', 'jl2'] }).verdict).toBe('FAIL');
        expect(finalIsolationVerdict({ ...base, finalKeys: [K[1]] }).verdict).toBe('FAIL');
    });
    it('no binding, no observed leg journey, or no final key → HOLD', () => {
        expect(finalIsolationVerdict({ ...base, boundJourneys: [] }).verdict).toBe('HOLD');
        expect(finalIsolationVerdict({ ...base, legJourneys: [] }).verdict).toBe('HOLD');
        expect(finalIsolationVerdict({ ...base, finalKeys: [] }).verdict).toBe('HOLD');
    });
});

describe('readback anchor: the fault legs\' feedback_submit events never anchor share_feedback', () => {
    const RELEASE = 'a'.repeat(40);
    const RUN_ID = '37658306531';
    const RUN_ATTEMPT = '1';
    const canary = { releaseSha: RELEASE, trafficType: 'canary' };
    // One leg boot (b1/jl1) whose failed Send is the FIRST feedback_submit, then the final submit's fresh boot (bf/jf).
    const events = [
        { event: 'telemetry_positive_control', at: 1, journeyId: 'jl1-pre', bootId: 'b1', ...canary },
        { event: 'journey_step', at: 2, journeyId: 'jl1', bootId: 'b1', journeyStep: 'route_change', toRoute: '/analytics', ...canary },
        { event: 'feedback_submit', at: 3, journeyId: 'jl1', bootId: 'b1', ...canary },
        { event: 'telemetry_positive_control', at: 4, journeyId: 'jf-pre', bootId: 'bf', ...canary },
        { event: 'journey_step', at: 5, journeyId: 'jf', bootId: 'bf', journeyStep: 'route_change', toRoute: '/analytics', ...canary },
        { event: 'feedback_submit', at: 7, journeyId: 'jf', bootId: 'bf', ...canary },
    ];
    const binding = (over: Partial<ReadbackActionBinding> = {}): ReadbackActionBinding => ({
        stage: 'share_feedback', journeyId: 'jf', bootId: 'bf', releaseSha: RELEASE, trafficType: 'canary',
        runId: RUN_ID, runAttempt: RUN_ATTEMPT, entry: 'route_change', capturedAt: 6, ...over,
    });
    const bind = (input: readonly (typeof events)[number][], b = binding()) => bindReadbackJourneys(input, {
        recording: [], feedback: true, actionBindings: [b], expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
    });
    it('unfiltered, the leg\'s earlier Send is the anchor and the final binding reads anchor_mismatch (why the filter exists)', () => {
        const result = bind(events);
        expect(result.missingBindings).toEqual(['share_feedback']);
        expect(result.bindingReasons).toMatchObject({ share_feedback: 'anchor_mismatch' });
    });
    it('filtered by the recorded leg journeys, the final submit\'s binding is judged against its own anchor and binds', () => {
        const result = bind(withoutFaultLegSubmits(events, ['jl1']));
        expect(result.missingBindings).toEqual([]);
        expect(result.journeys).toEqual([{ journeyId: 'jf', stages: ['share_feedback'] }]);
        // The leg journey is still reported (its other events stay), never silently dropped from the receipt.
        expect(result.reportedJourneyIds).toContain('jl1');
    });
    it('a binding captured inside a leg journey still misses after the filter', () => {
        const result = bind(withoutFaultLegSubmits(events, ['jl1']), binding({ journeyId: 'jl1', bootId: 'b1', capturedAt: 2.5 }));
        expect(result.missingBindings).toEqual(['share_feedback']);
    });
    it('drops only feedback_submit in leg journeys; no leg journeys returns the same events (AHT-08)', () => {
        const filtered = withoutFaultLegSubmits(events, ['jl1']);
        expect(filtered.map((e) => `${e.event}@${e.journeyId}`)).toEqual(events.filter((e) => e.at !== 3).map((e) => `${e.event}@${e.journeyId}`));
        expect(withoutFaultLegSubmits(events, [])).toBe(events);
    });
});

// ── Race-safe report cleanup ────────────────────────────────────────────────────────────────────────────────────────────
type ReportRow = { id: string; idempotency_key: string | null; user_id: string | null };
interface FakeState {
    reports: ReportRow[]; sessions: number; profiles: number; authUser: boolean;
    deleteError?: boolean; deleteCount?: number | null; readError?: boolean; residueReadError?: boolean;
    deletes: Array<{ column: string; values: string[] }>; reads: number;
    /** Every read, as `table.column` (the recovery control proves no broad read or delete). */
    queries?: string[];
}
function fakeAdmin(state: FakeState): ReportCleanupAdmin {
    const reportsWhere = (column: string, values: readonly string[]) => state.reports.filter((r) => values.includes(String((r as Record<string, unknown>)[column])));
    const answer = (table: string, column: string, values: readonly string[]) => {
        state.reads += 1;
        state.queries?.push(`${table}.${column}`);
        if (table === 'user_issue_reports') {
            if (state.readError || (state.residueReadError && state.deletes.length > 0)) return Promise.resolve({ data: null, error: { code: 'XX000' } });
            return Promise.resolve({ data: reportsWhere(column, values).map((r) => ({ ...r })), error: null });
        }
        if (table === 'sessions') return Promise.resolve({ data: null, error: null, count: state.sessions });
        return Promise.resolve({ data: null, error: null, count: state.profiles });
    };
    return {
        from: (table: string) => ({
            select: () => ({ eq: (column: string, value: string) => answer(table, column, [value]), in: (column: string, values: readonly string[]) => answer(table, column, values) }),
            delete: () => ({
                in: (column: string, values: readonly string[]) => {
                    state.deletes.push({ column, values: [...values] });
                    if (state.deleteError) return Promise.resolve({ error: { code: 'XX000' }, count: null });
                    const before = state.reports.length;
                    state.reports = state.reports.filter((r) => !(column === 'id' && values.includes(r.id)));
                    return Promise.resolve({ error: null, count: state.deleteCount === undefined ? before - state.reports.length : state.deleteCount });
                },
            }),
        }),
        auth: { admin: { getUserById: () => Promise.resolve(state.authUser
            ? { data: { user: { id: USER } }, error: null }
            : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }) } },
    };
}
const R = (n: number, userId: string | null = USER): ReportRow => ({ id: `r${n}`, idempotency_key: K[n - 1], user_id: userId });
const fresh = (over: Partial<FakeState> = {}): FakeState => ({
    reports: [R(1), R(2), R(3), R(4), { id: 'other', idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: 'someone-else' }],
    sessions: 2, profiles: 1, authUser: true, deletes: [], reads: 0, ...over,
});
/** The account deletion as the product does it: auth user, sessions and profile gone; reports kept with user_id nulled. */
const deleteAccount = (s: FakeState) => {
    s.authUser = false; s.sessions = 0; s.profiles = 0;
    s.reports = s.reports.map((r) => (r.user_id === USER ? { ...r, user_id: null } : r));
};

const CERTAIN: WriteUncertainty = { pending: 0, uncertain: [] };

describe('zero residue — capture, account deletion, re-capture, delete by id, residue reads', () => {
    it('Sam, #1811 b319d42b: a write still in flight after the drain, or an uncertain commit, is never a zero/PASS', async () => {
        for (const uncertainty of [{ pending: 1, uncertain: [] }, { pending: null, uncertain: [] }, { pending: 0, uncertain: [3] }] as WriteUncertainty[]) {
            const s = fresh();
            const admin = fakeAdmin(s);
            const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
            deleteAccount(s);
            const v = await cleanupRunReports(admin, USER, K.slice(0, 4), captured, uncertainty);
            // Everything reads zero right now, yet the verdict HOLDs and keeps the whole inventory.
            expect(v).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/server outcome is unknown/),
                evidence: { capturedIds: 'r1,r2,r3,r4', runKeys: 4, pending: uncertainty.pending, uncertainAttempts: uncertainty.uncertain.join(',') } });
        }
    });
    it('an uncertain write never hides a proven survivor or a foreign key (FAIL wins)', async () => {
        const s = fresh();
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
        deleteAccount(s);
        s.authUser = true;
        expect((await cleanupRunReports(admin, USER, K.slice(0, 4), captured, { pending: 2, uncertain: [5] })).verdict).toBe('FAIL');
    });
    it('writeUncertainty: unsettled attempts and forwarded-unknown attempts are uncertain; capped, faulted and answered ones are not', () => {
        const a = (ordinal: number, settled: boolean, forwarded: boolean | null, action: string) => ({ ordinal, settled, forwarded, action }) as never;
        expect(writeUncertainty([a(1, true, false, 'fault-request-lost'), a(2, true, true, 'forward'), a(3, true, null, 'forward'), a(4, false, null, 'forward'),
            a(5, true, false, 'cap-abort'), a(6, true, null, 'cap-abort')], 0)).toEqual({ pending: 0, uncertain: [3, 4] });
        expect(writeUncertainty([], null)).toEqual({ pending: null, uncertain: [] });
    });

    it('the designed run: 4 reports captured by owner and key, deleted by id with an exact count, everything reads zero → PASS', async () => {
        const s = fresh();
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
        expect(captured.ids).toEqual(['r1', 'r2', 'r3', 'r4']);
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, K.slice(0, 4), captured, CERTAIN);
        expect(v).toMatchObject({ verdict: 'PASS', evidence: { capturedReports: 4, deleted: 4, recapturedReports: 0 } });
        expect(s.deletes).toEqual([{ column: 'id', values: ['r1', 'r2', 'r3', 'r4'] }]);
        expect(s.reports.map((r) => r.id)).toEqual(['other']);
    });
    it('THE RACE: a report that lands between capture and deletion is found by its route key at re-capture and deleted', async () => {
        const s = fresh({ reports: [R(1), R(2), R(3)] });
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
        expect(captured.ids).toHaveLength(3);
        s.reports.push(R(4));
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, K.slice(0, 4), captured, CERTAIN);
        expect(v).toMatchObject({ verdict: 'PASS', evidence: { capturedReports: 4, recapturedReports: 1, deleted: 4 } });
        expect(s.reports.filter((r) => r.id !== 'other')).toEqual([]);
    });
    it('a survivor → FAIL with the surviving report ids only; an exact-count miss → FAIL', async () => {
        const s = fresh({ deleteCount: 4 });
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
        deleteAccount(s);
        s.authUser = true;
        const survivor = await cleanupRunReports(admin, USER, K.slice(0, 4), captured, CERTAIN);
        expect(survivor).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/auth user/) });
        const s2 = fresh({ deleteCount: 3 });
        const a2 = fakeAdmin(s2);
        const c2 = await captureRunReports(a2, USER, K.slice(0, 4), null);
        deleteAccount(s2);
        expect(await cleanupRunReports(a2, USER, K.slice(0, 4), c2, CERTAIN)).toMatchObject({ verdict: 'FAIL', detail: expect.stringMatching(/removed 3 of 4/) });
        // A row the delete missed is named by id, and only the survivors are named.
        const v = zeroResidueVerdict({ captured: { ids: ['r1', 'r2'], keys: [], foreignIds: [] }, deletion: { ran: true, count: 2 },
            residue: { reportIds: ['r2'], sessions: 0, profiles: 0, authUser: 'gone' }, recaptured: 0, uncertainty: CERTAIN });
        expect(v).toMatchObject({ verdict: 'FAIL', evidence: { survivingReportIds: 'r2' } });
        expect(JSON.stringify(v.evidence)).not.toMatch(/r1/);
    });
    it('a delete that could not run → HOLD naming the captured ids; nothing is deleted by key or time', async () => {
        const s = fresh({ deleteError: true });
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
        deleteAccount(s);
        expect(await cleanupRunReports(admin, USER, K.slice(0, 4), captured, CERTAIN))
            .toMatchObject({ verdict: 'HOLD', evidence: { capturedIds: 'r1,r2,r3,r4' } });
        expect(await cleanupRunReports(null, USER, K.slice(0, 4), captured, CERTAIN)).toMatchObject({ verdict: 'HOLD', evidence: { capturedIds: 'r1,r2,r3,r4' } });
        expect(s.deletes.every((d) => d.column === 'id')).toBe(true);
        expect(zeroResidueNotRun(captured)).toMatchObject({ verdict: 'HOLD', evidence: { capturedIds: 'r1,r2,r3,r4' } });
        expect(zeroResidueNotRun(null).verdict).toBe('HOLD');
    });
    it('an unreadable residue read, or no capture at all → HOLD, never PASS', async () => {
        const s = fresh({ residueReadError: true });
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K.slice(0, 4), null);
        deleteAccount(s);
        expect((await cleanupRunReports(admin, USER, K.slice(0, 4), captured, CERTAIN)).verdict).toBe('HOLD');
        const unreadable = fakeAdmin(fresh({ readError: true }));
        await expect(captureRunReports(unreadable, USER, K.slice(0, 4), null)).rejects.toThrow(/fail closed/);
        expect((await cleanupRunReports(unreadable, USER, K.slice(0, 4), null, CERTAIN)).verdict).toBe('HOLD');
        expect(zeroResidueVerdict({ captured: { ids: [], keys: [], foreignIds: [] }, deletion: { ran: true, count: null },
            residue: { reportIds: [], sessions: 0, profiles: 0, authUser: 'gone' }, recaptured: 0, uncertainty: CERTAIN }).verdict).toBe('HOLD');
    });
    it('a run key naming another account\'s report → FAIL, and that report is never deleted', async () => {
        const s = fresh();
        s.reports.push({ id: 'foreign', idempotency_key: K[4], user_id: 'someone-else' });
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, K, null);
        expect(captured.foreignIds).toEqual(['foreign']);
        deleteAccount(s);
        expect(await cleanupRunReports(admin, USER, K, captured, CERTAIN)).toMatchObject({ verdict: 'FAIL', evidence: { foreignIds: 'foreign' } });
        expect(s.reports.map((r) => r.id)).toEqual(['other', 'foreign']);
    });
    it('mergeCapture: an ownerless row is the run\'s only under a run key', () => {
        const merged: CapturedReports = mergeCapture(null, [{ id: 'x', key: K[0], userId: null }, { id: 'y', key: 'unrelated', userId: null }], USER, [K[0]]);
        expect(merged.ids).toEqual(['x']);
        expect(merged.foreignIds).toEqual([]);
    });
});

// ── Acceptance inventory and spec wiring ──────────────────────────────────────────────────────────────────────────────────
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');
const spec = read('../live/rwt-feedback-association-boundaries.live.spec.ts');
const at = (needle: string, from = 0) => {
    const i = spec.indexOf(needle, from);
    if (i < 0) throw new Error(`the spec lacks: ${needle}`);
    return i;
};
const olderStart = at("test('feedback selected for an older take links only to that take'");
const noneStart = at("test('No session feedback stores no take or coaching link'");
const older = spec.slice(olderStart, noneStart);
const none = spec.slice(noneStart);

describe('acceptance: bounded writes belong to the older-take suite; both suites require cleanup', () => {
    it('the older-take suite requires bounded-write rows; both suites require zero residue', () => {
        const product = requiredAutomatedRows(FEEDBACK_OLDER_TAKE_SUITE)!.product;
        for (const step of [...FEEDBACK_BOUNDED_WRITE_ROWS, ZERO_RESIDUE_ROW]) expect({ step, required: product.includes(step) }).toEqual({ step, required: true });
        const noSession = requiredAutomatedRows(FEEDBACK_NO_SESSION_SUITE)!.product;
        for (const step of FEEDBACK_BOUNDED_WRITE_ROWS) expect(noSession).not.toContain(step);
        expect(noSession).toContain(ZERO_RESIDUE_ROW);
        expect(FEEDBACK_BOUNDED_WRITE_ROWS).toHaveLength(3 * 7 + 3);
        expect(new Set(FEEDBACK_BOUNDED_WRITE_ROWS).size).toBe(FEEDBACK_BOUNDED_WRITE_ROWS.length);
        expect(FEEDBACK_BOUNDED_WRITE_ROWS).toContain(FEEDBACK_ISOLATION_ROW);
    });
});

describe('the AHT-07 spec wiring (source order)', () => {
    it('the route is installed after the canary claim, behind a CONFIRMED fence open, and before the first take; one context route sees every page', () => {
        const ready = at('if (!ready) return;', olderStart);
        const make = at("feedbackFence = new JourneyFeedbackFence(admin as never, 'AHT-07', AHT07_FENCE_KEY_CAP);", olderStart);
        const open = at('await feedbackFence.open(owner.uid, currentRunBinding());', olderStart);
        const hold = at("receipt.halt('feedback fence open', `HOLD before any feedback write: ${feedbackFence.heldReason ?? 'not opened'}`);", olderStart);
        const install = at('await installFeedbackWriteRoute(page, ledger, feedbackFence);', olderStart);
        // #1811 (Sam, #1859 review): no route, and so no feedback write, without a confirmed-open fence.
        expect([ready < make, make < open, open < hold, hold < install]).toEqual([true, true, true, true]);
        expect(install).toBeLessThan(at('createSavedOpenMicTake(page, 1, true)', olderStart));
        expect(spec).toContain('await page.context().route(FEEDBACK_INSERT_URL, async (route: Route) => {');
        // The fence cap is the route's distinct-key cap, so the route always refuses first.
        expect(spec).toContain('const AHT07_FENCE_KEY_CAP = 4;');
    });
    it('the route records and decides each write before any abort, fulfil or fetch; the stored-response-lost answer is dropped after the real fetch', () => {
        const fn = spec.slice(at('async function installFeedbackWriteRoute('), at('async function runFeedbackFaultLeg('));
        const admit = fn.indexOf('const attempt = ledger.admit(request.method(), () => request.postDataJSON());');
        expect(admit).toBeGreaterThan(0);
        for (const act of ["route.abort('failed')", 'route.fulfill(syntheticRejection(', 'route.fetch()', 'route.fulfill({ response })']) {
            expect(fn.indexOf(act)).toBeGreaterThan(admit);
        }
        expect(fn.indexOf("attempt.action === 'cap-abort'")).toBeLessThan(fn.indexOf('route.fetch()'));
        const fetch = fn.indexOf('response = await route.fetch()');
        const drop = fn.indexOf("if (attempt.action === 'fault-stored-response-lost') return await route.abort('failed');");
        expect(fetch).toBeGreaterThan(0);
        expect(drop).toBeGreaterThan(fetch);
        expect(fn.indexOf('ledger.settle(attempt, { status, forwarded: true, replayNamed });')).toBeLessThan(drop);
    });
    it('each leg arms before its Submit, marks the Retry immediately before the Retry click, closes its window, and binds no readback action', () => {
        const fn = spec.slice(at('async function runFeedbackFaultLeg('), at('async function finishReceipt('));
        const arm = fn.indexOf('ledger.armLeg(leg);');
        const firstClick = fn.indexOf("await page.getByTestId('issue-report-submit').click();");
        expect(arm).toBeGreaterThan(0);
        expect(arm).toBeLessThan(firstClick);
        expect(fn.replace(/\s+/g, ' ')).toContain("ledger.markRetry(); await page.getByTestId('issue-report-submit').click();");
        expect(fn).toMatch(/\} finally \{\s*page\.off\('console', onConsole\);\s*ledger\.endWindow\(\);/);
        expect(fn).not.toContain('captureActionBindingSettled');
        expect(fn).toContain("await page.goto('/analytics');");
    });
    it('the legs run after the two takes, then ONE final submit in its own window, then the body\'s ledger snapshot', () => {
        const coaching = at("receipt.row('older take coaching request observed'", olderStart);
        const legs = at('for (const leg of FEEDBACK_FAULT_LEGS) {', olderStart);
        const stop = at('if (!feedbackLegRecovered(observation)) throw new Error(', olderStart);
        const begin = at('ledger.beginFinal();', olderStart);
        const submit = at("const stored = await submitFeedback(page, tap, owner.uid, 'selected_older_session', olderId, newerId);", olderStart);
        const end = at('ledger.endWindow();', submit);
        const snapshot = at('observedLedger = feedbackLedgerVerdict(ledger.attempts);', olderStart);
        expect(coaching).toBeLessThan(legs);
        expect(legs).toBeLessThan(stop);
        expect(stop).toBeLessThan(begin);
        expect(spec.slice(begin, submit).replace(/\s+/g, ' ')).toBe('ledger.beginFinal(); ');
        expect(end).toBeLessThan(snapshot);
        expect(snapshot).toBeLessThan(at('reportId = stored.id;', olderStart));
    });
    it('the finalizer stops the writer, drains, closes the fence, deletes the account with its retention proof, then cleans and verifies zero', () => {
        const fin = older.slice(older.indexOf('const finish = finalizer.once('), older.indexOf('        try {'));
        const order = ["await steps.step('owned pages closed'", 'ledger.endWindow();', "await steps.step('feedback attempt ledger'", 'feedbackFence?.stopWriter();',
            'pendingAfterDrain = await ledger.drain(15_000);', "sink.row('feedback writer drained',",
            'writeFeedbackAttemptRows(sink, ledger.attempts, observedLedger);', 'sink.row(FEEDBACK_ISOLATION_ROW,', "await steps.step('feedback fence close'",
            'finalizeOwnedCleanup(steps, receipt, cleanup, report', 'feedbackRetentionAfterDeletionRow(', "await steps.step('feedback fence cleanup'",
            'fence.cleanRow(aliveReceipt(receipt, alive), ZERO_RESIDUE_ROW)',
            'await finishReceipt(receipt, testInfo, tap, claimed, steps, legJourneys);'];
        const idx = order.map((needle) => fin.indexOf(needle));
        expect(Object.fromEntries(order.map((n, i) => [n, idx[i] >= 0]))).toEqual(Object.fromEntries(order.map((n) => [n, true])));
        for (let i = 1; i < idx.length; i += 1) expect({ before: order[i - 1], after: order[i], ok: idx[i - 1] < idx[i] }).toMatchObject({ ok: true });
        // The replaced capture/cleanup-by-key path is gone: only fence-recorded reports are deleted.
        for (const gone of ['captureRunReports', 'cleanupRunReports', 'writeUncertainty(', 'settleRecoveryInventory', 'inventory?.']) expect({ gone, present: fin.includes(gone) }).toEqual({ gone, present: false });
    });
    it('keeps AHT-07\'s Start budget at the two designed presses and pins no retry for the file', () => {
        expect(spec).toContain("const AHT07_START_PRESS_BUDGET = { total: 2, perControl: { 'mic-start': 1, 'mic-download': 1, 'verdict-practice-again': 1 } } as const;");
        expect(spec).toContain("test.describe.configure({ mode: 'serial', retries: 0 });");
        // The legs press no Start control: only the dialog's own controls and the session select.
        const fn = spec.slice(at('async function runFeedbackFaultLeg('), at('async function finishReceipt('));
        const used = new Set([...fn.matchAll(/getByTestId\('([^']+)'\)/g)].map((m) => m[1]));
        expect([...used].sort()).toEqual(['feedback-session-select', 'feedback-type-broke', 'issue-report-description', 'issue-report-dialog',
            'issue-report-submit', 'nav-report-issue-button']);
        for (const control of ['mic-start', 'mic-download', 'mic-retry', 'verdict-practice-again', 'focus-points-retry']) expect(fn).not.toContain(`'${control}'`);
    });
});

describe('AHT-08 (no session) is untouched, and the new helpers stay case-only', () => {
    it('the No-session scenario uses none of the bounded-write wiring; its one write is bounded by its own fence', () => {
        for (const name of ['installFeedbackWriteRoute', 'FeedbackAttemptLedger', 'runFeedbackFaultLeg', 'ledger.', 'FEEDBACK_FAULT_LEGS', 'observedLedger',
            'writeUncertainty(', 'FeedbackRecoveryInventory', 'inventory', 'captureRunReports', 'cleanupRunReports']) {
            expect({ name, used: none.includes(name) }).toEqual({ name, used: false });
        }
        expect(none).toContain("feedbackFence = new JourneyFeedbackFence(admin as never, 'AHT-08', 1);");
        expect(none).toMatch(/const stored = await submitFeedback\(page, tap, owner\.uid, 'no_session', null, undefined, \{/);
        expect(none).toContain('feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())');
        expect(none).toContain('await finishReceipt(receipt, testInfo, tap, claimed, steps);');
        expect(none).not.toContain('legJourneys');
    });
    it('the shared feedback helper (AHT-08\'s path) does not depend on the new helpers', () => {
        const ref = read('../live/helpers/feedbackDiagnosticRef.ts');
        expect(ref).not.toMatch(/feedbackAttemptLedger|feedbackReportCleanup/);
    });
    it('only the feedback spec (and the cleanup helpers, for types) import the bounded-write helpers; nothing live imports the replaced inventory', () => {
        const live = path.resolve(here, '../live');
        const files = [...readdirSync(live).map((f) => path.join(live, f)), ...readdirSync(path.join(live, 'helpers')).map((f) => path.join(live, 'helpers', f))]
            .filter((f) => f.endsWith('.ts'));
        const importers = files.filter((f) => /from '\.\/(helpers\/)?(feedbackAttemptLedger|feedbackReportCleanup)'/.test(readFileSync(f, 'utf8')))
            .map((f) => path.relative(live, f)).sort();
        expect(importers).toEqual(['helpers/feedbackNoSessionCleanup.ts', 'helpers/feedbackRecoveryInventory.ts', 'helpers/feedbackReportCleanup.ts', 'rwt-feedback-association-boundaries.live.spec.ts']);
        // #1811: the database fence replaced the on-disk inventory in every journey.
        const inventoryImporters = files.filter((f) => /from '\.\/(helpers\/)?feedbackRecoveryInventory'/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(live, f));
        expect(inventoryImporters).toEqual([]);
    });
});

// ── Durable recovery inventory (Sam, #1811 RETURNs at 791b3780 and ff3922e9) ─────────────────────────────────────────────
const BINDING = { runId: '43048630848', runAttempt: '1', testId: 'f00d-1a2b3c', ownerUid: USER };
const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), 'aht07-recovery-'));
const att = (ordinal: number, key: string, action: FeedbackAttempt['action'] = 'forward') => ({ ordinal, action, keys: [key] });
/** A store as its owner provisions it: 0700, with the marker that declares it survives runner loss. */
function provisionStore(dir: string, storeId = 'rwt-store-1'): VerifiedStore {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(path.join(dir, RECOVERY_STORE_MARKER), JSON.stringify({ schema: RECOVERY_STORE_SCHEMA, storeId, survivesRunnerLoss: true }), { mode: 0o600 });
    const check = verifyRecoveryStore({ [RECOVERY_DIR_ENV]: dir });
    if (!check.ok) throw new Error(check.reason);
    return check.store;
}
const recoverVerdict = async (admin: ReportCleanupAdmin, store: VerifiedStore, file: string) => recoverFromInventory(admin, store, path.basename(file));

describe('a verified recovery store that survives runner loss, before any production write', () => {
    it('refuses an unset, relative, missing, unmarked, open or runner-owned store; never creates one', () => {
        const root = tmpDir();
        expect(verifyRecoveryStore({})).toEqual({ ok: false, reason: `${RECOVERY_DIR_ENV} is not set` });
        expect(verifyRecoveryStore({ [RECOVERY_DIR_ENV]: 'relative/dir' })).toMatchObject({ ok: false, reason: expect.stringMatching(/absolute/) });
        expect(verifyRecoveryStore({ [RECOVERY_DIR_ENV]: path.join(root, 'missing') })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not exist/) });
        expect(readdirSync(root)).toEqual([]);
        const unmarked = path.join(root, 'unmarked');
        mkdirSync(unmarked, { mode: 0o700 }); chmodSync(unmarked, 0o700);
        expect(verifyRecoveryStore({ [RECOVERY_DIR_ENV]: unmarked })).toMatchObject({ ok: false, reason: expect.stringMatching(/no provisioning marker/) });
        writeFileSync(path.join(unmarked, RECOVERY_STORE_MARKER), JSON.stringify({ schema: RECOVERY_STORE_SCHEMA, storeId: 's', survivesRunnerLoss: false }));
        expect(verifyRecoveryStore({ [RECOVERY_DIR_ENV]: unmarked })).toMatchObject({ ok: false, reason: expect.stringMatching(/survives runner loss/) });
        const open = path.join(root, 'open');
        provisionStore(open);
        chmodSync(open, 0o755);
        expect(verifyRecoveryStore({ [RECOVERY_DIR_ENV]: open })).toMatchObject({ ok: false, reason: expect.stringMatching(/group or others/) });
        // On CI, a store inside the runner's own home, workspace, temp or tool cache is lost with the runner.
        const runnerHome = path.join(root, 'runner-home');
        const inside = path.join(runnerHome, '.speaksharp-rwt-recovery');
        provisionStore(inside);
        for (const env of [{ GITHUB_ACTIONS: 'true', HOME: runnerHome }, { GITHUB_ACTIONS: 'true', RUNNER_TEMP: runnerHome }, { CI: 'true', GITHUB_WORKSPACE: runnerHome }]) {
            expect(verifyRecoveryStore({ ...env, [RECOVERY_DIR_ENV]: inside })).toMatchObject({ ok: false, reason: expect.stringMatching(/runner's own/) });
        }
        const outside = path.join(root, 'mounted-store');
        expect(verifyRecoveryStore({ GITHUB_ACTIONS: 'true', HOME: runnerHome, RUNNER_TEMP: path.join(root, 'rt'), [RECOVERY_DIR_ENV]: provisionStore(outside).dir }))
            .toEqual({ ok: true, store: { dir: outside, storeId: 'rwt-store-1' } });
        // The probe leaves nothing behind.
        expect(readdirSync(outside)).toEqual([RECOVERY_STORE_MARKER]);
    });
    it('the older-take journey HOLDs before any feedback write when no fence is confirmed open (the store gate is replaced)', () => {
        const hold = at("receipt.halt('feedback fence open', `HOLD before any feedback write: ${feedbackFence.heldReason ?? 'not opened'}`);", olderStart);
        expect(hold).toBeLessThan(at('await installFeedbackWriteRoute(page, ledger, feedbackFence);', olderStart));
        expect(older).not.toContain('verifyRecoveryStore');
        expect(none).not.toContain('verifyRecoveryStore');
    });
});

describe('the recovery inventory is restricted, content-free and durable before forwarding', () => {
    it('a 0600 file in the verified store; each attempt line is on disk when recordAttempt returns; only content-free fields', () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store);
        expect(statSync(inv.file).mode & 0o777).toBe(0o600);
        inv.recordAttempt(att(1, K[0], 'fault-synthetic-42501'));
        expect(readRecoveryInventory(inv.file)).toMatchObject({ storeId: 'rwt-store-1', binding: BINDING, attempts: [{ ordinal: 1, keys: [K[0]] }], writerStopped: null, malformed: 0 });
        inv.recordSettle({ ordinal: 1, status: 403, forwarded: false });
        inv.stop();
        expect(inv.recordWriterStopped(0)).toBe(true);
        const lines = readFileSync(inv.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        expect(lines[0]).toMatchObject({ schema: RECOVERY_SCHEMA, type: 'run', ...BINDING });
        expect(lines.map((l) => Object.keys(l).sort().join(','))).toEqual([
            'createdAt,ownerUid,runAttempt,runId,schema,storeId,testId,type', 'action,at,keys,ordinal,type', 'at,forwarded,ordinal,status,type', 'at,attempts,pending,type']);
    });
    it('refuses a binding that is not plain identifiers (no file is created)', () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        expect(() => FeedbackRecoveryInventory.open({ ...BINDING, ownerUid: 'not-a-uuid' }, store)).toThrow(/owner uid/);
        expect(() => FeedbackRecoveryInventory.open({ ...BINDING, testId: '../x' }, store)).toThrow(/testId/);
        expect(readdirSync(store.dir)).toEqual([RECOVERY_STORE_MARKER]);
    });
    it('a write that cannot be recorded, or that comes after the writer stopped, is not recorded (the route aborts it unsent)', () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store);
        inv.stop();
        expect(recordDurably(inv, att(1, K[0]))).toBe(false);
        expect(inv.failures).toBe(1);
        const lost = FeedbackRecoveryInventory.open({ ...BINDING, runId: 'r2' }, store);
        rmSync(lost.file);
        rmSync(store.dir, { recursive: true, force: true });
        expect(recordDurably(lost, att(1, K[0]))).toBe(false);
        expect(recordDurably(null, att(1, K[0]))).toBe(false);
    });
    it('no stopped record without stop() and a drain that found nothing in flight', () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')));
        expect(inv.recordWriterStopped(0)).toBe(false);
        inv.stop();
        expect(inv.recordWriterStopped(1)).toBe(false);
        expect(inv.recordWriterStopped(null)).toBe(false);
        expect(readRecoveryInventory(inv.file)!.writerStopped).toBeNull();
    });
    it('the route sends nothing unless the fence is writable: the gate precedes every abort, fulfil and fetch', () => {
        const fn = spec.slice(at('async function installFeedbackWriteRoute('), at('async function runFeedbackFaultLeg('));
        const admit = fn.indexOf('const attempt = ledger.admit(request.method(), () => request.postDataJSON());');
        const gate = fn.indexOf('if (!fence.writable) {');
        expect(gate).toBeGreaterThan(admit);
        for (const act of ["route.abort('failed')", 'route.fulfill(syntheticRejection(', 'route.fetch()', 'route.fulfill({ response })']) {
            expect({ act, afterGate: fn.indexOf(act) > gate }).toEqual({ act, afterGate: true });
        }
        expect(fn.slice(gate).replace(/\s+/g, ' ')).toMatch(/^if \(!fence\.writable\) \{ ledger\.settle\(attempt, \{ status: null, forwarded: false \}\); return await route\.abort\('failed'\); \}/);
        expect(fn).not.toContain('inventory');
    });
});

describe('the inventory is kept until settlement plus zero readback', () => {
    const pass: RowVerdict = { verdict: 'PASS', detail: 'ok', evidence: { deleted: 4 } };
    it('PASS retires the file; HOLD or FAIL keeps it and names it by file name, never a key', () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')));
        inv.recordAttempt(att(1, K[0]));
        for (const v of [{ verdict: 'HOLD', detail: 'unknown write' }, { verdict: 'FAIL', detail: 'survivor' }] as RowVerdict[]) {
            const out = settleRecoveryInventory(v, inv);
            expect(out.verdict).toBe(v.verdict);
            expect(out.evidence).toMatchObject({ recoveryInventory: `kept:${path.basename(inv.file)}`, recoveryDirEnv: RECOVERY_DIR_ENV });
            expect(JSON.stringify(out)).not.toContain(K[0]);
            expect(readRecoveryInventory(inv.file)).not.toBeNull();
        }
        expect(settleRecoveryInventory(pass, inv).evidence).toMatchObject({ recoveryInventory: 'retired', deleted: 4 });
        expect(readRecoveryInventory(inv.file)).toBeNull();
    });
});

describe('recovery fails closed: age never clears uncertainty (Sam, ff3922e9 RETURN item 1)', () => {
    const lateWorld = () => fresh({ reports: [
        { id: 'other', idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: 'someone-else' },
        { id: 'unrelated-ownerless', idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: null },
    ], authUser: false, sessions: 0, profiles: 0, queries: [] });

    it('active-writer negative (Sam\'s reproduction): one forward attempt, no settle, no stopped record, zero reads — HOLD, nothing read or deleted, file kept', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store);
        expect(recordDurably(inv, att(7, K[3]))).toBe(true);
        const s = lateWorld();
        const out = await recoverVerdict(fakeAdmin(s), store, inv.file);
        expect(out.verdict).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/stopped record is absent/), evidence: { writerStopped: false } });
        expect(out.retired).toBe(false);
        expect(s.deletes).toEqual([]);
        expect(s.queries).toEqual([]);
        expect(readRecoveryInventory(inv.file)).not.toBeNull();
    });
    it('a stopped record that does not cover every attempt line, or any line after it, is malformed or incomplete (HOLD)', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store);
        inv.recordAttempt(att(1, K[0]));
        inv.recordSettle({ ordinal: 1, status: 201, forwarded: true });
        writeFileSync(inv.file, `${readFileSync(inv.file, 'utf8')}{"type":"writer-stopped","attempts":0,"pending":0}\n`);
        expect((await recoverVerdict(fakeAdmin(lateWorld()), store, inv.file)).verdict.verdict).toBe('HOLD');
        writeFileSync(inv.file, `${readFileSync(inv.file, 'utf8')}{"type":"attempt","ordinal":2,"action":"forward","keys":["${K[1]}"]}\n`);
        expect((await recoverVerdict(fakeAdmin(lateWorld()), store, inv.file)).verdict).toMatchObject({ verdict: 'HOLD', evidence: { malformed: 1 } });
    });
    it('delayed-commit negative: writer stopped, one forward with no answer, nothing stored yet — HOLD, nothing deleted; the later commit then resolves it', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store);
        inv.recordAttempt(att(7, K[3]));
        inv.recordSettle({ ordinal: 7, status: null, forwarded: null });
        inv.stop();
        inv.recordWriterStopped(0);
        const s = lateWorld();
        const admin = fakeAdmin(s);
        const first = await recoverVerdict(admin, store, inv.file);
        expect(first.verdict).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/still unknown/), evidence: { unresolvedAttempts: '7' } });
        expect(s.deletes).toEqual([]);
        expect(readRecoveryInventory(inv.file)).not.toBeNull();
        // The commit lands later (after the account deletion): its own row resolves the attempt; exactly that id is deleted.
        s.reports.push({ id: 'late', idempotency_key: K[3], user_id: null });
        const second = await recoverVerdict(admin, store, inv.file);
        expect(second.verdict).toMatchObject({ verdict: 'PASS', evidence: { deleted: 1, recoveryInventory: 'retired' } });
        expect(s.deletes).toEqual([{ column: 'id', values: ['late'] }]);
        expect(s.reports.map((r) => r.id).sort()).toEqual(['other', 'unrelated-ownerless']);
    });
    it('an observed row does not resolve an attempt whose key another attempt stored or left unresolved', () => {
        const rows = new Map([[K[0], 1]]);
        const settles = (entries: Array<[number, number | null, boolean | null]>) => new Map(entries.map(([o, status, forwarded]) => [o, { status, forwarded }]));
        const two = [att(1, K[0]), att(2, K[0])];
        expect(unresolvedAttempts({ attempts: two, settles: settles([[1, 201, true], [2, null, null]]) }, rows)).toEqual([2]);
        expect(unresolvedAttempts({ attempts: two, settles: settles([[1, null, null]]) }, rows)).toEqual([1, 2]);
        expect(unresolvedAttempts({ attempts: two, settles: settles([[1, 403, false], [2, null, null]]) }, rows)).toEqual([]);
        expect(unresolvedAttempts({ attempts: two, settles: settles([[1, 403, false], [2, null, null]]) }, new Map())).toEqual([2]);
        expect(unresolvedAttempts({ attempts: two, settles: settles([[1, 403, false], [2, null, null]]) }, new Map([[K[0], 2]]))).toEqual([2]);
        // Answered attempts are known: a 409 replay or a 201 needs no observation.
        expect(unresolvedAttempts({ attempts: two, settles: settles([[1, 201, true], [2, 409, true]]) }, new Map())).toEqual([]);
    });
    it('another store\'s inventory, a missing or foreign-schema file, or an unreadable read deletes nothing (HOLD)', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const otherStore = provisionStore(path.join(tmpDir(), 'other'), 'rwt-store-2');
        const s = fresh();
        const admin = fakeAdmin(s);
        expect((await recoverFromInventory(admin, store, 'missing.jsonl')).verdict.verdict).toBe('HOLD');
        writeFileSync(path.join(store.dir, 'foreign.jsonl'), `${JSON.stringify({ schema: 'other', type: 'run', storeId: 'rwt-store-1', ...BINDING })}\n`);
        expect((await recoverFromInventory(admin, store, 'foreign.jsonl')).verdict.verdict).toBe('HOLD');
        const inv = FeedbackRecoveryInventory.open(BINDING, otherStore);
        inv.recordAttempt(att(1, K[0])); inv.recordSettle({ ordinal: 1, status: 201, forwarded: true }); inv.stop(); inv.recordWriterStopped(0);
        cpSync(inv.file, path.join(store.dir, path.basename(inv.file)));
        expect((await recoverFromInventory(admin, store, path.basename(inv.file))).verdict).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/another store/) });
        const unreadable = fresh({ readError: true });
        expect((await recoverFromInventory(fakeAdmin(unreadable), otherStore, path.basename(inv.file))).verdict.verdict).toBe('HOLD');
        expect(s.deletes).toEqual([]);
        expect(unreadable.deletes).toEqual([]);
    });
    it('a run key under another account is never deleted by recovery (FAIL), and the file is kept', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store);
        inv.recordAttempt(att(1, K[0])); inv.recordSettle({ ordinal: 1, status: 201, forwarded: true }); inv.stop(); inv.recordWriterStopped(0);
        const s = fresh({ reports: [{ id: 'theirs', idempotency_key: K[0], user_id: 'someone-else' }], authUser: false, sessions: 0, profiles: 0 });
        const out = await recoverVerdict(fakeAdmin(s), store, inv.file);
        expect(out.verdict).toMatchObject({ verdict: 'FAIL', evidence: { foreignIds: 'theirs' } });
        expect(s.deletes).toEqual([]);
        expect(readRecoveryInventory(inv.file)).not.toBeNull();
    });
});

describe('restart / late-commit control across executors (Sam, ff3922e9 RETURN item 2)', () => {
    it('executor A writes through the real helper in its own process and is lost; executor B mounts the store elsewhere and locates exactly the late report', async () => {
        const root = tmpDir();
        const executorA = path.join(root, 'executor-a');
        mkdirSync(path.join(executorA, 'home'), { recursive: true });
        mkdirSync(path.join(executorA, 'tmp'), { recursive: true });
        const mountA = path.join(root, 'store-mount-a');
        provisionStore(mountA);
        const helper = path.resolve(here, '../live/helpers/feedbackRecoveryInventory.ts');
        const script = path.join(root, 'executor-a.mts');
        writeFileSync(script, [
            `import { FeedbackRecoveryInventory, recordDurably, verifyRecoveryStore } from ${JSON.stringify(helper)};`,
            'const check = verifyRecoveryStore(process.env);',
            'if (!check.ok) { console.error(check.reason); process.exit(3); }',
            `const inv = FeedbackRecoveryInventory.open(${JSON.stringify(BINDING)}, check.store);`,
            // Attempts 1..2: a leg's fault (never sent) and its Retry (answered 201). Attempt 7: the final submit, forwarded with no answer.
            `if (!recordDurably(inv, { ordinal: 1, action: 'fault-request-lost', keys: [${JSON.stringify(K[0])}] })) process.exit(4);`,
            'inv.recordSettle({ ordinal: 1, status: null, forwarded: false });',
            `if (!recordDurably(inv, { ordinal: 2, action: 'forward', keys: [${JSON.stringify(K[0])}] })) process.exit(4);`,
            'inv.recordSettle({ ordinal: 2, status: 201, forwarded: true });',
            `if (!recordDurably(inv, { ordinal: 7, action: 'forward', keys: [${JSON.stringify(K[3])}] })) process.exit(4);`,
            'inv.recordSettle({ ordinal: 7, status: null, forwarded: null });',
            'inv.stop();',
            'if (!inv.recordWriterStopped(0)) process.exit(5);',
            'console.log(JSON.stringify({ file: inv.file }));',
        ].join('\n'));
        // Use tsx's supported Node loader: the CLI starts an unrelated IPC server,
        // which restricted executors can forbid. Keep the separate process and real store proof.
        const tsx = createRequire(import.meta.url).resolve('tsx');
        const ran = spawnSync(process.execPath, ['--import', tsx, script], {
            encoding: 'utf8', timeout: 60_000,
            env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', HOME: path.join(executorA, 'home'), RUNNER_TEMP: path.join(executorA, 'tmp'),
                TMPDIR: path.join(executorA, 'tmp'), [RECOVERY_DIR_ENV]: mountA },
        });
        expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: '' });
        const written = JSON.parse(ran.stdout.trim().split('\n').pop()!) as { file: string };
        expect(path.dirname(written.file)).toBe(mountA);
        const fileName = path.basename(written.file);
        expect(fileName).toBe(recoveryFileName(BINDING));

        // Runner loss: executor A, its home and temp are gone. The store survives and is mounted on executor B at another path.
        rmSync(executorA, { recursive: true, force: true });
        const mountB = path.join(root, 'store-mount-b');
        cpSync(mountA, mountB, { recursive: true });
        rmSync(mountA, { recursive: true, force: true });
        chmodSync(mountB, 0o700);
        const checkB = verifyRecoveryStore({ GITHUB_ACTIONS: 'true', HOME: path.join(root, 'executor-b-home'), [RECOVERY_DIR_ENV]: mountB });
        expect(checkB.ok).toBe(true);
        const storeB = (checkB as { ok: true; store: VerifiedStore }).store;

        // The run's in-memory receipt carried no key (Sam's 791b3780 reproduction: HOLD, empty captured ids).
        expect(readFileSync(path.join(mountB, fileName), 'utf8')).toContain(K[3]);

        // The account was deleted; attempt 2's report and the late commit of attempt 7 both survive owner-less.
        const s = fresh({ reports: [
            { id: 'retry-row', idempotency_key: K[0], user_id: null },
            { id: 'other', idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: 'someone-else' },
            { id: 'unrelated-ownerless', idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: null },
        ], authUser: false, sessions: 0, profiles: 0, queries: [] });
        const admin = fakeAdmin(s);
        // Before the late commit lands, attempt 7 is unresolved: HOLD, nothing deleted.
        expect((await recoverFromInventory(admin, storeB, fileName)).verdict).toMatchObject({ verdict: 'HOLD', evidence: { unresolvedAttempts: '7' } });
        expect(s.deletes).toEqual([]);
        s.reports.push({ id: 'late', idempotency_key: K[3], user_id: null });
        s.queries = [];
        const recovered = await recoverFromInventory(admin, storeB, fileName);
        expect(recovered.verdict).toMatchObject({ verdict: 'PASS', evidence: { deleted: 2, recordedAttempts: 3, recoveryInventory: 'retired' } });
        expect(s.deletes).toEqual([{ column: 'id', values: ['retry-row', 'late'] }]);
        // Located only by owner uid, recorded key and id: no owner-less sweep, no time window, no delete by key.
        expect([...new Set(s.queries!.filter((q) => q.startsWith('user_issue_reports.')))].sort())
            .toEqual(['user_issue_reports.id', 'user_issue_reports.idempotency_key', 'user_issue_reports.user_id']);
        expect(s.reports.map((r) => r.id).sort()).toEqual(['other', 'unrelated-ownerless']);
        expect(readdirSync(mountB)).toEqual([RECOVERY_STORE_MARKER]);
    }, 90_000);
});
