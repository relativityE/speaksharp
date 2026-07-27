// #1061 Guided Rehearsal pre-launch interest ("Notify me") — durable, deduplicated waitlist capture.
//
// SECURITY / INTEGRITY
//  * Service-role ONLY: the browser never writes the table; it calls this function, which uses the
//    service-role key (never exposed to the client) to write `public.guided_waitlist`.
//  * Server-side normalize + validate the email; deduplicate by (product, normalized email) via an
//    idempotent upsert (ignoreDuplicates) so repeated submissions yield exactly ONE durable row.
//  * Account-existence is NEVER revealed: the response is generic success whether the row is new or existed.
//  * NO PII in logs: only product / source / outcome are logged — never the email, consent text, or errors
//    carrying PII.
//
// ⚠️ IDE LINT NOTE: "Cannot find name 'Deno'" is a FALSE POSITIVE — this runs in the Supabase Edge (Deno)
// runtime, not Node. Do not "fix" it.
//
// NOT DEPLOYED/ACTIVATED IN THIS PR. Deploying this function + applying the migration is a separate,
// explicitly-authorized Product Owner step.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders } from '../_shared/cors.ts';

// Stable internal identifiers (NOT user-facing labels). The single supported product today.
const ALLOWED_PRODUCTS = new Set(['guided_rehearsal']);
const ALLOWED_SOURCES = new Set(['anonymous_landing', 'authenticated_practice']);
const CONSENT_VERSION = 'guided_waitlist_v1';
const MAX_EMAIL_LENGTH = 254; // RFC 5321
// Pragmatic email shape check (server-side). Strict correctness is enforced by real delivery later; this
// rejects obviously-invalid input without over-promising validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: Record<string, unknown>, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

serve(async (req: Request) => {
  // Exact-origin CORS (preflight + reject hostile origins) BEFORE any logic.
  const guard = corsGuard(req);
  if (guard) return guard;

  if (req.method !== 'POST') return json({ ok: false }, 405, req);

  let payload: { email?: unknown; product?: unknown; consent?: unknown; source?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400, req);
  }

  const emailRaw = typeof payload.email === 'string' ? payload.email : '';
  const product = typeof payload.product === 'string' ? payload.product : '';
  const source = typeof payload.source === 'string' ? payload.source : '';
  const consent = payload.consent === true;

  // Server-side validation (never trust the client).
  const emailNormalized = emailRaw.trim().toLowerCase();
  const valid =
    emailNormalized.length > 0 &&
    emailNormalized.length <= MAX_EMAIL_LENGTH &&
    EMAIL_RE.test(emailNormalized) &&
    ALLOWED_PRODUCTS.has(product) &&
    ALLOWED_SOURCES.has(source) &&
    consent === true;

  if (!valid) {
    // Log outcome only — NEVER the email/consent content.
    console.warn(JSON.stringify({ fn: 'guided-waitlist', outcome: 'validation_rejected', product, source }));
    return json({ ok: false, error: 'validation_failed' }, 400, req);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ fn: 'guided-waitlist', outcome: 'config_missing_env' }));
    return json({ ok: false, error: 'server_error' }, 500, req);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Idempotent upsert: one durable row per (product, normalized email). ignoreDuplicates keeps repeated
  // submissions from creating a second record; the response is generic either way (no existence disclosure).
  const { error } = await admin
    .from('guided_waitlist')
    .upsert(
      {
        product,
        email_normalized: emailNormalized,
        consent: true,
        consent_version: CONSENT_VERSION,
        consent_source: source,
        acquisition_source: source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product,email_normalized', ignoreDuplicates: true },
    );

  if (error) {
    // Never log the email or the raw error if it might carry PII — log a stable outcome + code only.
    console.error(JSON.stringify({ fn: 'guided-waitlist', outcome: 'db_error', product, source, code: error.code ?? null }));
    return json({ ok: false, error: 'server_error' }, 500, req);
  }

  console.info(JSON.stringify({ fn: 'guided-waitlist', outcome: 'accepted', product, source }));
  return json({ ok: true }, 200, req);
});
