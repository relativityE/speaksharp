import { handler } from './index.ts';
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";

Deno.test("check-usage-limit adversarial boundary tests", async (t) => {
    
    const mockUser = { id: 'test-user' };
    
    const setupMock = (profileData: any) => () => ({
        auth: {
            getUser: () => Promise.resolve({ data: { user: mockUser }, error: null }),
        },
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: () => Promise.resolve({
                        data: profileData,
                        error: null
                    }),
                }),
            }),
            update: () => ({
                eq: () => Promise.resolve({ error: null })
            })
        }),
    }) as any;

    await t.step("should reset usage exactly one month after last reset", async () => {
        const time = new FakeTime("2024-03-31T12:00:00Z");
        try {
            // Last reset was Feb 29 (Leap day)
            const profileData = {
                usage_seconds: 1500,
                usage_reset_date: "2024-02-29T12:00:00Z",
                subscription_status: 'free'
            };
            
            const req = new Request('http://localhost/check-usage-limit', { method: 'GET', headers: { 'Authorization': 'Bearer token' } });
            const res = await handler(req, setupMock(profileData));
            const json = await res.json();
            
            // March 31 - 1 month = Feb 31 -> March 2 (in JS)
            // Feb 29 <= March 2 is TRUE.
            assertEquals(json.used_seconds, 0, "Usage should be reset on March 31 if last reset was Feb 29");
            assertEquals(json.can_start, true);
        } finally {
            time.restore();
        }
    });

    await t.step("should NOT reset usage if less than one month has passed", async () => {
        const time = new FakeTime("2024-03-30T12:00:00Z");
        try {
            const profileData = {
                usage_seconds: 1500,
                usage_reset_date: "2024-03-01T12:00:00Z",
                subscription_status: 'free'
            };
            
            const req = new Request('http://localhost/check-usage-limit', { method: 'GET' });
            const res = await handler(req, setupMock(profileData));
            const json = await res.json();
            
            assertEquals(json.used_seconds, 1500, "Usage should NOT be reset yet");
        } finally {
            time.restore();
        }
    });
    
    await t.step("Month rollover edge case: Oct 31 -> Sept 30", async () => {
        // Oct 31. One month ago is Sept 30 (usually). 
        // JS Date: Oct 31 - 1 month = Sept 31 -> Oct 1.
        const time = new FakeTime("2024-10-31T12:00:00Z");
        try {
            const profileData = {
                usage_seconds: 1800,
                usage_reset_date: "2024-09-30T12:00:00Z", // Exactly end of last month
                subscription_status: 'free'
            };
            
            const req = new Request('http://localhost/check-usage-limit', { method: 'GET' });
            const res = await handler(req, setupMock(profileData));
            const json = await res.json();
            
            // Sept 30 <= Oct 1 is TRUE.
            assertEquals(json.used_seconds, 0, "Usage should be reset on Oct 31 if last reset was Sept 30");
        } finally {
            time.restore();
        }
    });
});
