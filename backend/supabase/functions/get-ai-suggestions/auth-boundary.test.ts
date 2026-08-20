import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";

function forgedBearer() {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(
      /=+$/,
      "",
    );
  return `Bearer ${b64({ alg: "HS256", typ: "JWT" })}.${
    b64({ sub: "forged", role: "authenticated" })
  }.forged_sig`;
}

function req(auth?: string) {
  const headers = new Headers({ Origin: APPROVED });
  if (auth) headers.set("Authorization", auth);
  return new Request("https://fn/get-ai-suggestions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      transcript: "hello world",
      metrics: {},
      sessionId: "s1",
    }),
  });
}

// deno-lint-ignore no-explicit-any
function supabaseReturning(profileResult: { data: unknown; error: unknown }) {
  return ((_auth: string | null) => ({
    from: () => ({
      select: () => ({ single: () => Promise.resolve(profileResult) }),
    }),
  })) as any;
}

// Case D: a forged/invalid token cannot reach the Gemini provider. The profile fetch runs under the
// caller's JWT via RLS; the PostgREST boundary rejects a forged JWT (proven live: 401 PGRST301), so
// the handler returns non-success BEFORE the Gemini call. We stub global fetch to prove zero calls.
Deno.test("get-ai-suggestions: forged token → non-success and NO Gemini call", async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((url: any) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      geminiCalls++;
    }
    return Promise.reject(new Error("network disabled in test"));
  }) as any;
  try {
    // Forged JWT → PostgREST signature failure surfaces as a profile error (not PGRST116).
    const res = await handler(
      req(forgedBearer()),
      supabaseReturning({
        data: null,
        error: {
          code: "PGRST301",
          message: "JWT cryptographic operation failed",
        },
      }),
    );
    assert(res.status >= 400, `expected error status, got ${res.status}`);
    assertEquals(geminiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("get-ai-suggestions: missing/blocked auth (RLS empty) → 401 and NO Gemini call", async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((url: any) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      geminiCalls++;
    }
    return Promise.reject(new Error("network disabled in test"));
  }) as any;
  try {
    const res = await handler(
      req(),
      supabaseReturning({
        data: null,
        error: { code: "PGRST116", message: "No rows returned" },
      }),
    );
    assertEquals(res.status, 401);
    assertEquals(geminiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
