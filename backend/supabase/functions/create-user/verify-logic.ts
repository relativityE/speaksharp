
import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";

/**
 * Performs a constant-time comparison of two strings to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Mocking the final logic from index.ts to verify auth and field flexibility.
 */
async function handleRequest(req: Request, env: { AGENT_SECRET: string }) {
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({}));

    // Agent Auth Extraction (2nd Stage Verification)
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    const providedSecret = bearer || (body && body.agent_secret ? String(body.agent_secret) : null);

    // Verify secret via constant-time comparison
    if (!env.AGENT_SECRET || !providedSecret || !safeCompare(providedSecret, env.AGENT_SECRET)) {
        return { status: 401, error: "unauthorized" };
    }

    // Defensive: Immediately redact/delete secret from memory objects
    if (body && body.agent_secret) delete body.agent_secret;

    const email = body.email || body.username;
    const subscription_status = body.subscription_status || body.type;

    return { status: 200, success: true, email, tier: subscription_status, body_cleaned: !body.agent_secret };
}

Deno.test("Synchronized Auth - Dual Header Handshake (Primary)", async () => {
    const env = { AGENT_SECRET: "test_secret_123" };
    const req = new Request("http://localhost", {
        method: "POST",
        headers: {
            "Authorization": "Bearer test_secret_123",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: "test@example.com", subscription_status: "pro" })
    });

    const res = await handleRequest(req, env);
    assertEquals(res.status, 200);
    assertEquals(res.success, true);
    assertEquals(res.email, "test@example.com");
    assertEquals(res.tier, "pro");
});

Deno.test("Synchronized Auth - Body Secret & Cleanup (Legacy)", async () => {
    const env = { AGENT_SECRET: "test_secret_123" };
    const req = new Request("http://localhost", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: "old@example.com",
            type: "free",
            agent_secret: "test_secret_123"
        })
    });

    const res = await handleRequest(req, env);
    assertEquals(res.status, 200);
    assertEquals(res.success, true);
    assertEquals(res.email, "old@example.com");
    assertEquals(res.tier, "free");
    assertEquals(res.body_cleaned, true); // Verified defensive redact
});

Deno.test("Synchronized Auth - Unauthorized (Wrong Secret)", async () => {
    const env = { AGENT_SECRET: "test_secret_123" };
    const req = new Request("http://localhost", {
        method: "POST",
        headers: {
            "Authorization": "Bearer WRONG_SECRET",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: "test@example.com" })
    });

    const res = await handleRequest(req, env);
    assertEquals(res.status, 401);
    assertEquals(res.error, "unauthorized");
});
