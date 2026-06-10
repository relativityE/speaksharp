import { handler } from './index.ts';
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Helper to create a fake JWT for testing
// We intentionally remove padding to test the local parser's padding restoration logic
function createFakeJWT(userId: string) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
    const payload = btoa(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, '');
    return `${header}.${payload}.signature`;
}

Deno.test('check-usage-limit edge function', async (t) => {
    // Mock that fails authentication
    const failingMockCreateSupabase = () => ({}) as any;

    await t.step('should return 401 if user is not authenticated', async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer invalid-token' }
        });
        const res = await handler(req, failingMockCreateSupabase);
        const json = await res.json();

        assertEquals(res.status, 401);
        assertEquals(json.error.code, 'AUTH_INVALID_TOKEN');
        assertEquals(json.error.message, 'Authentication failed');
    });

    await t.step('should return can_start=true for Free user with usage remaining', async () => {
        const userId = 'free-user';
        const mockCreateSupabaseFreeUser = () => ({
            rpc: (name: string) => {
                if (name === 'check_usage_limit') {
                    return Promise.resolve({
                        data: {
                            can_start: true,
                            daily_remaining: 3000,
                            daily_limit: 3600,
                            monthly_remaining: 80000,
                            monthly_limit: 90000,
                            remaining_seconds: 3000,
                            subscription_status: 'free',
                            is_pro: false
                        },
                        error: null
                    });
                }
                return Promise.resolve({ data: null, error: null });
            }
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, mockCreateSupabaseFreeUser);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, true);
        assertEquals(json.daily_remaining, 3000);
        assertEquals(json.monthly_remaining, 80000);
    });

    await t.step('should return can_start=false for exceeded user', async () => {
        const userId = 'exceeded-user';
        const mockCreateSupabaseExceededUser = () => ({
            rpc: (name: string) => {
                if (name === 'check_usage_limit') {
                    return Promise.resolve({
                        data: {
                            can_start: false,
                            daily_remaining: 0,
                            daily_limit: 3600,
                            remaining_seconds: 0,
                            subscription_status: 'free',
                            is_pro: false
                        },
                        error: null
                    });
                }
                return Promise.resolve({ data: null, error: null });
            }
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, mockCreateSupabaseExceededUser);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, false);
        assertEquals(json.daily_remaining, 0);
    });

    await t.step('should pass through unavailable Private sample results from the RPC source of truth', async () => {
        const userId = 'sample-used-user';
        const mockCreateSupabaseExpiredTrial = () => ({
            rpc: (name: string) => {
                if (name === 'check_usage_limit') {
                    return Promise.resolve({
                        data: {
                            can_start: true,
                            daily_remaining: 3600,
                            daily_limit: 3600,
                            monthly_remaining: 90000,
                            monthly_limit: 90000,
                            remaining_seconds: 3600,
                            subscription_status: 'free',
                            is_pro: false,
                            trial_active: false,
                            trial_started_at: '2026-01-01T00:00:00.000Z',
                            trial_expires_at: '2026-01-01T01:00:00.000Z',
                            trial_seconds_remaining: 0,
                            private_sample_available: false,
                            private_sample_limit_seconds: 300,
                            private_sample_seconds_used: 300,
                            private_sample_seconds_remaining: 0,
                            private_sample_completed_at: '2026-01-01T00:05:00.000Z'
                        },
                        error: null
                    });
                }
                return Promise.resolve({ data: null, error: null });
            }
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, mockCreateSupabaseExpiredTrial);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.subscription_status, 'free');
        assertEquals(json.is_pro, false);
        assertEquals(json.trial_active, false);
        assertEquals(json.trial_seconds_remaining, 0);
        assertEquals(json.private_sample_available, false);
        assertEquals(json.private_sample_seconds_remaining, 0);
    });

    await t.step('should pass through available Private sample Free results from the RPC source of truth', async () => {
        const userId = 'private-sample-user';
        const mockCreateSupabasePaidPro = () => ({
            rpc: (name: string) => {
                if (name === 'check_usage_limit') {
                    return Promise.resolve({
                        data: {
                            can_start: true,
                            daily_remaining: 7200,
                            daily_limit: 7200,
                            monthly_remaining: 180000,
                            monthly_limit: 180000,
                            remaining_seconds: 3600,
                            subscription_status: 'free',
                            is_pro: false,
                            trial_active: false,
                            trial_started_at: null,
                            trial_expires_at: null,
                            trial_seconds_remaining: 0,
                            private_sample_available: true,
                            private_sample_limit_seconds: 300,
                            private_sample_seconds_used: 0,
                            private_sample_seconds_remaining: 300
                        },
                        error: null
                    });
                }
                return Promise.resolve({ data: null, error: null });
            }
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, mockCreateSupabasePaidPro);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.subscription_status, 'free');
        assertEquals(json.is_pro, false);
        assertEquals(json.trial_active, false);
        assertEquals(json.private_sample_available, true);
        assertEquals(json.private_sample_seconds_remaining, 300);
    });

    await t.step('should handle RPC errors by failing closed', async () => {
        const userId = 'error-user';
        const mockCreateSupabaseError = () => ({
            rpc: () => Promise.resolve({ data: null, error: { message: 'Database error' } })
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, mockCreateSupabaseError);
        const json = await res.json();

        assertEquals(res.status, 500);
        assertEquals(json.error.code, 'DATABASE_ERROR');
        assertEquals(json.error.details.can_start, false);
        assertEquals(json.error.details.reason, 'usage_verification_failed');
    });

    await t.step('should handle OPTIONS request (CORS preflight)', async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'OPTIONS'
        });
        const res = await handler(req, failingMockCreateSupabase);

        assertEquals(res.status, 200);
    });
});
