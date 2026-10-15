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
const req = (events: string[] | null, outcome?: { status?: number | null; failure?: string }) => ({
    url: () => 'https://us.i.posthog.com/e/?ip=1',
    method: () => 'POST',
    isNavigationRequest: () => false,
    frame: () => ({}),
    postDataBuffer: () => (events === null ? null : Buffer.from(JSON.stringify(events.map((event) => ({ event, properties: { journey_id: 'j' } }))))),
    response: async () => (outcome?.status === null ? null : { status: () => outcome?.status ?? 200 }),
    failure: () => (outcome?.failure ? { errorText: outcome.failure } : null),
});
const settle = () => new Promise((r) => setTimeout(r, 0));
const SAVE = ['session_saved', 'transcript_authority', 'filler_measurement', 'model_attribution_receipt'];

describe('smoke item 2 — the HTTP outcome of the SAME request that carried each family', () => {
    it.each([
        [200, '2xx'], [204, '2xx'], [301, '3xx'], [400, '4xx'], [413, '4xx'], [503, '5xx'], [99, 'other_status'], [null, 'other_status'],
    ] as const)('status %s → %s', (status, cls) => expect(statusClass(status as number | null)).toBe(cls));
    it.each([['net::ERR_ABORTED', 'aborted'], ['NS_BINDING_ABORTED', 'aborted'], ['net::ERR_CONNECTION_RESET', 'failed'], [null, 'failed']] as const)(
        'browser failure %s → %s', (text, cls) => expect(failureClass(text)).toBe(cls));

    it('success, rejection, failure and abort are each bound to the request that carried the family', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const ok = req(['session_saved']); const rejected = req(['transcript_authority'], { status: 400 });
        const failed = req(['filler_measurement'], { failure: 'net::ERR_CONNECTION_RESET' }); const aborted = req(['model_attribution_receipt'], { failure: 'net::ERR_ABORTED' });
        for (const r of [ok, rejected, failed, aborted]) page.emit('request', r);
        page.emit('requestfinished', ok); page.emit('requestfinished', rejected);
        page.emit('requestfailed', failed); page.emit('requestfailed', aborted);
        await settle();
        expect(tap.transportEvidence(SAVE)).toMatchObject({
            transport_session_saved: '2xx:1', transport_transcript_authority: '4xx:1', transport_filler_measurement: 'failed:1', transport_model_attribution_receipt: 'aborted:1',
            transport_blind_requests: 0,
        });
    });
    it('concurrent requests settle out of order and each keeps its own outcome', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const a = req(['session_saved', 'transcript_authority'], { status: 500 }); const b = req(['filler_measurement']);
        page.emit('request', a); page.emit('request', b);
        page.emit('requestfinished', b); page.emit('requestfinished', a);
        await settle();
        expect(tap.transportEvidence(SAVE)).toMatchObject({ transport_session_saved: '5xx:1', transport_transcript_authority: '5xx:1', transport_filler_measurement: '2xx:1', transport_model_attribution_receipt: 'none' });
    });
    it('a retried batch is a new request: both outcomes are kept for the family', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const first = req(['session_saved'], { failure: 'net::ERR_TIMED_OUT' }); const retry = req(['session_saved']);
        page.emit('request', first); page.emit('requestfailed', first);
        page.emit('request', retry); page.emit('requestfinished', retry);
        await settle();
        expect(tap.transportEvidence(['session_saved']).transport_session_saved).toBe('2xx:1,failed:1');
    });
    it('an opaque (blind) request is counted apart and never attributed to a family; an unsettled one is pending, then unobservable', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const blind = req(null); const unsettled = req(['session_saved']);
        page.emit('request', blind); page.emit('request', unsettled);
        page.emit('requestfinished', blind);
        await settle();
        expect(tap.transportEvidence(['session_saved'])).toEqual({ transport_session_saved: 'pending:1', transport_blind_requests: 1, transport_blind_outcomes: '2xx:1' });
        tap.detachTransport();
        expect(tap.transportEvidence(['session_saved']).transport_session_saved).toBe('unobservable:1');
    });
    it('a finished request with no response object is unobservable, not 2xx', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const r = req(['session_saved'], { status: null });
        page.emit('request', r); page.emit('requestfinished', r);
        await settle();
        expect(tap.transportEvidence(['session_saved']).transport_session_saved).toBe('unobservable:1');
    });
    it('detach removes the outcome listeners: a later outcome does not rewrite the record', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const r = req(['session_saved'], { failure: 'net::ERR_FAILED' });
        page.emit('request', r);
        tap.detachTransport();
        expect(page.listenerCount('requestfinished') + page.listenerCount('requestfailed')).toBe(0);
        page.emit('requestfailed', r);
        await settle();
        expect(tap.transportEvidence(['session_saved']).transport_session_saved).toBe('unobservable:1');
    });
    it('the evidence is content-free: names, closed outcomes and counts only', async () => {
        const page = new FakePage(); const tap = new AnalyticsTap(); tap.attach(page as never);
        const r = req(['session_saved']); page.emit('request', r); page.emit('requestfinished', r); await settle();
        const ev = tap.transportEvidence(SAVE);
        for (const v of Object.values(ev)) expect(String(v)).toMatch(/^(none|\d+|([a-z0-9_]+:\d+)(,[a-z0-9_]+:\d+)*)$/);
        expect(JSON.stringify(ev)).not.toMatch(/posthog|https?:|journey/);
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
