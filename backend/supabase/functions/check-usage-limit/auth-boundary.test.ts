import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";

// A syntactically valid JWT with an arbitrary `sub` and a GARBAGE signature (forged).
function forgedBearer(sub = "00000000-0000-4000-8000-forgedattacker") {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(
      /=+$/,
      "",
    );
  return `Bearer ${b64({ alg: "HS256", typ: "JWT" })}.${
    b64({ sub, role: "authenticated", aud: "authenticated" })
  }.forged_invalid_signature`;
}

function req(auth?: string) {
  const headers = new Headers({ Origin: APPROVED });
  if (auth) headers.set("Authorization", auth);
  return new Request("https://fn/check-usage-limit", {
    method: "POST",
    headers,
  });
}

// D + forged-JWT requirement: a forged token's decoded `sub` must NEVER yield a usage result.
// getUserIdFromAuthHeader only DECODES (fast presence gate); the real authorization is the RPC's
// `auth.uid()`, cryptographically verified at the PostgREST boundary (proven live: forged token →
// 401 PGRST301). This test proves the function (a) never passes the decoded sub to the RPC and
// (b) fails closed when the RPC rejects the forged token.
Deno.test("check-usage-limit: forged JWT fails closed; decoded sub is never passed to the RPC", async () => {
  let rpcCall: { name: string; args: unknown } | null = null;
  // deno-lint-ignore no-explicit-any
  const createSupabase = ((_auth: string | null) => ({
    rpc: (name: string, args?: unknown) => {
      rpcCall = { name, args };
      // Simulate the real PostgREST rejection of a forged JWT (401 PGRST301 seen live).
      return Promise.resolve({
        data: null,
        error: {
          code: "PGRST301",
          message: "JWT cryptographic operation failed",
        },
      });
    },
  })) as any;

  const res = await handler(req(forgedBearer()), createSupabase);
  const body = await res.json();

  // Fail closed: non-success, can_start = false.
  assert(res.status >= 400, `expected error status, got ${res.status}`);
  assertEquals(body.error.details?.can_start, false);
  // The RPC is invoked with NO user parameter — the forged/decoded sub is never trusted downstream.
  assertEquals(rpcCall!.name, "check_usage_limit");
  assertEquals(rpcCall!.args, undefined);
});

Deno.test("check-usage-limit: missing token → 401 before the RPC (no downstream call)", async () => {
  let rpcInvoked = false;
  // deno-lint-ignore no-explicit-any
  const createSupabase = ((_auth: string | null) => ({
    rpc: () => {
      rpcInvoked = true;
      return Promise.resolve({ data: { can_start: true }, error: null });
    },
  })) as any;
  const res = await handler(req(), createSupabase);
  assert(res.status === 401 || res.status === 400);
  assertEquals(rpcInvoked, false);
});
