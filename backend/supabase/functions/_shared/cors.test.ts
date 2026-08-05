import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BUILTIN_ALLOWED_ORIGINS,
  corsHeaders,
  corsHeadersForRequest,
  getAllowedOrigins,
  handleCorsPreflight,
  isAllowedOrigin,
  normalizeExactOrigin,
  parseConfiguredOrigins,
  rejectDisallowedOrigin,
} from "./cors.ts";

const PROD_ACTIVE = "https://speaksharp-public.vercel.app";
const PROD_AI = "https://speaksharp.ai";
const PROD_WWW = "https://www.speaksharp.ai";
const PREVIEW = "https://speaksharp-public-git-main-team.vercel.app";

// Allowlist including one explicitly-configured preview origin (as prod would configure it).
const ALLOWED = [...BUILTIN_ALLOWED_ORIGINS, PREVIEW];

function reqWith(origin?: string, method = "GET"): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin);
  return new Request("https://fn.example/endpoint", { method, headers });
}

Deno.test("normalizeExactOrigin canonicalizes valid origins", () => {
  assertEquals(
    normalizeExactOrigin("https://speaksharp.ai"),
    "https://speaksharp.ai",
  );
  assertEquals(
    normalizeExactOrigin("  https://speaksharp.ai  "),
    "https://speaksharp.ai",
  );
  // Case-normalized host via URL parsing.
  assertEquals(
    normalizeExactOrigin("https://SpeakSharp.AI"),
    "https://speaksharp.ai",
  );
  // Default-port canonicalization.
  assertEquals(
    normalizeExactOrigin("https://speaksharp.ai:443"),
    "https://speaksharp.ai",
  );
  assertEquals(
    normalizeExactOrigin("http://localhost:5174"),
    "http://localhost:5174",
  );
});

Deno.test("normalizeExactOrigin rejects non-origin / hostile shapes", () => {
  for (
    const bad of [
      "null",
      "",
      "   ",
      "http://a.com, http://b.com", // comma-separated
      "https://a.com https://b.com", // space-separated
      "https://user@speaksharp.ai", // userinfo
      "https://user:pass@speaksharp.ai",
      "https://speaksharp.ai/path", // path
      "https://speaksharp.ai/", // trailing path
      "https://speaksharp.ai?x=1", // query
      "https://speaksharp.ai#f", // fragment
      "ftp://speaksharp.ai", // scheme
      "file:///etc/passwd",
      "javascript:alert(1)",
      "speaksharp.ai", // no scheme
      "https://speaksharp.ai\r\nSet-Cookie: x=1", // header injection
      "https://speaksharp.ai\n", // newline
      "https://speaksharp.ai\t", // tab
    ]
  ) {
    assertEquals(
      normalizeExactOrigin(bad),
      null,
      `should reject: ${JSON.stringify(bad)}`,
    );
  }
  assertEquals(normalizeExactOrigin(undefined), null);
  assertEquals(normalizeExactOrigin(123), null);
});

Deno.test("parseConfiguredOrigins parses, normalizes, dedupes, and drops malformed", () => {
  const parsed = parseConfiguredOrigins(
    `${PROD_ACTIVE}, ${PROD_ACTIVE}, https://Preview.Example.com , not-a-url , https://x.com/path`,
  );
  assertEquals(parsed, [PROD_ACTIVE, "https://preview.example.com"]);
  assertEquals(parseConfiguredOrigins(""), []);
  assertEquals(parseConfiguredOrigins(undefined), []);
});

Deno.test("getAllowedOrigins merges builtins with configured, deduped", () => {
  const getEnv = (
    k: string,
  ) => (k === "ALLOWED_ORIGIN" ? `${PREVIEW}, ${PROD_ACTIVE}` : undefined);
  const list = getAllowedOrigins(getEnv);
  assert(list.includes(PREVIEW));
  assert(list.includes(PROD_ACTIVE));
  // No duplicate of the built-in active prod origin.
  assertEquals(list.filter((o) => o === PROD_ACTIVE).length, 1);
});

Deno.test("ALLOWED cases: exact production, approved domains, configured preview, localhost", () => {
  for (
    const good of [
      PROD_ACTIVE,
      PROD_AI,
      PROD_WWW,
      PREVIEW, // explicitly configured preview
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "https://speaksharp.ai:443", // canonical default port
    ]
  ) {
    assert(isAllowedOrigin(good, ALLOWED), `should allow: ${good}`);
    const headers = corsHeadersForRequest(reqWith(good), ALLOWED);
    assertEquals(
      headers["Access-Control-Allow-Origin"],
      normalizeExactOrigin(good),
    );
    assertEquals(headers["Vary"], "Origin");
    // Allowed request is NOT rejected.
    assertEquals(rejectDisallowedOrigin(reqWith(good), ALLOWED), null);
  }
});

Deno.test("REJECTED cases: hostile lookalikes, wrong protocol/port, malformed", async (t) => {
  const rejected = [
    "https://evil-speaksharp.ai",
    "https://speaksharp.ai.evil.com",
    "https://www.speaksharp.ai.evil.com",
    "https://speaksharp-public.vercel.app.evil.com",
    "https://speaksharp-public-evil.vercel.app", // not explicitly configured
    "http://speaksharp-public.vercel.app", // wrong protocol
    "http://localhost.example.com:5174",
    "http://127.0.0.1.example.com:5174",
    "http://localhost:3000", // unapproved port
    "http://localhost:80", // canonicalizes to http://localhost — not allowlisted
    "https://localhost:5174", // wrong protocol for localhost
    "https://user@speaksharp.ai", // userinfo
    "https://speaksharp.ai/path",
    "https://speaksharp.ai?x=1",
    "https://speaksharp.ai#frag",
    "http://a.com, http://b.com", // comma-separated
    "null",
    "",
    "   ",
    "not-a-url",
    "https://xn--speaksharp-evil.ai", // punycode lookalike
    // NOTE: CRLF/header-injection Origins cannot be set via the Headers API (the platform blocks
    // them), so they are exercised at the normalizeExactOrigin() level in the direct test above.
  ];

  for (const bad of rejected) {
    await t.step(`rejects ${JSON.stringify(bad)}`, () => {
      assertEquals(isAllowedOrigin(bad, ALLOWED), false);

      // corsHeadersForRequest emits NO Access-Control-Allow-Origin and never reflects the origin.
      const headers = corsHeadersForRequest(reqWith(bad), ALLOWED);
      assertEquals(headers["Access-Control-Allow-Origin"], undefined);
      for (const v of Object.values(headers)) {
        assert(v !== bad, "must not reflect hostile origin");
      }

      // rejectDisallowedOrigin → 403, no ACAO, no fallback production origin.
      const rej = rejectDisallowedOrigin(reqWith(bad), ALLOWED);
      assert(rej instanceof Response);
      assertEquals(rej!.status, 403);
      assertEquals(rej!.headers.get("Access-Control-Allow-Origin"), null);
      for (const allowed of ALLOWED) {
        assert(rej!.headers.get("Access-Control-Allow-Origin") !== allowed);
      }
    });
  }
});

Deno.test("preflight (OPTIONS): approved → 204 exact ACAO + Vary; hostile → 403 no ACAO", () => {
  const ok = handleCorsPreflight(reqWith(PROD_ACTIVE, "OPTIONS"), ALLOWED);
  assert(ok instanceof Response);
  assertEquals(ok!.status, 204);
  assertEquals(ok!.headers.get("Access-Control-Allow-Origin"), PROD_ACTIVE);
  assertEquals(ok!.headers.get("Vary"), "Origin");

  const hostile = handleCorsPreflight(
    reqWith("https://speaksharp.ai.evil.com", "OPTIONS"),
    ALLOWED,
  );
  assert(hostile instanceof Response);
  assertEquals(hostile!.status, 403);
  assertEquals(hostile!.headers.get("Access-Control-Allow-Origin"), null);

  // Non-OPTIONS → null (not a preflight).
  assertEquals(handleCorsPreflight(reqWith(PROD_ACTIVE, "GET"), ALLOWED), null);
});

Deno.test("#1161: preflight advertises the X-SpeakSharp-Engine-Type request header (register unblocked)", () => {
  // The attest-session-engine register op requires this header; the browser preflight must advertise it or the
  // register request is blocked before the handler. The approved-origin OPTIONS response must list it.
  const pf = handleCorsPreflight(reqWith(PROD_ACTIVE, "OPTIONS"), ALLOWED);
  assert(pf instanceof Response);
  assertEquals(pf!.status, 204);
  const allowHeaders = (pf!.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
  assert(
    allowHeaders.split(",").map((h) => h.trim()).includes("x-speaksharp-engine-type"),
    `Access-Control-Allow-Headers must include x-speaksharp-engine-type; got "${allowHeaders}"`,
  );
  // The previously-allowed headers are preserved (case-insensitive).
  for (const h of ["authorization", "x-client-info", "apikey", "content-type"]) {
    assert(allowHeaders.includes(h), `allow-headers must still include ${h}`);
  }
});

Deno.test("no-Origin server-to-server request: permitted, no fabricated ACAO", () => {
  const req = reqWith(undefined, "POST");
  // Not rejected — server-to-server / webhook / health-check.
  assertEquals(rejectDisallowedOrigin(req, ALLOWED), null);
  // No fabricated Access-Control-Allow-Origin.
  const headers = corsHeadersForRequest(req, ALLOWED);
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
  // Preflight without Origin → 204, still no ACAO.
  const pf = handleCorsPreflight(reqWith(undefined, "OPTIONS"), ALLOWED);
  assertEquals(pf!.status, 204);
  assertEquals(pf!.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("backward-compatible corsHeaders() never emits a comma-separated or wildcard ACAO", () => {
  const headers = corsHeaders(reqWith("https://evil.example"));
  const acao = headers["Access-Control-Allow-Origin"];
  assert(acao === undefined);
  // Sanity: an allowed origin still echoes exactly (uses env-derived builtins).
  const allowed = corsHeaders(reqWith(PROD_ACTIVE));
  assertEquals(allowed["Access-Control-Allow-Origin"], PROD_ACTIVE);
  assert(allowed["Access-Control-Allow-Origin"] !== "*");
});
