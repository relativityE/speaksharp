import type { Page } from '@playwright/test';
import { isMicStartReadiness, readSentRequest, type CoachingExchange, type CoachingGenerationTap } from './coachingGenerationTap';
import { EDGE_MAX_PROVIDER_ATTEMPTS } from './rwtCoachingEvidence';

type Product = 'open_mic' | 'focus_points';
type Proof = {
    status: 'PASS' | 'FAIL' | 'HOLD';
    reason: string;
    browserPosts: number;
    pendingPosts: number;
    providerAttempts: number;
    terminal: CoachingExchange | null;
};

// Mirrors the bounded same-lifecycle pre-provider wait. This isn't an exemption
// for arbitrary 425s, and a provider failure is not adjudicated by this helper.
const MAX_PENDING_POSTS = 3;
const isProvedPending = (exchange: CoachingExchange) => exchange.status === 425
    && (!exchange.outcome || exchange.outcome === 'answered')
    && exchange.diagnostics?.provider_attempts === 0
    && exchange.diagnostics?.provider_status === null
    && exchange.diagnostics?.provider === 'none'
    && (exchange.diagnostics?.reason === 'focus_results_pending' || exchange.diagnostics?.reason === 'coaching_model_pending');

export function singleCoachingProof(input: {
    takeId: string | null;
    product: Product;
    browserPosts: number;
    exchanges: readonly CoachingExchange[];
}): Proof {
    const { takeId, product, browserPosts, exchanges } = input;
    const pendingPosts = exchanges.filter(isProvedPending).length;
    const done = (status: Proof['status'], reason: string, providerAttempts = 0, terminal: CoachingExchange | null = null): Proof =>
        ({ status, reason, browserPosts, pendingPosts, providerAttempts, terminal });
    if (!takeId) return done('HOLD', 'saved_take_unproven');
    if (browserPosts === 0) return done('FAIL', 'no_coaching_post');
    if (exchanges.some(({ sent }) => sent.sessionId !== takeId || sent.product !== product)) {
        return done('FAIL', 'unexpected_take_or_product');
    }
    if (browserPosts > MAX_PENDING_POSTS + 1) return done('FAIL', 'too_many_posts');
    if (browserPosts !== exchanges.length || exchanges.some((e) => e.status === null || (e.outcome && e.outcome !== 'answered'))) {
        return done('HOLD', 'unsettled_exchange');
    }
    const lifecycle = exchanges[0]?.sent.requestId;
    if (!lifecycle || exchanges.some(({ sent }) => !sent.requestId || !sent.attemptId)) {
        return done('HOLD', 'request_identity_unproven');
    }
    if (exchanges.some(({ sent }) => sent.requestId !== lifecycle)) {
        return done('FAIL', 'more_than_one_request_lifecycle');
    }
    if (exchanges.some(({ sent, diagnostics }) => (
        (typeof diagnostics?.request_id === 'string' && diagnostics.request_id !== sent.requestId)
        || (typeof diagnostics?.attempt_id === 'string' && diagnostics.attempt_id !== sent.attemptId)
    ))) return done('FAIL', 'provider_receipt_identity_mismatch');
    const nonPending = exchanges.filter((e) => !isProvedPending(e));
    if (nonPending.length !== 1) return done('FAIL', nonPending.length === 0 ? 'no_provider_exchange' : 'more_than_one_terminal_exchange');
    const terminal = nonPending[0];
    if (exchanges[exchanges.length - 1] !== terminal || pendingPosts > MAX_PENDING_POSTS) return done('FAIL', 'unexpected_pending_order');
    const attempts = terminal.diagnostics?.provider_attempts;
    if (typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 0) return done('HOLD', 'provider_attempts_unproven');
    if (attempts === 0) return done('FAIL', 'no_provider_attempt');
    if (attempts > EDGE_MAX_PROVIDER_ATTEMPTS) return done('FAIL', 'provider_attempt_cap_exceeded', attempts);
    if (terminal.status === 425) return done('FAIL', 'pending_reached_provider', attempts);
    return done('PASS', 'one_take_bound_provider_exchange', attempts, terminal);
}

/**
 * Diagnostic-only spend boundary. It never fabricates any response, and the tap
 * records a blocked POST as a browser failure. An unanswered POST may already
 * have spent Gemini quota, so it cannot earn a retry on the provider's budget.
 */
export async function armOneCoachingProviderBoundary(page: Page, tap: CoachingGenerationTap, options: {
    permit?: (sent: ReturnType<typeof readSentRequest>) => boolean;
    blockReadiness?: boolean;
} = {}): Promise<void> {
    let forwarded = 0;
    let first: ReturnType<typeof readSentRequest> | null = null;
    await page.route(/\/functions\/v1\/get-ai-suggestions(?:\?.*)?$/, async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') return route.continue();
        if (isMicStartReadiness(request)) {
            return options.blockReadiness ? route.abort('blockedbyclient') : route.continue();
        }
        const sent = readSentRequest(request);
        if (!sent.sessionId || !sent.product || !sent.requestId || !sent.attemptId
            || options.permit?.(sent) === false) return route.abort('blockedbyclient');
        if (first === null) {
            first = sent;
            forwarded = 1;
            return route.continue();
        }
        if (sent.sessionId !== first.sessionId || sent.product !== first.product || sent.requestId !== first.requestId
            || forwarded > MAX_PENDING_POSTS) return route.abort('blockedbyclient');
        // Await only prior responses, not the request currently suspended at this route.
        const previousCount = forwarded;
        const readBy = Date.now() + 2_000;
        while (tap.exchanges.length < previousCount && Date.now() < readBy) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (forwarded !== previousCount || tap.exchanges.length !== previousCount || !tap.exchanges.every((exchange) =>
            isProvedPending(exchange) && exchange.sent.sessionId === sent.sessionId
            && exchange.sent.product === sent.product && exchange.sent.requestId === sent.requestId
            && (typeof exchange.diagnostics?.request_id !== 'string' || exchange.diagnostics.request_id === exchange.sent.requestId)
            && (typeof exchange.diagnostics?.attempt_id !== 'string' || exchange.diagnostics.attempt_id === exchange.sent.attemptId),
        )) {
            return route.abort('blockedbyclient');
        }
        forwarded += 1;
        return route.continue();
    });
}
