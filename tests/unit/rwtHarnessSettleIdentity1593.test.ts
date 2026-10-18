// @vitest-environment node
/**
 * #1593 (Sam case-1 diagnosis, live RWT run 39136771332) — two harness defects behind the case-1 dominant stop:
 *  1. CoachingGenerationTap.settle() waited on the requests open when it STARTED, then closed EVERY outstanding request, so
 *     a request sent during a mid-scenario settle was closed at age ~1 ms and its later successful answer was ignored.
 *  2. practiceAgainEvidence read the saved take's identity when the review appeared — before persistence — and never
 *     refreshed it, so `saveTakePersisted:false` / a stale id reached the two-take coaching read.
 * Deterministic controls on a fake page; nothing is sent to any provider. Budget gates are unchanged: an unanswered or
 * still-in-flight exchange stays HOLD.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CoachingGenerationTap } from '../live/helpers/coachingGenerationTap';
import { coachingRequestBudgetRow, exchangeTimeline } from '../live/helpers/rwtCoachingCollector';
import { savedTakeIdentity } from '../live/helpers/rwtJourney';

type Handler = (arg: unknown) => void;
class FakePage {
    private readonly handlers = new Map<string, Handler[]>();
    on(event: string, handler: Handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); }
    emit(event: string, arg: unknown) { for (const h of this.handlers.get(event) ?? []) h(arg); }
}
const coachingRequest = (sessionId: string) => ({
    url: () => 'https://example.supabase.co/functions/v1/get-ai-suggestions',
    method: () => 'POST',
    postDataJSON: () => ({ sessionId, product: 'open_mic', diagnostic_request_id: `req-${sessionId}`, diagnostic_attempt_id: `att-${sessionId}`, client_attempt: 1 }),
});
const answer = (request: unknown) => ({ request: () => request, status: () => 200, json: async () => ({ diagnostics: { provider_attempts: 1 } }) });
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const receiptRows = () => {
    const rows: { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }[] = [];
    return { rows, row: (step: string, verdict: string, detail: string, evidence?: Record<string, unknown>) => { rows.push({ step, verdict, detail, evidence }); } };
};
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

describe('CoachingGenerationTap.settle — each request judged against its OWN allowance (#1593)', () => {
    it('SAM\'S REPRO: a request sent DURING settle is not closed at age ~1 ms; its later answer is recorded', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const first = coachingRequest('take-1');
        page.emit('request', first);
        const settling = tap.settle(1_000);
        const second = coachingRequest('take-2');
        setTimeout(() => page.emit('request', second), 10); // arrives while settle is still waiting on take-1
        setTimeout(() => page.emit('response', answer(first)), 80); // the old settle closed take-2 here (age ~70 ms)
        setTimeout(() => page.emit('response', answer(second)), 150); // well inside its own 1,000 ms allowance
        expect(await settling).toEqual({ unanswered: 0, bodyPending: 0, inFlight: 0 });
        expect(tap.exchanges.map((e) => [e.sent.sessionId, e.outcome])).toEqual([['take-1', 'answered'], ['take-2', 'answered']]);
        const receipt = receiptRows();
        coachingRequestBudgetRow(receipt, tap, { maximum: 2 });
        expect(receipt.rows[0].verdict).toBe('PASS');
    });

    it('a request still inside its allowance at settle\'s deadline is LEFT OPEN (inFlight), not closed; a later settle records its answer', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const silent = coachingRequest('take-1');
        page.emit('request', silent); // never answered: its allowance ends with settle's deadline (~100 ms)
        const settling = tap.settle(100);
        const late = coachingRequest('take-2');
        setTimeout(() => page.emit('request', late), 60); // its own allowance runs to ~160 ms
        expect(await settling).toEqual({ unanswered: 1, bodyPending: 0, inFlight: 1 });
        expect(tap.exchanges.map((e) => [e.sent.sessionId, e.outcome])).toEqual([['take-1', 'unanswered']]);
        // In flight at the end of a scenario is HOLD with its own reason, never PASS and never a fabricated "unanswered".
        const receipt = receiptRows();
        coachingRequestBudgetRow(receipt, tap, { maximum: 2 });
        expect(receipt.rows[0]).toMatchObject({ verdict: 'HOLD', evidence: { inFlightAtEnd: 1, unansweredAtBound: 1 } });
        expect(receipt.rows[0].detail).toMatch(/still inside its allowance when the scenario ended/);
        page.emit('response', answer(late));
        await tick(5);
        expect(await tap.settle(100)).toEqual({ unanswered: 0, bodyPending: 0, inFlight: 0 });
        expect(tap.exchanges.map((e) => [e.sent.sessionId, e.outcome])).toEqual([['take-1', 'unanswered'], ['take-2', 'answered']]);
    });

    it('a request older than its allowance is still closed honestly as unanswered, and its late answer is ignored', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const silent = coachingRequest('take-1');
        page.emit('request', silent);
        await tick(70);
        expect(await tap.settle(50)).toEqual({ unanswered: 1, bodyPending: 0, inFlight: 0 });
        page.emit('response', answer(silent));
        await tick(10);
        expect(tap.exchanges.map((e) => e.outcome)).toEqual(['unanswered']);
    });

    it('two concurrent settles both wake on a record (no waiter is starved)', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const r = coachingRequest('take-1');
        page.emit('request', r);
        const started = Date.now();
        const both = Promise.all([tap.settle(5_000), tap.settle(5_000)]);
        setTimeout(() => page.emit('response', answer(r)), 30);
        await both;
        expect(Date.now() - started).toBeLessThan(1_000);
    });
});

describe('budget row correlation evidence is content-free and bindable to the Edge diagnostic (#1593)', () => {
    it('each exchange carries its outcome, timings and the SHA-256 of its request/attempt ids — never the raw ids', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const r = coachingRequest('take-1');
        page.emit('request', r);
        page.emit('response', answer(r));
        await tap.settle(500);
        const timeline = exchangeTimeline(tap.exchanges);
        const [outcome, status, sentAt, recordedAt, clientMs, requestSha, attemptSha, clientAttempt] = timeline.split('|');
        expect([outcome, status, clientAttempt]).toEqual(['answered', '200', '1']);
        expect(Number(sentAt)).toBeGreaterThan(0);
        expect(Number(recordedAt)).toBeGreaterThanOrEqual(Number(sentAt));
        expect(Number(clientMs)).toBeGreaterThanOrEqual(0);
        expect([requestSha, attemptSha]).toEqual([sha('req-take-1'), sha('att-take-1')]);
        const receipt = receiptRows();
        coachingRequestBudgetRow(receipt, tap, { maximum: 1 });
        const published = JSON.stringify(receipt.rows[0]);
        expect(published).toContain(sha('req-take-1'));
        expect(published).not.toContain('req-take-1"');
        expect(published).not.toContain('take-1|');
        expect(Object.values(receipt.rows[0].evidence!).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))).toBe(true);
    });
});

describe('practiceAgainEvidence re-reads the saved take AFTER persistence (#1593)', () => {
    it('savedTakeIdentity reports what the page says now — the stale pre-persistence snapshot is not kept', async () => {
        const attrs: Record<string, string | null> = { 'data-session-persisted-id': null, 'data-session-persisted': null };
        const page = {
            evaluate: async (fn: () => unknown) => {
                const prior = globalThis.document;
                (globalThis as { document?: unknown }).document = { documentElement: { getAttribute: (k: string) => attrs[k] ?? null } };
                try { return fn(); } finally { (globalThis as { document?: unknown }).document = prior; }
            },
        };
        expect(await savedTakeIdentity(page as never, 'take-1')).toEqual({ savedSessionId: null, saveTakePersisted: false, saveTakeNewSession: null });
        attrs['data-session-persisted-id'] = 'take-2';
        attrs['data-session-persisted'] = 'true';
        expect(await savedTakeIdentity(page as never, 'take-1')).toEqual({ savedSessionId: 'take-2', saveTakePersisted: true, saveTakeNewSession: true });
    });

    it('source order: the identity is re-read after the bounded persistence wait, before the repeat action', () => {
        const src = readFileSync('tests/live/helpers/rwtJourney.ts', 'utf8');
        const fn = src.slice(src.indexOf('export async function practiceAgainEvidence('));
        const wait = fn.indexOf("getAttribute('data-session-persisted') === 'true',\n                null, { timeout: 60_000 })");
        const reread = fn.indexOf('Object.assign(ev, await savedTakeIdentity(page, sessionId));');
        const again = fn.indexOf('const again = page.getByTestId(');
        expect(wait).toBeGreaterThan(-1);
        expect(reread).toBeGreaterThan(wait);
        expect(again).toBeGreaterThan(reread);
    });
});
