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
        assertEquals(json.error, 'Authentication failed');
    });

    await t.step('should return can_start=true for free user with usage remaining', async () => {
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
            },
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({ data: { promo_expires_at: null }, error: null })
                    })
                })
            })
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
            },
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({ data: { promo_expires_at: null }, error: null })
                    })
                })
            })
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

    await t.step('should handle RPC errors by failing open', async () => {
        const userId = 'error-user';
        const mockCreateSupabaseError = () => ({
            rpc: () => Promise.resolve({ data: null, error: { message: 'Database error' } }),
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({ data: null, error: null })
                    })
                })
            })
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, mockCreateSupabaseError);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, true);
        assertEquals(json.error, 'RPC failure - failing open');
    });

    await t.step('should handle OPTIONS request (CORS preflight)', async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'OPTIONS'
        });
        const res = await handler(req, failingMockCreateSupabase);

        assertEquals(res.status, 200);
    });
});
