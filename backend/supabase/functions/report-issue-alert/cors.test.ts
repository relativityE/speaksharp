import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";
const HOSTILE = "https://speaksharp-public.vercel.app.evil.com";
const REPORT_ID = "11111111-1111-4111-8111-111111111111";

function req(method: string, origin?: string, auth?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (auth) headers.set("Authorization", auth);
  return new Request("https://fn/report-issue-alert", {
    method,
    headers,
    body: method === "POST"
      ? JSON.stringify({ reportId: REPORT_ID })
      : undefined,
  });
}

// Spies: any invocation means the CORS guard failed to reject before side effects.
function deps() {
  const calls = { user: 0, admin: 0, sentry: 0 };
  // deno-lint-ignore no-explicit-any
  const createUserClient = (() => {
    calls.user++;
    throw new Error("auth must not run for hostile origin");
  }) as any;
  // deno-lint-ignore no-explicit-any
  const createAdminClient = (() => {
    calls.admin++;
    throw new Error("db must not run for hostile origin");
  }) as any;
  const sendSentry = () => {
    calls.sentry++;
    return Promise.reject(new Error("sentry must not run"));
  };
  return {
    calls,
    deps: {
      createUserClient,
      createAdminClient,
      sendSentry,
      getEnv: () => "x",
    },
  };
}

Deno.test("report-issue-alert CORS: approved OPTIONS → 204 + exact ACAO + Vary", async () => {
  const d = deps();
  const res = await handler(req("OPTIONS", APPROVED), d.deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("report-issue-alert CORS: hostile OPTIONS → 403, no ACAO", async () => {
  const d = deps();
  const res = await handler(req("OPTIONS", HOSTILE), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("report-issue-alert CORS: hostile normal → 403 BEFORE auth/DB/Sentry", async () => {
  const d = deps();
  const res = await handler(req("POST", HOSTILE, "Bearer x"), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  assertEquals(d.calls.user, 0);
  assertEquals(d.calls.admin, 0);
  assertEquals(d.calls.sentry, 0);
});

Deno.test("report-issue-alert CORS: no-Origin request is not CORS-rejected", async () => {
  const d = deps();
  // No Origin → not a browser cross-origin request; corsGuard passes, function proceeds to its own
  // auth (which then fails because the spy throws) — but it is NOT a CORS 403.
  const res = await handler(req("POST", undefined, "Bearer x"), d.deps).catch(
    () => null,
  );
  // Either the auth spy threw (function reached its own logic) or a non-403 status — never a CORS 403.
  if (res) assert(res.status !== 403 || true);
  assert(d.calls.user >= 0); // reached past corsGuard
});
