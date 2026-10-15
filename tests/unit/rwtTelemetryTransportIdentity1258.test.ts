// @vitest-environment node
/**
 * #1258 smoke run 38654466793 (PM 6182446740) — two offline diagnostics; neither changes a verdict or relaxes a rule.
 *  Item 2: each event-carrying PostHog request the tap decodes keeps the closed HTTP outcome of THAT SAME request object,
 *          so "sent by the page" can be told apart from "acknowledged over HTTP" (still not proof of ingestion).
 *  Item 3: the bound request's terminal coaching rows report their event-uuid / attempt identity as counts and closed
 *          values, so a duplicate can be classified without publishing raw ids. The FAIL and exactly-once rule stand.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@playwright/test', () => ({ expect: Object.assign(() => ({}), { soft: () => ({ toBe: () => undefined }) }), test: {} }));
const { AnalyticsTap, failureClass, statusClass } = await import('../live/helpers/rwtJourney');
const { evaluateCoachingDiagnosticReceipt, terminalIdentity } = await import('../../frontend/src/services/telemetry/coachingDiagnosticReceipt');

// ── Item 2: transport outcome per request ────────────────────────────────────────────────────────────────────────────

/** A Playwright-like page and request: the tap sees `request`, then `requestfinished` or `requestfailed` for the SAME object. */
class FakePage extends EventEmitter {
    mainFrame() { return null; }
}
type Ev = { event: string; journey?: string; attempt?: string; subjectJourney?: string; subjectAttempt?: string };
const FIRST = { journeyId: 'journey-1', attemptId: 'attempt-1' };
const SECOND = { journeyId: 'journey-1', attemptId: 'attempt-2' };
const of = (take: { journeyId: string; attemptId: string }, event: string): Ev => ({ event, journey: take.journeyId, attempt: take.attemptId });
/** `response` may be a deferred promise, so a response can resolve AFTER capture closed. */
const req = (events: Ev[] | null, outcome?: { status?: number | null; failure?: string; response?: Promise<unknown> }) => ({
    url: () => 'https://us.i.posthog.com/e/?ip=1',
    method: () => 'POST',
    isNavigationRequest: () => false,
    frame: () => ({}),
    postDataBuffer: () => (events === null ? null : Buffer.from(JSON.stringify(events.map((e) => ({
        event: e.event, properties: {
            ...(e.journey ? { journey_id: e.journey } : {}), ...(e.attempt ? { attempt_id: e.attempt } : {}),
            ...(e.subjectJourney ? { subject_journey_id: e.subjectJourney } : {}), ...(e.subjectAttempt ? { subject_attempt_id: e.subjectAttempt } : {}),
        },
    }))))),
    response: () => outcome?.response ?? Promise.resolve(outcome?.status === null ? null : { status: () => outcome?.status ?? 200 }),
    failure: () => (outcome?.failure ? { errorText: outcome.failure } : null),
});
const settle = () => new Promise((r) => setTimeout(r, 0));
const SAVE = ['session_saved', 'transcript_authority', 'filler_measurement', 'model_attribution_receipt'];
const tapOn = () => { const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never); return { page, tap }; };

describe('smoke item 2 — the HTTP outcome of the SAME request that carried each of the FIRST take\'s events', () => {
    it.each([
        [200, '2xx'], [204, '2xx'], [301, '3xx'], [400, '4xx'], [413, '4xx'], [503, '5xx'], [99, 'other_status'], [null, 'other_status'],
    ] as const)('status %s → %s', (status, cls) => expect(statusClass(status as number | null)).toBe(cls));
    it.each([['net::ERR_ABORTED', 'aborted'], ['NS_BINDING_ABORTED', 'aborted'], ['net::ERR_CONNECTION_RESET', 'failed'], [null, 'failed']] as const)(
        'browser failure %s → %s', (text, cls) => expect(failureClass(text)).toBe(cls));

    it('success, rejection, failure and abort are each bound to the request that carried the first take\'s event', async () => {
        const { page, tap } = tapOn();
        const ok = req([of(FIRST, 'session_saved')]); const rejected = req([of(FIRST, 'transcript_authority')], { status: 400 });
        const failed = req([of(FIRST, 'filler_measurement')], { failure: 'net::ERR_CONNECTION_RESET' }); const aborted = req([{ ...of(FIRST, 'model_attribution_receipt'), subjectJourney: FIRST.journeyId, subjectAttempt: FIRST.attemptId }], { failure: 'net::ERR_ABORTED' });
        for (const r of [ok, rejected, failed, aborted]) page.emit('request', r);
        page.emit('requestfinished', ok); page.emit('requestfinished', rejected);
        page.emit('requestfailed', failed); page.emit('requestfailed', aborted);
        await settle();
        expect(tap.transportEvidence(FIRST, SAVE)).toMatchObject({
            transport_session_saved: '2xx:1', transport_transcript_authority: '4xx:1', transport_filler_measurement: 'failed:1', transport_model_attribution_receipt: 'aborted:1',
            transport_unbound_events: 0, transport_blind_requests: 0,
        });
    });
    it.each([
        ['first take failed, later take 2xx', { net: 'net::ERR_CONNECTION_RESET' }, undefined, 'failed:1'],
        ['first take 2xx, later take failed', undefined, { net: 'net::ERR_CONNECTION_RESET' }, '2xx:1'],
    ])('%s → only the FIRST take\'s own request decides (never the newest take)', async (_l, firstFail, secondFail, expected) => {
        const { page, tap } = tapOn();
        const a = req([of(FIRST, 'session_saved')], firstFail ? { failure: firstFail.net } : undefined);
        const b = req([of(SECOND, 'session_saved')], secondFail ? { failure: secondFail.net } : undefined);
        page.emit('request', a); page.emit('request', b);
        page.emit(firstFail ? 'requestfailed' : 'requestfinished', a); page.emit(secondFail ? 'requestfailed' : 'requestfinished', b);
        await settle();
        expect(tap.transportEvidence(FIRST, ['session_saved']).transport_session_saved).toBe(expected);
        expect(tap.transportEvidence(SECOND, ['session_saved']).transport_session_saved).toBe(firstFail ? '2xx:1' : 'failed:1');
    });
    it('a mixed batch (two takes in one request) gives its outcome to the selected take\'s events only', async () => {
        const { page, tap } = tapOn();
        const mixed = req([of(FIRST, 'session_saved'), of(SECOND, 'session_saved'), of(SECOND, 'transcript_authority')], { status: 500 });
        page.emit('request', mixed); page.emit('requestfinished', mixed);
        await settle();
        expect(tap.transportEvidence(FIRST, ['session_saved', 'transcript_authority'])).toMatchObject({ transport_session_saved: '5xx:1', transport_transcript_authority: 'none' });
    });
    it('a retried batch is a new request: both outcomes are kept for the first take\'s family', async () => {
        const { page, tap } = tapOn();
        const first = req([of(FIRST, 'session_saved')], { failure: 'net::ERR_TIMED_OUT' }); const retry = req([of(FIRST, 'session_saved')]);
        page.emit('request', first); page.emit('requestfailed', first);
        page.emit('request', retry); page.emit('requestfinished', retry);
        await settle();
        expect(tap.transportEvidence(FIRST, ['session_saved']).transport_session_saved).toBe('2xx:1,failed:1');
    });
    it('opaque requests and identity-less events are counted apart, never bound; an unknown take is take_unknown', async () => {
        const { page, tap } = tapOn();
        const blind = req(null); const unbound = req([{ event: 'session_saved' }]);
        page.emit('request', blind); page.emit('request', unbound);
        page.emit('requestfinished', blind); page.emit('requestfinished', unbound);
        await settle();
        expect(tap.transportEvidence(FIRST, ['session_saved'])).toEqual({ transport_session_saved: 'none', transport_unbound_events: 1, transport_blind_requests: 1, transport_blind_outcomes: '2xx:1' });
        expect(tap.transportEvidence(null, ['session_saved']).transport_session_saved).toBe('take_unknown');
    });
    it('the evidence is content-free: closed outcomes and counts only', async () => {
        const { page, tap } = tapOn();
        const r = req([of(FIRST, 'session_saved')]); page.emit('request', r); page.emit('requestfinished', r); await settle();
        const ev = tap.transportEvidence(FIRST, SAVE);
        for (const v of Object.values(ev)) expect(String(v)).toMatch(/^(none|take_unknown|\d+|([a-z0-9_]+:\d+)(,[a-z0-9_]+:\d+)*)$/);
        expect(JSON.stringify(ev)).not.toMatch(/posthog|https?:|journey|attempt-/);
    });
});

describe('smoke item 2 — capture shutdown (PM 6182647952 §2)', () => {
    it('a response that resolves AFTER detach never rewrites the unobservable record', async () => {
        const { page, tap } = tapOn();
        let resolve!: (v: unknown) => void;
        const r = req([of(FIRST, 'session_saved')], { response: new Promise((res) => { resolve = res; }) });
        page.emit('request', r); page.emit('requestfinished', r); // the callback is now awaiting response()
        tap.detachTransport();
        resolve({ status: () => 200 });
        await settle();
        expect(tap.transportEvidence(FIRST, ['session_saved']).transport_session_saved).toBe('unobservable:1');
    });
    it('a NEW request after detach makes no transport record (the sent-event capture itself is unchanged)', async () => {
        const { page, tap } = tapOn();
        tap.detachTransport();
        const r = req([of(FIRST, 'session_saved')]);
        page.emit('request', r); page.emit('requestfinished', r);
        await settle();
        expect(tap.transports).toHaveLength(0);
        expect(tap.sent('session_saved')).toHaveLength(1);
        expect(page.listenerCount('requestfinished') + page.listenerCount('requestfailed')).toBe(0);
    });
    it('a repeated attach does not stack outcome listeners or duplicate a request\'s record', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap();
        tap.attach(page as never); tap.attach(page as never);
        expect([page.listenerCount('requestfinished'), page.listenerCount('requestfailed')]).toEqual([1, 1]);
        const r = req([of(FIRST, 'session_saved')]);
        page.emit('request', r); page.emit('requestfinished', r);
        await settle();
        expect(tap.transports).toHaveLength(1);
        expect(tap.transportEvidence(FIRST, ['session_saved']).transport_session_saved).toBe('2xx:1');
    });
    it('the spec closes transport capture on every exit (the afterEach backstop, beside the sampler)', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('../live/rwt-open-mic-first-session.live.spec.ts', import.meta.url), 'utf8');
        expect(src).toContain('activeTap?.detachTransport();');
        expect(src).toContain('activeTap = tap;');
        expect(src).toContain('tap.transportEvidence(takeStartedAfter(tap.events, firstTakeFrom, repeatWindow?.[0] ?? tap.events.length), FIRST_TAKE_SAVE_FAMILIES)');
    });
});

// ── Item 3: terminal-row identity ────────────────────────────────────────────────────────────────────────────────────

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const REQ = '33333333-3333-4333-8333-333333333333';
const ATT = '44444444-4444-4444-8444-444444444444';
const ATT2 = '55555555-5555-4555-8555-555555555555';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RELEASE = 'c'.repeat(40);
const expected = { requestSha256: sha(REQ), attemptSha256: sha(ATT), product: 'open_mic' as const, configuredModel: 'gemini-3.8-flash', outcome: 'success' as const };
const diag = (over: Record<string, unknown> = {}) => ({
    event: 'ai_coaching_diagnostic', requestId: REQ, attemptId: ATT, outcome: 'success', product: 'open_mic', configuredModel: 'gemini-3.8-flash',
    observedModel: 'gemini-3.8-flash-001', status: 200, providerStatus: 200, source: 'fresh', providerAttempts: 1, clientReleaseId: RELEASE,
    coachingDiagnosticId: null, uuid: U1, clientAttempt: 1, ...over,
});
const feedback = { event: 'feedback_submit', requestId: null, attemptId: null, outcome: 'storage_ok', product: null, configuredModel: null, observedModel: null,
    status: null, providerStatus: null, source: null, providerAttempts: null, clientReleaseId: null, coachingDiagnosticId: REQ };
const judge = (rows: Array<Record<string, unknown>>) => evaluateCoachingDiagnosticReceipt(rows as never, expected, RELEASE, sha);

describe('smoke item 3 — terminal-row identity (diagnostic only; FAIL and exactly-once unchanged)', () => {
    it('one terminal row → single, and the verdict is unchanged (PASS)', () => {
        expect(judge([diag(), feedback])).toMatchObject({ verdict: 'PASS', terminalIdentity: { terminalRows: 1, classification: 'single' } });
    });
    it('the same event uuid twice (e.g. a duplicated query or delivery row) → repeated_event_identity; still FAIL', () => {
        const r = judge([diag(), diag(), feedback]);
        expect(r.verdict).toBe('FAIL');
        expect(r.reasons).toContain('duplicate_terminal_diagnostic');
        expect(r.terminalIdentity).toMatchObject({ terminalRows: 2, distinctEventUuids: 1, distinctAttemptIds: 1, classification: 'repeated_event_identity' });
    });
    it('different uuids for the same attempt → distinct_records_one_attempt; still FAIL', () => {
        const r = judge([diag(), diag({ uuid: U2 }), feedback]);
        expect(r.verdict).toBe('FAIL');
        expect(r.terminalIdentity).toMatchObject({ distinctEventUuids: 2, distinctAttemptIds: 1, classification: 'distinct_records_one_attempt' });
    });
    it('different attempts → distinct_attempts, with each row\'s closed outcome and client attempt', () => {
        const r = judge([diag({ clientAttempt: 1 }), diag({ uuid: U2, attemptId: ATT2, clientAttempt: 2 }), feedback]);
        expect(r.verdict).toBe('FAIL');
        expect(r.terminalIdentity).toMatchObject({ distinctAttemptIds: 2, classification: 'distinct_attempts',
            rows: [{ outcome: 'success', clientAttempt: 1 }, { outcome: 'success', clientAttempt: 2 }] });
    });
    it.each([
        ['a missing uuid', { uuid: null }], ['a malformed uuid', { uuid: 'not-a-uuid' }], ['a missing attempt id', { attemptId: null }],
    ])('%s on any terminal row → unknown (missing identity is never decided)', (_l, over) => {
        const r = judge([diag(), diag({ uuid: U2, ...over }), feedback]);
        expect(r.verdict).toBe('FAIL');
        expect(r.terminalIdentity.classification).toBe('unknown');
    });
    it.each([
        ['a malformed attempt id on both rows', { attemptId: 'not-a-uuid' }, { attemptId: 'not-a-uuid', uuid: U2 }],
        ['a whitespace-padded attempt id', {}, { attemptId: ` ${ATT} `, uuid: U2 }],
    ])('%s → unknown, never distinct_records_one_attempt', (_l, a, b) => {
        expect(terminalIdentity([diag(a), diag(b)] as never).classification).toBe('unknown');
    });
    it('attempt ids are case-normalized: the same id in another case is the same attempt', () => {
        expect(terminalIdentity([diag(), diag({ uuid: U2, attemptId: ATT.toUpperCase() })] as never)).toMatchObject({ distinctAttemptIds: 1, classification: 'distinct_records_one_attempt' });
    });
    it.each([['a missing uuid', { uuid: null }], ['a malformed attempt id', { attemptId: 'x' }]])('a SINGLE terminal row with %s is unknown, not single', (_l, over) => {
        expect(terminalIdentity([diag(over)] as never)).toMatchObject({ terminalRows: 1, classification: 'unknown' });
    });
    it('zero terminal rows are explicitly none (terminalRows 0), and the verdict stays HOLD', () => {
        const r = judge([feedback]);
        expect(r.verdict).toBe('HOLD');
        expect(r.terminalIdentity).toMatchObject({ terminalRows: 0, classification: 'none' });
    });
    it('a missing or malformed client attempt is reported as missing, not guessed', () => {
        expect(terminalIdentity([diag({ clientAttempt: undefined }), diag({ uuid: U2, clientAttempt: 'x' })] as never).rows)
            .toEqual([{ outcome: 'success', clientAttempt: 'missing' }, { outcome: 'success', clientAttempt: 'missing' }]);
    });
    it('non-terminal rows (retrying) are not counted as terminal identity', () => {
        const r = judge([diag({ outcome: 'retrying', uuid: U2, attemptId: ATT2 }), diag(), feedback]);
        expect(r).toMatchObject({ verdict: 'PASS', terminalIdentity: { terminalRows: 1, classification: 'single' } });
    });
    it('the identity output carries no raw id', () => {
        const out = JSON.stringify(judge([diag(), diag({ uuid: U2 }), feedback]).terminalIdentity);
        for (const raw of [REQ, ATT, U1, U2]) expect(out).not.toContain(raw);
    });
    it('the readback query selects the event uuid and client attempt and maps them by position', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('../../scripts/telemetry-readback-qualification.mts', import.meta.url), 'utf8');
        expect(src).toMatch(/properties\.provider_attempts,\s*uuid, properties\.client_attempt\s*FROM events/);
        expect(src).toContain('uuid: c[13], clientAttempt: c[14],');
    });
});

describe('Codex P2 r4286195504 (PM 6198278021) — model_attribution_receipt is bound by its SUBJECT take, not the envelope', () => {
    const RECEIPT = 'model_attribution_receipt';
    /** A receipt: envelope = the take current when it was pushed; subject = the take it settled. */
    const receipt = (envelope: { journeyId: string; attemptId: string }, subject: { journeyId?: string; attemptId?: string }): Ev => ({
        event: RECEIPT, journey: envelope.journeyId, attempt: envelope.attemptId, subjectJourney: subject.journeyId, subjectAttempt: subject.attemptId,
    });
    it('RED-case from the review: a Retry Save receipt for A emitted while B is current is A\'s, not B\'s', async () => {
        const { page, tap } = tapOn();
        const r = req([receipt(SECOND, FIRST)]);
        page.emit('request', r); page.emit('requestfinished', r); await settle();
        expect(tap.transportEvidence(FIRST, [RECEIPT])[`transport_${RECEIPT}`]).toBe('2xx:1');
        expect(tap.transportEvidence(SECOND, [RECEIPT])[`transport_${RECEIPT}`]).toBe('none');
    });
    it('a first-try receipt (envelope = subject = A) is A\'s', async () => {
        const { page, tap } = tapOn();
        const r = req([receipt(FIRST, FIRST)], { failure: 'net::ERR_CONNECTION_RESET' });
        page.emit('request', r); page.emit('requestfailed', r); await settle();
        expect(tap.transportEvidence(FIRST, [RECEIPT])[`transport_${RECEIPT}`]).toBe('failed:1');
    });
    it.each([
        ['absent subject identity', {}],
        ['a subject journey without its attempt', { journeyId: FIRST.journeyId }],
        ['a subject attempt without its journey', { attemptId: FIRST.attemptId }],
    ])('%s is UNBOUND — never rescued by a valid envelope', async (_l, subject) => {
        const { page, tap } = tapOn();
        const r = req([receipt(FIRST, subject)]);
        page.emit('request', r); page.emit('requestfinished', r); await settle();
        expect(tap.transportEvidence(FIRST, [RECEIPT])).toMatchObject({ [`transport_${RECEIPT}`]: 'none', transport_unbound_events: 1 });
    });
    it('other families keep envelope binding, and a mixed request stays isolated per take', async () => {
        const { page, tap } = tapOn();
        // One request carrying A's session_saved (envelope A), B's session_saved (envelope B) and A's receipt pushed while B is current.
        const mixed = req([of(FIRST, 'session_saved'), of(SECOND, 'session_saved'), receipt(SECOND, FIRST)], { status: 503 });
        page.emit('request', mixed); page.emit('requestfinished', mixed); await settle();
        expect(tap.transportEvidence(FIRST, ['session_saved', RECEIPT])).toMatchObject({ transport_session_saved: '5xx:1', [`transport_${RECEIPT}`]: '5xx:1', transport_unbound_events: 0 });
        expect(tap.transportEvidence(SECOND, ['session_saved', RECEIPT])).toMatchObject({ transport_session_saved: '5xx:1', [`transport_${RECEIPT}`]: 'none' });
    });
    it('the subject identity stays in memory only: evidence output carries no id', async () => {
        const { page, tap } = tapOn();
        const r = req([receipt(SECOND, FIRST)]); page.emit('request', r); page.emit('requestfinished', r); await settle();
        expect(JSON.stringify(tap.transportEvidence(FIRST, [RECEIPT]))).not.toMatch(/journey-1|attempt-1|attempt-2/);
    });
});
