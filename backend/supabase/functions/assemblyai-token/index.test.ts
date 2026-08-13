import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

function request(authHeader?: string) {
  return new Request("http://localhost/assemblyai-token", {
    method: "POST",
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

function createMockSupabase(options: {
  user?: { id: string } | null;
  authError?: { message: string } | null;
}) {
  return () => ({
    auth: {
      getUser: () => Promise.resolve({
        data: { user: options.user ?? null },
        error: options.authError ?? null,
      }),
    },
  }) as any;
}

Deno.test("assemblyai-token edge function", async (t) => {
  await t.step("denies unauthenticated requests", async () => {
    const res = await handler(request(), createMockSupabase({}));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "Missing Authorization header");
  });

  await t.step("rejects authenticated customer requests without calling the provider", async () => {
    let providerCalled = false;
    const res = await handler(
      request("Bearer valid-token"),
      createMockSupabase({ user: { id: "customer" } }),
      () => {
        providerCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    );

    assertEquals(res.status, 410);
    assertEquals(
      (await res.json()).error,
      "This endpoint is unavailable; recordings use on-device Private transcription.",
    );
    assertEquals(providerCalled, false);
  });

  await t.step("denies invalid authentication before returning the retired-endpoint response", async () => {
    const res = await handler(
      request("Bearer expired"),
      createMockSupabase({ authError: { message: "expired" } }),
    );
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "Invalid or expired token");
  });
});
