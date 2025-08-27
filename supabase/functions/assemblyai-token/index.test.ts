import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.224.0/testing/mock.ts";
import * as jose from 'https://esm.sh/jose@4.15.1';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

const SERVICE_KEY = 'super-secret-key-that-is-long-enough';
const DEV_USER_ID = 'test-dev-uuid';
const OTHER_USER_ID = 'other-user-uuid';
const ASSEMBLYAI_KEY = 'assembly-ai-api-key';


// Helper to create a valid JWT for testing
async function createTestJwt(subject: string, key: string) {
    return await new jose.SignJWT({ sub: subject })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1m')
        .sign(new TextEncoder().encode(key));
}

Deno.test('assemblyai-token edge function', async (t) => {

    await t.step('should return 401 if environment variables are missing', async () => {
        const envStub = stub(Deno.env, "get", () => undefined);
        try {
            // Provide a dummy header to get past the first check
            const req = new Request('http://localhost/assemblyai-token', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer dummy-token' }
            });
            const res = await handler(req);
            // It should throw an error, which the catch block turns into a 401
            assertEquals(res.status, 401);
            const json = await res.json();
            assertEquals(json.error, 'Missing environment variables');
        } finally {
            envStub.restore();
        }
    });

    await t.step('should return 401 if auth header is missing', async () => {
        const envStub = stub(Deno.env, "get", (key) => {
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') return SERVICE_KEY;
            if (key === 'UUID_DEV_USER') return DEV_USER_ID;
            if (key === 'ASSEMBLYAI_API_KEY') return ASSEMBLYAI_KEY;
            return undefined;
        });
        try {
            const req = new Request('http://localhost/assemblyai-token', { method: 'POST' });
            const res = await handler(req);
            assertEquals(res.status, 401);
            const json = await res.json();
            assertEquals(json.error, 'Missing authorization header');
        } finally {
            envStub.restore();
        }
    });

    await t.step('should return 401 if JWT is invalid or expired', async () => {
        const envStub = stub(Deno.env, "get", (key) => {
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') return SERVICE_KEY;
            if (key === 'UUID_DEV_USER') return DEV_USER_ID;
            if (key === 'ASSEMBLYAI_API_KEY') return ASSEMBLYAI_KEY;
            return undefined;
        });
        try {
            const req = new Request('http://localhost/assemblyai-token', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer garbage-token' }
            });
            const res = await handler(req);
            assertEquals(res.status, 401);
        } finally {
            envStub.restore();
        }
    });

    await t.step('should return 403 if JWT is for a different user', async () => {
        const envStub = stub(Deno.env, "get", (key) => {
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') return SERVICE_KEY;
            if (key === 'UUID_DEV_USER') return DEV_USER_ID;
            if (key === 'ASSEMBLYAI_API_KEY') return ASSEMBLYAI_KEY;
            return undefined;
        });
        try {
            const validTokenForOtherUser = await createTestJwt(OTHER_USER_ID, SERVICE_KEY);
            const req = new Request('http://localhost/assemblyai-token', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${validTokenForOtherUser}` }
            });
            const res = await handler(req);
            assertEquals(res.status, 403);
            const json = await res.json();
            assertEquals(json.error, 'Invalid user for this endpoint');
        } finally {
            envStub.restore();
        }
    });

    await t.step('should pass JWT validation and fail on AssemblyAI client', async () => {
        const envStub = stub(Deno.env, "get", (key) => {
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') return SERVICE_KEY;
            if (key === 'UUID_DEV_USER') return DEV_USER_ID;
            if (key === 'ASSEMBLYAI_API_KEY') return ASSEMBLYAI_KEY;
            return undefined;
        });
        try {
            const validToken = await createTestJwt(DEV_USER_ID, SERVICE_KEY);
            const req = new Request('http://localhost/assemblyai-token', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${validToken}` }
            });
            const res = await handler(req);
            // We expect a 401 because the AssemblyAI client will fail to initialize
            // without a real API key, and the error is caught.
            assertEquals(res.status, 401);
            const json = await res.json();
            assertExists(json.error);
            // Check that the error is NOT one of our auth errors.
            // This proves the JWT validation part was successful.
            assertEquals(json.error.includes('Invalid user'), false);
            assertEquals(json.error.includes('Missing authorization header'), false);
        } finally {
            envStub.restore();
        }
    });
});
