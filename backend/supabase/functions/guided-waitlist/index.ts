// #1061 Guided Rehearsal pre-launch interest ("Notify me") — durable, deduplicated, DOUBLE-OPT-IN waitlist.
//
// SECURITY / INTEGRITY (mirrors the applied migration 20260727180000_guided_waitlist.sql)
//  * Service-role ONLY: the browser never writes the table; it calls this function, which uses the
//    service-role key (never exposed to the client) to write `public.guided_waitlist` (RLS deny-all).
//  * Server-side normalize + validate the email (canonical form matching the DB CHECK constraints);
//    dedup by (product, normalized email) — idempotent resubmission yields exactly ONE durable row.
//  * SELF-ASSERTED consent is mandatory; the initial record is `pending` only. A record becomes
//    `confirmed` (a subscription) ONLY after a successful confirmation within the token's validity window.
//  * Confirmation tokens are cryptographically random, single-use, and expiring. We store ONLY a SHA-256
//    HASH of the token — never the raw token — and CLEAR the hash on confirmation (single use).
//  * Account/existence is NEVER revealed: submit + confirm return generic responses.
//  * NO PII in logs / responses: only product / source / outcome are logged. Never the email, raw token,
//    or token hash. The response body is `{ ok }` (+ a coarse machine error code) only.
//  * Provider-INDEPENDENT confirmation transport: delivery is an injected seam. The default is a NO-OP
//    (no provider is configured, no email is sent). Wiring a transactional provider — and adding this
//    function to the deploy allowlist — are SEPARATELY authorized steps. This function is NOT deployed.
//
// ⚠️ IDE LINT NOTE: "Cannot find name 'Deno'" is a FALSE POSITIVE — this runs in the Supabase Edge (Deno)
// runtime, not Node. Do not "fix" it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders } from '../_shared/cors.ts';

// ── Stable internal identifiers (NOT user-facing labels) ────────────────────────────────────────────
export const ALLOWED_PRODUCTS = new Set(['guided_rehearsal']);
export const ALLOWED_SOURCES = new Set(['anonymous_landing', 'authenticated_practice']);
export const CONSENT_VERSION = 'guided_waitlist_v1';

const MAX_EMAIL_LENGTH = 254;      // RFC 5321 / DB CHECK
const MIN_EMAIL_LENGTH = 3;        // a@b — DB CHECK
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;       // confirmation link valid for 24h
export const RESEND_COOLDOWN_MS = 60 * 1000;           // don't rotate a still-valid token within 60s (idempotent)
export const RATE_LIMIT_MAX = 5;                       // max submits per window per client key
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────
export interface WaitlistRow {
  id: string;
  product: string;
  email_normalized: string;
  status: 'pending' | 'confirmed';
  confirmation_token_hash: string | null;
  confirmation_sent_at: string | null;
  confirmation_expires_at: string | null;
  confirmed_at: string | null;
}

/** Minimal durable-store surface, so the handler is unit-testable with an in-memory fake (no real DB). */
export interface WaitlistStore {
  findByProductEmail(product: string, emailNormalized: string): Promise<WaitlistRow | null>;
  findByTokenHash(tokenHash: string): Promise<WaitlistRow | null>;
  /** Insert a fresh pending row already carrying an issued token (pending-sent shape). */
  insertPendingWithToken(row: {
    product: string; email_normalized: string; consent_source: string; acquisition_source: string;
    confirmation_token_hash: string; confirmation_sent_at: string; confirmation_expires_at: string;
  }): Promise<{ inserted: boolean; conflict: boolean }>;
  /** Rotate the token on an existing pending row (stays pending-sent). */
  reissueToken(id: string, tokenHash: string, sentAt: string, expiresAt: string): Promise<void>;
  /** Atomically confirm a still-pending row: set confirmed_at + status, CLEAR the hash. Returns whether it applied. */
  confirm(id: string, confirmedAt: string): Promise<boolean>;
}

/** Best-effort request-rate limiter. Returns true if the call is permitted (and consumes a slot). */
export interface RateLimiter {
  check(key: string): boolean;
}

export interface WaitlistDeps {
  getEnv: (key: string) => string | undefined;
  createStore: (url: string, serviceRoleKey: string) => WaitlistStore;
  now: () => number;
  randomToken: () => string;                                // raw token (never stored/logged/returned)
  hashToken: (raw: string) => Promise<string>;              // 64-char lowercase hex
  rateLimiter: RateLimiter;
  /** Provider-independent delivery seam. Default is a NO-OP (no provider configured, no email sent). */
  deliverConfirmation: (emailNormalized: string, rawToken: string) => Promise<void>;
}

// ── Crypto helpers (Web Crypto; available in the Deno edge runtime) ──────────────────────────────────
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function generateRawToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b); // 64 hex chars, 256 bits of entropy
}
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

// ── Validation (canonical email form MATCHING the DB CHECK constraints) ──────────────────────────────
export function normalizeAndValidate(payload: {
  email?: unknown; product?: unknown; consent?: unknown; source?: unknown;
}): { valid: boolean; emailNormalized: string; product: string; source: string } {
  const emailNormalized = (typeof payload.email === 'string' ? payload.email : '').trim().toLowerCase();
  const product = typeof payload.product === 'string' ? payload.product : '';
  const source = typeof payload.source === 'string' ? payload.source : '';
  const consent = payload.consent === true;
  const at = emailNormalized.indexOf('@');
  const emailOk =
    emailNormalized.length >= MIN_EMAIL_LENGTH &&
    emailNormalized.length <= MAX_EMAIL_LENGTH &&
    emailNormalized === emailNormalized.trim() &&   // no surrounding whitespace (DB btrim guard)
    at > 0 &&                                        // non-empty local part
    at < emailNormalized.length - 1 &&               // non-empty domain part
    emailNormalized.indexOf('@', at + 1) === -1;     // exactly one '@'
  const valid = emailOk && ALLOWED_PRODUCTS.has(product) && ALLOWED_SOURCES.has(source) && consent === true;
  return { valid, emailNormalized, product, source };
}

// ── Default in-memory rate limiter (best-effort; see threat-model note in the PR) ────────────────────
export function createInMemoryRateLimiter(
  max = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
  now: () => number = () => Date.now(),
): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

function json(body: Record<string, unknown>, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

// Derive a NON-PII client key for rate limiting: a hash of the forwarded IP (never the raw IP).
async function clientKey(req: Request, hashToken: (s: string) => Promise<string>): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  return (await hashToken(`ratelimit|${ip}`)).slice(0, 32);
}

async function readInput(req: Request): Promise<{ token?: string; body: Record<string, unknown> }> {
  const url = new URL(req.url);
  const qToken = url.searchParams.get('token') ?? undefined;
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }
  }
  const token = qToken ?? (typeof body.token === 'string' ? body.token : undefined);
  return { token, body };
}

// ── Handler ──────────────────────────────────────────────────────────────────────────────────────────
export async function handler(req: Request, deps: WaitlistDeps): Promise<Response> {
  const guard = corsGuard(req);
  if (guard) return guard;

  if (req.method !== 'POST' && req.method !== 'GET') return json({ ok: false }, 405, req);

  const { token, body } = await readInput(req);

  // Config (service role) — fail closed.
  const supabaseUrl = deps.getEnv('SUPABASE_URL');
  const serviceRoleKey = deps.getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ fn: 'guided-waitlist', outcome: 'config_missing_env' }));
    return json({ ok: false, error: 'server_error' }, 500, req);
  }
  const store = deps.createStore(supabaseUrl, serviceRoleKey);

  // ── CONFIRM path (token present) ── generic responses; no existence disclosure ──
  if (token) {
    try {
      const tokenHash = await deps.hashToken(token);
      const row = await store.findByTokenHash(tokenHash);
      const t = deps.now();
      const within =
        !!row && row.status === 'pending' &&
        !!row.confirmation_sent_at && !!row.confirmation_expires_at &&
        t >= Date.parse(row.confirmation_sent_at) && t <= Date.parse(row.confirmation_expires_at);
      if (!within || !row) {
        console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: 'confirm_rejected' }));
        return json({ ok: false }, 400, req); // expired / reused / unknown — all generic
      }
      const applied = await store.confirm(row.id, new Date(t).toISOString());
      console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: applied ? 'confirmed' : 'confirm_noop' }));
      return json({ ok: applied }, applied ? 200 : 400, req);
    } catch {
      console.error(JSON.stringify({ fn: 'guided-waitlist', outcome: 'confirm_error' }));
      return json({ ok: false, error: 'server_error' }, 500, req);
    }
  }

  // ── SUBMIT path ──
  if (req.method !== 'POST') return json({ ok: false }, 405, req);

  const { valid, emailNormalized, product, source } = normalizeAndValidate(body);
  if (!valid) {
    console.warn(JSON.stringify({ fn: 'guided-waitlist', outcome: 'validation_rejected', product, source }));
    return json({ ok: false, error: 'validation_failed' }, 400, req); // no PII echoed
  }

  // Rate limit (best-effort per hashed client key).
  if (!deps.rateLimiter.check(await clientKey(req, deps.hashToken))) {
    console.warn(JSON.stringify({ fn: 'guided-waitlist', outcome: 'rate_limited', product, source }));
    return json({ ok: false, error: 'rate_limited' }, 429, req);
  }

  try {
    const t = deps.now();
    const existing = await store.findByProductEmail(product, emailNormalized);

    // Already confirmed → generic success, no token churn, no disclosure.
    if (existing && existing.status === 'confirmed') {
      console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: 'submit_noop_confirmed', product, source }));
      return json({ ok: true }, 200, req);
    }

    // Pending with a still-valid token issued within the cooldown → idempotent no-op (don't rotate/spam).
    if (existing && existing.status === 'pending' && existing.confirmation_expires_at && existing.confirmation_sent_at) {
      const valid = t <= Date.parse(existing.confirmation_expires_at);
      const fresh = t - Date.parse(existing.confirmation_sent_at) < RESEND_COOLDOWN_MS;
      if (valid && fresh) {
        console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: 'submit_noop_pending', product, source }));
        return json({ ok: true }, 200, req);
      }
    }

    // Issue (or rotate) a single-use expiring token; store the HASH only.
    const rawToken = deps.randomToken();
    const tokenHash = await deps.hashToken(rawToken);
    const sentAt = new Date(t).toISOString();
    const expiresAt = new Date(t + TOKEN_TTL_MS).toISOString();

    if (!existing) {
      const res = await store.insertPendingWithToken({
        product, email_normalized: emailNormalized, consent_source: source, acquisition_source: source,
        confirmation_token_hash: tokenHash, confirmation_sent_at: sentAt, confirmation_expires_at: expiresAt,
      });
      // On a race (unique conflict), another request already created the row — treat as idempotent success.
      if (!res.inserted && res.conflict) {
        console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: 'submit_conflict_idempotent', product, source }));
        return json({ ok: true }, 200, req);
      }
    } else {
      await store.reissueToken(existing.id, tokenHash, sentAt, expiresAt);
    }

    // Provider-independent delivery seam (default NO-OP: no provider, no email sent). Never logs the token.
    await deps.deliverConfirmation(emailNormalized, rawToken);

    console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: 'submit_issued', product, source }));
    return json({ ok: true }, 200, req); // generic — new or existing, never disclosed
  } catch {
    console.error(JSON.stringify({ fn: 'guided-waitlist', outcome: 'submit_error', product, source }));
    return json({ ok: false, error: 'server_error' }, 500, req);
  }
}

// ── Production wiring (NOT deployed until separately authorized) ──────────────────────────────────────
function supabaseStore(url: string, serviceRoleKey: string): WaitlistStore {
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const table = 'guided_waitlist';
  return {
    async findByProductEmail(product, emailNormalized) {
      const { data } = await admin.from(table).select('*').eq('product', product).eq('email_normalized', emailNormalized).maybeSingle();
      return (data as WaitlistRow | null) ?? null;
    },
    async findByTokenHash(tokenHash) {
      const { data } = await admin.from(table).select('*').eq('confirmation_token_hash', tokenHash).maybeSingle();
      return (data as WaitlistRow | null) ?? null;
    },
    async insertPendingWithToken(row) {
      const { error } = await admin.from(table).insert({
        product: row.product,
        email_normalized: row.email_normalized,
        self_asserted_consent: true,
        consent_version: CONSENT_VERSION,
        consent_source: row.consent_source,
        acquisition_source: row.acquisition_source,
        status: 'pending',
        confirmation_token_hash: row.confirmation_token_hash,
        confirmation_sent_at: row.confirmation_sent_at,
        confirmation_expires_at: row.confirmation_expires_at,
      });
      if (error) return { inserted: false, conflict: (error as { code?: string }).code === '23505' };
      return { inserted: true, conflict: false };
    },
    async reissueToken(id, tokenHash, sentAt, expiresAt) {
      await admin.from(table).update({
        confirmation_token_hash: tokenHash, confirmation_sent_at: sentAt, confirmation_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'pending');
    },
    async confirm(id, confirmedAt) {
      // Guarded on status='pending' so a concurrent double-confirm applies once.
      const { data } = await admin.from(table).update({
        status: 'confirmed', confirmed_at: confirmedAt, confirmation_token_hash: null,
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'pending').select('id');
      return Array.isArray(data) && data.length === 1;
    },
  };
}

serve((req: Request) => handler(req, {
  getEnv: (k) => Deno.env.get(k),
  createStore: supabaseStore,
  now: () => Date.now(),
  randomToken: generateRawToken,
  hashToken: sha256Hex,
  rateLimiter: createInMemoryRateLimiter(),
  // NO-OP delivery: no transactional provider is configured. Wiring one is a separately-authorized step.
  deliverConfirmation: async () => { /* intentionally does nothing — no email is sent */ },
}));
