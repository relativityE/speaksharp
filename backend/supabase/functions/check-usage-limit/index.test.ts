import { handler } from './index.ts';
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test('check-usage-limit edge function', async (t) => {
    // Mock that fails authentication
    const failingMockCreateSupabase = () => ({
        auth: {
            getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'Unauthorized' } }),
        },
    }) as any;

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
        const mockCreateSupabaseFreeUser = () => ({
            auth: {
                getUser: () => Promise.resolve({ data: { user: { id: 'free-user' } }, error: null }),
            },
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({
                            data: {
                                usage_seconds: 600, // 10 minutes used
                                usage_reset_date: new Date().toISOString(),
                                subscription_status: 'free'
                            },
                            error: null
                        }),
                    }),
                }),
            }),
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer fake-token' }
        });
        const res = await handler(req, mockCreateSupabaseFreeUser);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, true);
        assertEquals(json.is_pro, false);
        assertEquals(json.remaining_seconds, 1200); // 30 min - 10 min = 20 min = 1200s
        assertEquals(json.limit_seconds, 1800);
        assertEquals(json.used_seconds, 600);
    });

    await t.step('should return can_start=false for free user who exceeded limit', async () => {
        const mockCreateSupabaseExceededUser = () => ({
            auth: {
                getUser: () => Promise.resolve({ data: { user: { id: 'exceeded-user' } }, error: null }),
            },
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({
                            data: {
                                usage_seconds: 1800, // 30 minutes used (at limit)
                                usage_reset_date: new Date().toISOString(),
                                subscription_status: 'free'
                            },
                            error: null
                        }),
                    }),
                }),
            }),
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer fake-token' }
        });
        const res = await handler(req, mockCreateSupabaseExceededUser);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, false);
        assertEquals(json.is_pro, false);
        assertEquals(json.remaining_seconds, 0);
    });

    await t.step('should return unlimited for pro user', async () => {
        const mockCreateSupabaseProUser = () => ({
            auth: {
                getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
            },
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({
                            data: {
                                usage_seconds: 5000, // Pro users can use as much as they want
                                usage_reset_date: new Date().toISOString(),
                                subscription_status: 'pro'
                            },
                            error: null
                        }),
                    }),
                }),
            }),
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer fake-token' }
        });
        const res = await handler(req, mockCreateSupabaseProUser);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, true);
        assertEquals(json.is_pro, true);
        assertEquals(json.remaining_seconds, -1); // -1 means unlimited
    });

    await t.step('should allow start if profile not found (graceful degradation)', async () => {
        const mockCreateSupabaseNoProfile = () => ({
            auth: {
                getUser: () => Promise.resolve({ data: { user: { id: 'new-user' } }, error: null }),
            },
            from: () => ({
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({
                            data: null,
                            error: { message: 'Profile not found' }
                        }),
                    }),
                }),
            }),
        }) as any;

        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer fake-token' }
        });
        const res = await handler(req, mockCreateSupabaseNoProfile);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.can_start, true); // Graceful degradation - allow
        assertEquals(json.error, 'Profile not found - allowing session');
    });

    await t.step('should handle OPTIONS request (CORS preflight)', async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'OPTIONS'
        });
        const res = await handler(req, failingMockCreateSupabase);

        assertEquals(res.status, 200);
    });
});
