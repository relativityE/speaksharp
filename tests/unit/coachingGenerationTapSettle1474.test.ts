/**
 * #1474 (Sam 6242612760) — the coaching budget must settle EVERY SENT coaching exchange before it is read. Live RWT
 * 39075833843 / 39076238188 each recorded 2 sent / 1 answered: `settle()` waited only for bodies of responses already
 * seen, so an exchange still in flight was silently missing. These are deterministic controls on a fake page: nothing is
 * sent to any provider, and a missing answer stays HOLD — never a fabricated zero or a PASS.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CoachingGenerationTap } from '../live/helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from '../live/helpers/rwtCoachingCollector';
import { COACHING_SETTLE_BOUND_MS, EDGE_PROVIDER_BUDGET_MS } from '../live/helpers/rwtCoachingEvidence';

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
const answer = (request: unknown, providerAttempts: number) => ({
    request: () => request,
    status: () => 200,
    json: async () => ({ diagnostics: { provider_attempts: providerAttempts } }),
});
const receiptRows = () => {
    const rows: { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }[] = [];
    return { rows, row: (step: string, verdict: string, detail: string, evidence?: Record<string, unknown>) => { rows.push({ step, verdict, detail, evidence }); } };
};
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('CoachingGenerationTap.settle — every sent exchange, bounded (#1474)', () => {
    it('the bound is the Edge\'s own provider budget plus a transport allowance, read from its source', () => {
        expect(EDGE_PROVIDER_BUDGET_MS).toBe(45_000);
        expect(COACHING_SETTLE_BOUND_MS).toBe(60_000);
    });

    it('DELAYED second response: settle waits for it, records both, and the budget can PASS', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const first = coachingRequest('take-1');
        const second = coachingRequest('take-2');
        page.emit('request', first);
        page.emit('response', answer(first, 1));
        page.emit('request', second);
        // The second answer arrives 40 ms AFTER settle starts — the old settle had already returned by then.
        setTimeout(() => page.emit('response', answer(second, 1)), 40);
        const settled = await tap.settle(500);
        expect(settled).toEqual({ unanswered: 0, bodyPending: 0, inFlight: 0 });
        expect(tap.exchanges.map((e) => [e.sent.sessionId, e.outcome])).toEqual([['take-1', 'answered'], ['take-2', 'answered']]);
        const receipt = receiptRows();
        coachingRequestBudgetRow(receipt, tap, { maximum: 2, oneRequestPerSession: ['take-1', 'take-2'] });
        expect(receipt.rows[0].verdict).toBe('PASS');
    });

    it('NEVER ANSWERS: settle ends at the bound, records it as unanswered, and the budget HOLDs — not a zero, not a PASS', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const first = coachingRequest('take-1');
        const silent = coachingRequest('take-2');
        page.emit('request', first);
        page.emit('response', answer(first, 1));
        page.emit('request', silent);
        const started = Date.now();
        const settled = await tap.settle(60);
        expect(Date.now() - started).toBeGreaterThanOrEqual(55);
        expect(settled).toEqual({ unanswered: 1, bodyPending: 0, inFlight: 0 });
        const unanswered = tap.exchanges.find((e) => e.sent.sessionId === 'take-2');
        expect(unanswered).toMatchObject({ outcome: 'unanswered', status: null, diagnostics: null });
        const receipt = receiptRows();
        coachingRequestBudgetRow(receipt, tap, { maximum: 2, oneRequestPerSession: ['take-1', 'take-2'] });
        expect(receipt.rows[0].verdict).toBe('HOLD');
        expect(receipt.rows[0].detail).toMatch(/still unanswered when the bounded wait ended/);
        expect(receipt.rows[0].evidence).toMatchObject({ browserRequests: 2, answered: 1, withDiagnostics: 1, unansweredAtBound: 1 });
    });

    it('a LATE answer after the bound adds no second record for the same request', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const late = coachingRequest('take-1');
        page.emit('request', late);
        await tap.settle(20);
        page.emit('response', answer(late, 1));
        await tick(20);
        expect(tap.exchanges).toHaveLength(1);
        expect(tap.exchanges[0].outcome).toBe('unanswered');
    });

    it('Codex r4305107830: a body that never finishes is closed ONCE; a later settle does not wait for it again', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const stuck = coachingRequest('take-1');
        page.emit('request', stuck);
        page.emit('response', { request: () => stuck, status: () => 200, json: () => new Promise(() => undefined) });
        expect(await tap.settle(40)).toEqual({ unanswered: 0, bodyPending: 1, inFlight: 0 });
        expect(tap.exchanges[0]).toMatchObject({ outcome: 'body_pending', status: 200, diagnostics: null });
        const started = Date.now();
        expect(await tap.settle(5_000)).toEqual({ unanswered: 0, bodyPending: 0, inFlight: 0 });
        expect(Date.now() - started).toBeLessThan(500);
        expect(tap.exchanges).toHaveLength(1);
    });

    it('READER (Sam 6243698211): an answer delayed past the old 5 s cap but inside the bound is in the take\'s exchanges', async () => {
        vi.useFakeTimers();
        try {
            const page = new FakePage();
            const tap = new CoachingGenerationTap();
            tap.attach(page as never);
            const slow = coachingRequest('take-1');
            page.emit('request', slow);
            setTimeout(() => page.emit('response', answer(slow, 1)), 6_000);
            let read: unknown[] | null = null;
            const reading = tap.settledForSession('take-1').then((r) => { read = r; });
            await vi.advanceTimersByTimeAsync(5_000);
            expect(read, 'the reader must still be waiting at the old 5 s cap').toBeNull();
            await vi.advanceTimersByTimeAsync(1_500);
            await reading;
            expect(read).toHaveLength(1);
            expect((read as unknown as { outcome: string }[])[0].outcome).toBe('answered');
        } finally {
            vi.useRealTimers();
        }
    });

    it('Codex r4305107827: both receipt readers read through the bounded settledForSession, with no 5 s cap', () => {
        for (const f of ['tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/helpers/rwtJourney.ts']) {
            const src = readFileSync(f, 'utf8');
            expect(src).not.toMatch(/settleCoachingReason\([^)]*generations[^)]*\.settle\(\)\)/);
            expect(src).toContain('settledForSession(');
            expect(src).not.toMatch(/generations\??\.forSession\(/);
        }
    });

    it('a request the browser FAILED is recorded as failed, settles at once, and HOLDs the budget with its own reason', async () => {
        const page = new FakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const aborted = coachingRequest('take-1');
        page.emit('request', aborted);
        page.emit('requestfailed', aborted);
        const started = Date.now();
        await tap.settle(5_000);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(tap.exchanges[0]).toMatchObject({ outcome: 'failed', status: null });
        const receipt = receiptRows();
        coachingRequestBudgetRow(receipt, tap, { maximum: 1 });
        expect(receipt.rows[0].verdict).toBe('HOLD');
        expect(receipt.rows[0].detail).toMatch(/failed in the browser/);
    });
});
