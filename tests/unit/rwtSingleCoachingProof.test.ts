import type { Page, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { CoachingGenerationTap, type CoachingExchange } from '../live/helpers/coachingGenerationTap';
import { armOneCoachingProviderBoundary, singleCoachingProof } from '../live/helpers/rwtSingleCoachingProof';

const x = (status: number, attempts: number, take = 'repeat', product = 'focus_points', requestId = 'request'): CoachingExchange => ({
    status, at: 0, clientMs: 0, suggestions: null, outcome: 'answered',
    diagnostics: { provider_attempts: attempts, provider_status: status === 425 ? null : 200,
        provider: status === 425 ? 'none' : 'gemini', reason: status === 425 ? 'focus_results_pending' : 'success' },
    sent: { sessionId: take, product, requestId, attemptId: 'attempt', clientAttempt: 1, clientReleaseId: 'release' },
});
const proof = (exchanges: CoachingExchange[], browserPosts = exchanges.length) =>
    singleCoachingProof({ exchanges, browserPosts, takeId: 'repeat', product: 'focus_points' });

describe('one provider-bearing coaching exchange on the exact intended take', () => {
    it('requires a real send and the exact take and product', () => {
        expect(proof([]).reason).toBe('no_coaching_post');
        expect(proof([x(200, 1, 'first')]).reason).toBe('unexpected_take_or_product');
        expect(proof([x(200, 1, 'repeat', 'open_mic')]).reason).toBe('unexpected_take_or_product');
        expect(proof([x(200, 1)]).status).toBe('PASS');
    });
    it('counts proven pre-provider waits separately, with a hard bound and a real terminal exchange', () => {
        expect(proof([x(425, 0), x(425, 0), x(425, 0), x(200, 1)]))
            .toMatchObject({ status: 'PASS', pendingPosts: 3, providerAttempts: 1, browserPosts: 4 });
        expect(proof([x(425, 0), x(425, 0), x(425, 0), x(425, 0), x(200, 1)]).reason).toBe('too_many_posts');
        expect(proof([x(425, 0)]).reason).toBe('no_provider_exchange');
        expect(proof([x(425, 1), x(200, 1)]).status).toBe('FAIL');
        expect(proof([x(200, 1), x(425, 0)]).reason).toBe('unexpected_pending_order');
    });
    it('rejects another lifecycle or actual provider-bearing exchange', () => {
        expect(proof([x(425, 0), x(200, 1, 'repeat', 'focus_points', 'other')]).reason)
            .toBe('more_than_one_request_lifecycle');
        expect(proof([x(200, 1), x(200, 1)]).reason).toBe('more_than_one_terminal_exchange');
        expect(proof([x(200, 4)]).reason).toBe('provider_attempt_cap_exceeded');
        const borrowed = x(200, 1);
        borrowed.diagnostics = { ...borrowed.diagnostics, attempt_id: 'other-take-attempt' };
        expect(proof([borrowed]).reason).toBe('provider_receipt_identity_mismatch');
    });
    it('keeps failed provider responses for separate adjudication and never passes a missing receipt', () => {
        const unavailable = x(502, 3);
        unavailable.diagnostics = { ...unavailable.diagnostics, provider_status: 503 };
        expect(proof([unavailable])).toMatchObject({ status: 'PASS', providerAttempts: 3, terminal: unavailable });
        expect(proof([x(200, 1)], 2).status).toBe('HOLD');
        expect(proof([{ ...x(200, 1), diagnostics: null }]).status).toBe('HOLD');
        expect(proof([x(200, 0)]).reason).toBe('no_provider_attempt');
    });
});

async function boundary(options?: Parameters<typeof armOneCoachingProviderBoundary>[2]) {
    const tap = new CoachingGenerationTap();
    const register = vi.fn<(match: RegExp, handler: (route: Route) => Promise<void>) => Promise<void>>();
    await armOneCoachingProviderBoundary({ route: register } as unknown as Page, tap, options);
    const handler = register.mock.calls[0][1];
    const request = async (requestId = 'request', sessionId = 'repeat') => {
        const route = {
            request: () => ({
                method: () => 'POST',
                postDataJSON: () => ({ product: 'focus_points', sessionId,
                    diagnostic_request_id: requestId, diagnostic_attempt_id: 'attempt' }),
            }),
            continue: vi.fn(),
            abort: vi.fn(),
        };
        await handler(route as unknown as Route);
        return route;
    };
    return { tap, request };
}

describe('browser quota reservation', () => {
    it('forwards proven pending then the terminal request, but never a third provider-bearing request', async () => {
        const { tap, request } = await boundary();
        expect((await request()).continue).toHaveBeenCalledOnce();
        tap.exchanges.push(x(425, 0));
        expect((await request('other')).abort).toHaveBeenCalledOnce();
        expect((await request()).continue).toHaveBeenCalledOnce();
        tap.exchanges.push(x(200, 1));
        const blocked = await request();
        expect(blocked.continue).not.toHaveBeenCalled();
        expect(blocked.abort).toHaveBeenCalledWith('blockedbyclient');
    });
    it('only spends after the explicit request on the intended saved take', async () => {
        let requested = false;
        const { request } = await boundary({ permit: (sent) => requested && sent.sessionId === 'repeat' });
        expect((await request()).abort).toHaveBeenCalledWith('blockedbyclient');
        requested = true;
        expect((await request('request', 'first')).abort).toHaveBeenCalledWith('blockedbyclient');
        expect((await request()).continue).toHaveBeenCalledOnce();
    });
    it('does not retry a transport error that might have spent quota', async () => {
        const { tap, request } = await boundary();
        expect((await request()).continue).toHaveBeenCalledOnce();
        tap.exchanges.push({ ...x(425, 0), status: null });
        expect((await request()).abort).toHaveBeenCalledWith('blockedbyclient');
    });
    it('does not spend a retry based on pending evidence copied from another take', async () => {
        const { tap, request } = await boundary();
        await request();
        tap.exchanges.push(x(425, 0, 'first'));
        expect((await request()).abort).toHaveBeenCalledWith('blockedbyclient');
    });
});
