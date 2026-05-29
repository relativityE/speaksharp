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
  subscriptionStatus?: string | null;
  trialExpiresAt?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionId?: string | null;
  profileError?: { message: string } | null;
  usageLimit?: {
    can_start: boolean;
    subscription_status?: string;
    is_pro?: boolean;
    error?: string;
  } | null;
  usageError?: { message: string } | null;
}) {
  return () =>
    ({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: options.user ?? null },
            error: options.authError ?? null,
          }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: options.subscriptionStatus === undefined ? null : {
                  subscription_status: options.subscriptionStatus,
                  trial_expires_at: options.trialExpiresAt ?? null,
                  stripe_subscription_id: options.stripeSubscriptionId ?? null,
                  subscription_id: options.subscriptionId ?? null,
                },
                error: options.profileError ?? null,
              }),
          }),
        }),
      }),
      rpc: (name: string) => {
        if (name !== "check_usage_limit") {
          return Promise.resolve({ data: null, error: null });
        }

        return Promise.resolve({
          data: options.usageLimit ?? {
            can_start: true,
            subscription_status: options.subscriptionStatus ?? "free",
            is_pro: options.subscriptionStatus === "pro",
          },
          error: options.usageError ?? null,
        });
      },
    }) as any;
}

const env = (key: string) => {
  if (key === "ASSEMBLYAI_API_KEY") return "assemblyai-api-key";
  return undefined;
};

Deno.test("assemblyai-token edge function", async (t) => {
  await t.step("denies unauthenticated requests", async () => {
    const res = await handler(
      request(),
      createMockSupabase({ user: { id: "unused" }, subscriptionStatus: "pro" }),
      fetch,
      env,
    );
    const json = await res.json();

    assertEquals(res.status, 401);
    assertEquals(json.error, "Missing Authorization header");
  });

  await t.step(
    "grants a temporary token to authenticated Pro users",
    async () => {
      let assemblyAiCalled = false;
      const fetchImpl: typeof fetch = (url, init) => {
        assemblyAiCalled = true;
        assertEquals(
          String(url),
          "https://streaming.assemblyai.com/v3/token?expires_in_seconds=600",
        );
        const headers = (init as { headers?: HeadersInit } | undefined)
          ?.headers;
        assertEquals(headers, { Authorization: "assemblyai-api-key" });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "temporary-assemblyai-token",
              expires_in_seconds: 600,
            }),
            { status: 200 },
          ),
        );
      };

      const res = await handler(
        request("Bearer valid-pro-token"),
        createMockSupabase({
          user: { id: "pro-user" },
          subscriptionStatus: "pro",
          stripeSubscriptionId: "sub_paid_123",
          usageLimit: {
            can_start: true,
            subscription_status: "pro",
            is_pro: true,
          },
        }),
        fetchImpl,
        env,
      );
      const json = await res.json();

      assertEquals(res.status, 200);
      assertEquals(json.token, "temporary-assemblyai-token");
      assertEquals(json.expires_in, 600);
      assertEquals(assemblyAiCalled, true);
    },
  );

  await t.step(
    "denies Free users before generating a Cloud STT token",
    async () => {
      let assemblyAiCalled = false;
      const fetchImpl: typeof fetch = () => {
        assemblyAiCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      };

      const res = await handler(
        request("Bearer valid-free-token"),
        createMockSupabase({
          user: { id: "free-user" },
          subscriptionStatus: "free",
        }),
        fetchImpl,
        env,
      );
      const json = await res.json();

      assertEquals(res.status, 403);
      assertEquals(
        json.error,
        "Cloud STT is available as a Pro feature. Trial access includes Private STT.",
      );
      assertEquals(assemblyAiCalled, false);
    },
  );

  await t.step(
    "denies active trial users before generating a Cloud STT token",
    async () => {
      let assemblyAiCalled = false;
      const fetchImpl: typeof fetch = () => {
        assemblyAiCalled = true;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "active-trial-token",
              expires_in_seconds: 600,
            }),
            { status: 200 },
          ),
        );
      };

      const res = await handler(
        request("Bearer active-trial-token"),
        createMockSupabase({
          user: { id: "active-trial-user" },
          subscriptionStatus: "free",
          trialExpiresAt: "2999-01-01T00:00:00.000Z",
          usageLimit: {
            can_start: true,
            subscription_status: "pro",
            is_pro: true,
          },
        }),
        fetchImpl,
        env,
      );
      const json = await res.json();

      assertEquals(res.status, 403);
      assertEquals(
        json.error,
        "Cloud STT is available as a Pro feature. Trial access includes Private STT.",
      );
      assertEquals(assemblyAiCalled, false);
    },
  );

  await t.step(
    "denies expired trial users before generating a Cloud STT token",
    async () => {
      let assemblyAiCalled = false;
      const fetchImpl: typeof fetch = () => {
        assemblyAiCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      };

      const res = await handler(
        request("Bearer expired-trial-token"),
        createMockSupabase({
          user: { id: "expired-trial-user" },
          subscriptionStatus: "free",
          trialExpiresAt: "2024-01-01T00:00:00.000Z",
          usageLimit: {
            can_start: true,
            subscription_status: "free",
            is_pro: false,
          },
        }),
        fetchImpl,
        env,
      );
      const json = await res.json();

      assertEquals(res.status, 403);
      assertEquals(
        json.error,
        "Cloud STT is available as a Pro feature. Trial access includes Private STT.",
      );
      assertEquals(assemblyAiCalled, false);
    },
  );

  await t.step(
    "allows Stripe-backed Pro users even when the trial timestamp is expired",
    async () => {
      let assemblyAiCalled = false;
      const fetchImpl: typeof fetch = () => {
        assemblyAiCalled = true;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "pro-feature-token",
              expires_in_seconds: 600,
            }),
            { status: 200 },
          ),
        );
      };

      const res = await handler(
        request("Bearer pro-feature-token"),
        createMockSupabase({
          user: { id: "pro-feature-user" },
          subscriptionStatus: "pro",
          trialExpiresAt: "2024-01-01T00:00:00.000Z",
          stripeSubscriptionId: "sub_paid_123",
          usageLimit: {
            can_start: true,
            subscription_status: "pro",
            is_pro: true,
          },
        }),
        fetchImpl,
        env,
      );
      const json = await res.json();

      assertEquals(res.status, 200);
      assertEquals(json.token, "pro-feature-token");
      assertEquals(assemblyAiCalled, true);
    },
  );

  await t.step(
    "denies over-quota users before generating a Cloud STT token",
    async () => {
      let assemblyAiCalled = false;
      const fetchImpl: typeof fetch = () => {
        assemblyAiCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      };

      const res = await handler(
        request("Bearer valid-over-quota-token"),
        createMockSupabase({
          user: { id: "over-quota-user" },
          subscriptionStatus: "pro",
          stripeSubscriptionId: "sub_paid_123",
          usageLimit: {
            can_start: false,
            subscription_status: "pro",
            is_pro: true,
            error: "Usage limit reached",
          },
        }),
        fetchImpl,
        env,
      );
      const json = await res.json();

      assertEquals(res.status, 429);
      assertEquals(json.error, "Usage limit reached");
      assertEquals(assemblyAiCalled, false);
    },
  );

  await t.step("fails closed when usage cannot be verified", async () => {
    let assemblyAiCalled = false;
    const fetchImpl: typeof fetch = () => {
      assemblyAiCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    const res = await handler(
      request("Bearer valid-db-error-token"),
      createMockSupabase({
        user: { id: "db-error-user" },
        subscriptionStatus: "pro",
        usageError: { message: "database unavailable" },
      }),
      fetchImpl,
      env,
    );
    const json = await res.json();

    assertEquals(res.status, 503);
    assertEquals(json.error, "Unable to verify usage limit");
    assertEquals(assemblyAiCalled, false);
  });
});
