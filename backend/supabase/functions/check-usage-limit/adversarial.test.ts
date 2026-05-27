import { handler } from './index.ts';
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function createFakeJWT(userId: string) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
    const payload = btoa(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, '');
    return `${header}.${payload}.signature`;
}

function createMockSupabase(rpcData: Record<string, unknown>, rpcError: unknown = null) {
    return () => ({
        rpc: (name: string) => {
            if (name === 'check_usage_limit') {
                return Promise.resolve({ data: rpcData, error: rpcError });
            }
            return Promise.resolve({ data: null, error: null });
        }
    }) as any;
}

Deno.test("check-usage-limit adversarial boundary tests", async (t) => {
    const userId = 'test-user';

    await t.step("should trust RPC monthly reset result at leap-day boundary", async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, createMockSupabase({
            can_start: true,
            daily_remaining: 3600,
            daily_limit: 3600,
            monthly_remaining: 90000,
            monthly_limit: 90000,
            remaining_seconds: 3600,
            used_seconds: 0,
            subscription_status: 'free',
            is_pro: false,
        }));
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.used_seconds, 0);
        assertEquals(json.can_start, true);
    });

    await t.step("should trust RPC no-reset result when monthly window remains active", async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, createMockSupabase({
            can_start: true,
            daily_remaining: 2100,
            daily_limit: 3600,
            monthly_remaining: 88500,
            monthly_limit: 90000,
            remaining_seconds: 2100,
            used_seconds: 1500,
            subscription_status: 'free',
            is_pro: false,
        }));
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.used_seconds, 1500);
        assertEquals(json.monthly_remaining, 88500);
    });

    await t.step("should fail closed when usage RPC cannot be called", async () => {
        const req = new Request('http://localhost/check-usage-limit', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${createFakeJWT(userId)}` }
        });
        const res = await handler(req, () => ({
            rpc: undefined
        }) as any);
        const json = await res.json();

        assertEquals(res.status, 500);
        assertEquals(json.error.code, 'INTERNAL_ERROR');
        assertEquals(json.error.details.can_start, false);
        assertEquals(json.error.details.reason, 'usage_verification_failed');
    });
});
