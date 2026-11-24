// @vitest-environment node
/**
 * J3.b run 45355779902: the repeat take's coaching request (sent 08:29:29.3, superseded on the same page at +5.0 s, never
 * aborted) had no answer when the "next Start without a hold" step opened /session as a new document at +10.6 s. That
 * navigation cancels the page's in-flight fetch, so the answer could never reach the browser and the repeat-coaching rows held.
 *
 * Controls: (1) the journey settles every sent coaching request BEFORE the next Start's navigation; (2) the navigation really is
 * a new document (so the order matters); (3) a deferred answer that arrives inside its allowance is recorded as answered by
 * that settle, and the designed same-page interruption still happens before it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CoachingGenerationTap } from '../live/helpers/coachingGenerationTap';

const here = path.dirname(fileURLToPath(import.meta.url));
const journey = readFileSync(path.join(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
const shared = readFileSync(path.join(here, '../live/helpers/rwtJourney.ts'), 'utf8');

const stepBody = (src: string, name: string): string => {
    const start = src.indexOf(`test.step('${name}'`);
    if (start < 0) throw new Error(`step not found: ${name}`);
    return src.slice(start, src.indexOf('\n        });', start));
};

describe('J3.b — the repeat take\'s coaching request settles before the next Start leaves the page', () => {
    it('the next Start step awaits the coaching settle before nextStartEvidence', () => {
        const body = stepBody(journey, 'next Start without a hold');
        const settle = body.indexOf('await generations.settle()');
        const next = body.indexOf('await nextStartEvidence(');
        expect(settle).toBeGreaterThan(-1);
        expect(next).toBeGreaterThan(settle);
    });

    it('nextStartEvidence opens /session as a new document first, which is why the order matters', () => {
        const start = shared.indexOf('export async function nextStartEvidence(');
        expect(start).toBeGreaterThan(-1);
        const body = shared.slice(start, shared.indexOf('\n}\n', start));
        expect(body).toContain("await page.goto('/session')");
    });

    it('the designed interruption is unchanged: Practice again (and its rapid repeat) runs before the settle', () => {
        const practice = journey.indexOf('again = await practiceAgainEvidence(');
        const settle = journey.indexOf('await generations.settle();\n            const next = await nextStartEvidence(');
        expect(practice).toBeGreaterThan(-1);
        expect(settle).toBeGreaterThan(practice);
    });

    it('rapid repeat unchanged (Sam 1795523718): nothing waits on coaching from Practice again until the next Start step', () => {
        const from = journey.indexOf("await test.step('Practice again");
        const to = journey.indexOf("await test.step('next Start without a hold'");
        expect(from).toBeGreaterThan(-1);
        expect(to).toBeGreaterThan(from);
        const between = journey.slice(from, to);
        expect(between).toContain('again = await practiceAgainEvidence(');
        expect(between).not.toMatch(/settle\(|waitForResponse|get-ai-suggestions/);
    });

    it('rapid repeat unchanged: practiceAgainEvidence itself awaits no coaching answer', () => {
        const start = shared.indexOf('export async function practiceAgainEvidence(');
        expect(start).toBeGreaterThan(-1);
        const body = shared.slice(start, shared.indexOf('\n}\n', start));
        expect(body).not.toMatch(/settle\(|waitForResponse|get-ai-suggestions/);
    });

    it('the late answer is captured BEFORE the next Start navigates (scaled timeline, the step\'s own order)', async () => {
        type Handler = (arg: unknown) => void;
        const handlers = new Map<string, Handler[]>();
        const page = { on: (e: string, h: Handler) => handlers.set(e, [...(handlers.get(e) ?? []), h]) };
        const emit = (e: string, arg: unknown) => { for (const h of handlers.get(e) ?? []) h(arg); };
        const request = {
            url: () => 'https://example.supabase.co/functions/v1/get-ai-suggestions', method: () => 'POST',
            postDataJSON: () => ({ sessionId: 'repeat-take', product: 'focus_points', diagnostic_request_id: 'r', diagnostic_attempt_id: 'a', client_attempt: 1 }),
        };
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const order: string[] = [];
        emit('request', request);
        order.push('repeat Start, request in flight');
        // The answer lands at 106 ms (the live 10.6 s at 1/100 scale), after the run's navigation moment would have been.
        setTimeout(() => { order.push('answer'); emit('response', { request: () => request, status: () => 200, json: async () => ({ diagnostics: { outcome: 'success' } }) }); }, 106);
        // The step: settle, then navigate. Navigation is where the page (and any unanswered fetch) would be replaced.
        await tap.settle(1_000);
        order.push('navigate');
        expect(order).toEqual(['repeat Start, request in flight', 'answer', 'navigate']);
        expect(tap.exchanges.map((e) => [e.sent.sessionId, e.outcome])).toEqual([['repeat-take', 'answered']]);
    });

    it('a deferred answer (no headers for 10 s) is recorded as answered by that settle, not lost', async () => {
        type Handler = (arg: unknown) => void;
        const handlers = new Map<string, Handler[]>();
        const page = { on: (e: string, h: Handler) => handlers.set(e, [...(handlers.get(e) ?? []), h]) };
        const emit = (e: string, arg: unknown) => { for (const h of handlers.get(e) ?? []) h(arg); };
        const request = {
            url: () => 'https://example.supabase.co/functions/v1/get-ai-suggestions', method: () => 'POST',
            postDataJSON: () => ({ sessionId: 'repeat-take', product: 'focus_points', diagnostic_request_id: 'r', diagnostic_attempt_id: 'a', client_attempt: 1 }),
        };
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        emit('request', request);
        // Scaled: the answer lands at 100 ms of a 1,000 ms allowance (10 s of the live 60 s bound).
        setTimeout(() => emit('response', { request: () => request, status: () => 200, json: async () => ({ diagnostics: { outcome: 'success' } }) }), 100);
        expect(await tap.settle(1_000)).toEqual({ unanswered: 0, bodyPending: 0, inFlight: 0 });
        expect(tap.exchanges.map((e) => [e.sent.sessionId, e.outcome, e.status])).toEqual([['repeat-take', 'answered', 200]]);
    });

    it('negative control: with no settle, a navigation before the answer leaves the request open and nothing is recorded', async () => {
        type Handler = (arg: unknown) => void;
        const handlers = new Map<string, Handler[]>();
        const page = { on: (e: string, h: Handler) => handlers.set(e, [...(handlers.get(e) ?? []), h]) };
        const request = {
            url: () => 'https://example.supabase.co/functions/v1/get-ai-suggestions', method: () => 'POST',
            postDataJSON: () => ({ sessionId: 'repeat-take', product: 'focus_points' }),
        };
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        for (const h of handlers.get('request') ?? []) h(request);
        // The page is replaced: no response and no failure event ever arrives (what the live tap saw).
        expect(tap.exchanges).toEqual([]);
        expect(await tap.settle(50)).toEqual({ unanswered: 1, bodyPending: 0, inFlight: 0 });
        expect(tap.exchanges.map((e) => e.outcome)).toEqual(['unanswered']);
    });
});
