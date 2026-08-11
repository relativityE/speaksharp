/**
 * Exact-origin, fail-closed CORS policy for Edge Functions.
 *
 * ⚠️ IDE LINT NOTE: "Cannot find name 'Deno'" is a FALSE POSITIVE.
 * This file runs in Supabase Edge Functions (Deno runtime), not Node.js.
 * The `Deno` global is available at runtime. Do not attempt to "fix" this.
 *
 * POLICY (P0.3):
 * - The set of allowed browser origins is an EXACT allowlist. There is NO substring, suffix,
 *   prefix, or wildcard matching. `https://evil-app.example.com`, `https://app.example.com.evil.test`,
 *   `http://localhost.example.com` and similar lookalikes are rejected.
 * - Every candidate origin (from the request `Origin` header AND from the `ALLOWED_ORIGIN` env)
 *   is parsed with the WHATWG `URL` parser and reduced to its canonical `URL.origin`. Only
 *   `http:`/`https:` are considered; credentials, path, query, fragment, `null`, multiple/
 *   comma-separated values, and malformed URLs are rejected before comparison.
 * - A disallowed/hostile origin is rejected with 403 BEFORE any function logic, and NO
 *   `Access-Control-Allow-Origin` header is emitted (no fallback / no reflection).
 * - Requests without an `Origin` (server-to-server, webhooks, health checks, trusted automation)
 *   are permitted to proceed, but never receive a fabricated `Access-Control-Allow-Origin`.
 *   CORS is not authentication — each function keeps its own auth/secret checks.
 *
 * CONFIGURATION:
 * - Extra production or preview origins are added via the comma-separated `ALLOWED_ORIGIN` env
 *   var (Supabase Dashboard). Each entry must be an EXACT origin; malformed entries are ignored
 *   observably. Preview deployments must be listed explicitly — there is no `*.vercel.app` match.
 * - To add an approved origin safely: append its exact `scheme://host[:port]` value to
 *   `ALLOWED_ORIGIN` (comma-separated). Never add a suffix/wildcard; add the precise origin.
 */

const ALLOWED_METHODS = "GET, POST, OPTIONS";
// `x-speaksharp-engine-type` (#1161): the attest-session-engine register op takes the engine class ONLY from this
// authenticated request header, so the browser preflight must advertise it or the register request is blocked.
// Header names are case-insensitive; kept lowercase to match the canonical list.
const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-speaksharp-engine-type";

/**
 * Built-in exact allowlist: confirmed product origins + local development origins.
 * Additional production/preview origins come from the `ALLOWED_ORIGIN` env (exact values only).
 */
export const BUILTIN_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  // Active production host (exact).
  "https://speaksharp-public.vercel.app",
  // Local development (Vite). Exact host:port only — no arbitrary localhost ports/subdomains.
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);

type EnvGetter = (key: string) => string | undefined;

const defaultEnv: EnvGetter = (key) => {
  try {
    return Deno.env.get(key) ?? undefined;
  } catch {
    // Deno.env may be unavailable (e.g. permissionless test contexts); treat as unset.
    return undefined;
  }
};

/**
 * Normalize a single candidate origin to its canonical `URL.origin`, or return `null` if the
 * value is not a valid, bare, http(s) origin. Rejects: `null` literal, empty/whitespace,
 * comma-separated/multiple values, interior whitespace, control/newline characters,
 * credentials (userinfo), non-http(s) schemes, and any path/query/fragment content.
 */
export function normalizeExactOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;

  // Reject ANY control character (incl. CR/LF/TAB/NUL/DEL) on the RAW value BEFORE trimming or
  // parsing — the WHATWG URL parser silently strips tabs/newlines, so header-injection bytes (even
  // trailing ones) must be caught here first. Configured allowlist entries are pre-trimmed by
  // parseConfiguredOrigins, so a legitimate value never carries control characters.
  // eslint-disable-next-line no-control-regex -- intentionally matches control chars to reject them
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;

  const raw = value.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "null") return null;
  if (/\s/.test(raw)) return null; // interior whitespace (also catches space-separated lists)
  if (raw.includes(",")) return null; // comma-separated / multiple origins

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null; // malformed URL
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null; // credentials / userinfo
  if (url.hash) return null; // fragment
  if (url.search) return null; // query
  if (url.pathname !== "" && url.pathname !== "/") return null; // path content
  // Reject any path separator in the raw authority — a valid Origin has no path, not even a bare
  // trailing slash (`https://host/`). Default-port forms like `https://host:443` have no `/` here.
  if (raw.slice(raw.indexOf("://") + 3).includes("/")) return null;

  // `URL.origin` is already canonical: lowercase scheme+host, default ports elided.
  return url.origin;
}

/**
 * Parse the comma-separated `ALLOWED_ORIGIN` env value into a deduplicated list of normalized
 * exact origins. Malformed entries are ignored observably (logged) and never allowed.
 */
export function parseConfiguredOrigins(
  value: string | undefined | null,
): string[] {
  if (!value) return [];
  const out = new Set<string>();
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = normalizeExactOrigin(trimmed);
    if (!normalized) {
      console.warn(
        `[cors] Ignoring malformed ALLOWED_ORIGIN entry: ${
          JSON.stringify(trimmed)
        }`,
      );
      continue;
    }
    out.add(normalized);
  }
  return Array.from(out);
}

/**
 * The effective allowlist: built-in exact origins plus any exact origins configured via
 * `ALLOWED_ORIGIN`, deduplicated. Read fresh per call so configuration changes are picked up.
 */
export function getAllowedOrigins(getEnv: EnvGetter = defaultEnv): string[] {
  const configured = parseConfiguredOrigins(getEnv("ALLOWED_ORIGIN"));
  return Array.from(
    new Set<string>([...BUILTIN_ALLOWED_ORIGINS, ...configured]),
  );
}

/**
 * Exact-match check: `true` only if `origin` normalizes to a value present in `allowedOrigins`
 * (which must already be normalized exact origins).
 */
export function isAllowedOrigin(
  origin: unknown,
  allowedOrigins: readonly string[],
): boolean {
  const normalized = normalizeExactOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.includes(normalized);
}

function baseCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Vary": "Origin",
  };
}

/**
 * Build the CORS response headers for a request. For an allowed browser origin, echoes ONLY the
 * validated, normalized origin (never the raw header, never `*`, never a fallback). For a
 * disallowed origin or a no-Origin request, returns the base headers WITHOUT
 * `Access-Control-Allow-Origin`.
 */
export function corsHeadersForRequest(
  request: Request,
  allowedOrigins: readonly string[] = getAllowedOrigins(),
): Record<string, string> {
  const headers = baseCorsHeaders();
  const origin = request.headers.get("Origin");
  if (origin) {
    const normalized = normalizeExactOrigin(origin);
    if (normalized && allowedOrigins.includes(normalized)) {
      headers["Access-Control-Allow-Origin"] = normalized;
    }
  }
  return headers;
}

/**
 * Backward-compatible alias. Existing functions call `corsHeaders(req)` at their response sites;
 * this now returns validated, exact headers (echoing only an allowed origin — never a fallback).
 */
export const corsHeaders = (req?: Request): Record<string, string> => {
  if (!req) return baseCorsHeaders();
  return corsHeadersForRequest(req);
};

const ORIGIN_NOT_ALLOWED_BODY = JSON.stringify({
  error: { code: "origin_not_allowed", message: "Origin not allowed" },
});

/**
 * Authoritative early rejection for a NON-preflight request whose `Origin` is present but not
 * allowed. Returns a 403 Response (no `Access-Control-Allow-Origin`, sanitized body) that the
 * caller must return BEFORE any auth/database/provider/Stripe/token side effects. Returns `null`
 * for allowed origins and for no-Origin (server-to-server) requests so they proceed normally.
 */
export function rejectDisallowedOrigin(
  request: Request,
  allowedOrigins: readonly string[] = getAllowedOrigins(),
): Response | null {
  const origin = request.headers.get("Origin");
  // Header ABSENT (null) → server-to-server / webhook / health-check — CORS is not auth.
  // Header PRESENT but empty/whitespace/invalid → hostile-shaped, fall through to 403.
  if (origin === null) return null;
  if (isAllowedOrigin(origin, allowedOrigins)) return null;
  return new Response(ORIGIN_NOT_ALLOWED_BODY, {
    status: 403,
    headers: { "Content-Type": "application/json", "Vary": "Origin" },
  });
}

/**
 * Handle a CORS preflight. Returns a Response for `OPTIONS` requests only (else `null`):
 * - allowed origin (or no Origin) → 204 with the exact CORS headers;
 * - disallowed origin → 403 with NO `Access-Control-Allow-Origin`.
 */
export function handleCorsPreflight(
  request: Request,
  allowedOrigins: readonly string[] = getAllowedOrigins(),
): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("Origin");
  // Present (even empty) but not allowed → hostile preflight → 403. Absent → allowed to 204.
  if (origin !== null && !isAllowedOrigin(origin, allowedOrigins)) {
    return new Response(null, { status: 403, headers: { "Vary": "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: corsHeadersForRequest(request, allowedOrigins),
  });
}

/**
 * Convenience guard for a function handler: run this at the very top. Returns a Response to return
 * immediately (204 approved preflight / 403 hostile preflight / 403 hostile normal request), or
 * `null` when the request is allowed to proceed to the handler's own logic.
 */
export function corsGuard(
  request: Request,
  allowedOrigins: readonly string[] = getAllowedOrigins(),
): Response | null {
  const preflight = handleCorsPreflight(request, allowedOrigins);
  if (preflight) return preflight;
  return rejectDisallowedOrigin(request, allowedOrigins);
}
