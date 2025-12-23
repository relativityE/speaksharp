/**
 * Simple rate limiter for client-side API call protection.
 * Prevents accidental rapid token requests.
 */

interface RateLimiterState {
    lastCall: number;
    callCount: number;
    windowStart: number;
}

const rateLimiters: Map<string, RateLimiterState> = new Map();

/**
 * Rate limit configuration
 */
export const RATE_LIMIT_CONFIG = {
    ASSEMBLYAI_TOKEN: {
        windowMs: 60000,      // 1 minute window
        maxCalls: 5,          // Max 5 calls per window
        minIntervalMs: 5000,  // Min 5 seconds between calls
    },
} as const;

type RateLimitKey = keyof typeof RATE_LIMIT_CONFIG;

/**
 * Check if an action is rate limited.
 * @returns { allowed: boolean, retryAfterMs?: number }
 */
export function checkRateLimit(key: RateLimitKey): { allowed: boolean; retryAfterMs?: number } {
    const config = RATE_LIMIT_CONFIG[key];
    const now = Date.now();

    let state = rateLimiters.get(key);

    if (!state) {
        state = { lastCall: 0, callCount: 0, windowStart: now };
        rateLimiters.set(key, state);
    }

    // Reset window if expired
    if (now - state.windowStart > config.windowMs) {
        state.windowStart = now;
        state.callCount = 0;
    }

    // Check min interval
    const timeSinceLastCall = now - state.lastCall;
    if (timeSinceLastCall < config.minIntervalMs) {
        return {
            allowed: false,
            retryAfterMs: config.minIntervalMs - timeSinceLastCall
        };
    }

    // Check max calls in window
    if (state.callCount >= config.maxCalls) {
        const windowRemaining = config.windowMs - (now - state.windowStart);
        return {
            allowed: false,
            retryAfterMs: windowRemaining
        };
    }

    // Allow and record
    state.lastCall = now;
    state.callCount++;

    return { allowed: true };
}

/**
 * Reset rate limiter (for testing)
 */
export function resetRateLimit(key: RateLimitKey): void {
    rateLimiters.delete(key);
}
