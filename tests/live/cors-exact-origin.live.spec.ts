import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * Live/DAST exact-origin CORS security gate (P0.3) — FAIL-CLOSED.
 *
 * Sends NON-DESTRUCTIVE requests (OPTIONS preflights + unauthenticated POSTs) to the deployed
 * browser-callable Supabase Edge Functions with controlled Origin headers, and asserts the
 * exact-origin, fail-closed policy against the DEPLOYED target:
 *   - the active production Origin is accepted and echoed exactly;
 *   - hostile lookalikes / wrong-protocol / unapproved-port / localhost-lookalike Origins are
 *     rejected with 403, NO Access-Control-Allow-Origin, and are never reflected or fallen-back;
 *   - hostile preflights are rejected;
 *   - a hostile normal request never reaches downstream behavior (it returns the CORS 403);
 *   - a valid application request still works.
 *
 * This is a MANDATORY post-merge/post-deploy security gate. It contains NO capability probe and NO
 * configuration-based skip: if the deployed target still serves the old permissive CORS, if the
 * Edge Functions were not deployed, or if the wrong Supabase project/URL is targeted, these
 * assertions FAIL (they never silently pass). Missing SUPABASE_URL throws rather than skips.
 *
 * Not part of ordinary pre-merge CI: it runs only in Gate 3 DAST (`pnpm rc:dast:live`) against the
 * deployed candidate. No real checkout, charges, tokens, invitations, v4 activation, or destructive
 * DB writes occur — approved requests carry no auth (→ the function's own 401) or hit the fail-closed
 * billing guard (→ 403 payments_disabled). Nothing is created.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;

// The active production app origin (what the browser sends when calling the edge functions).
const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';

const HOSTILE_ORIGINS = [
  'https://evil-app.example.com',
  'https://app.example.com.evil.test',
  'http://localhost.example.com:5174',
  'http://speaksharp-public.vercel.app', // wrong protocol
  'http://localhost:3000', // unapproved port
];

// Browser-callable functions probed non-destructively.
const FUNCTIONS = ['assemblyai-token', 'check-usage-limit', 'stripe-checkout'];

function fnPath(name: string): string {
  return `/functions/v1/${name}`;
}

async function probe(ctx: APIRequestContext, name: string, origin: string, method: 'POST' | 'OPTIONS') {
  const res = method === 'OPTIONS'
    ? await ctx.fetch(fnPath(name), { method: 'OPTIONS', headers: { Origin: origin } })
    : await ctx.post(fnPath(name), { headers: { Origin: origin }, data: {} });
  return { status: res.status(), acao: res.headers()['access-control-allow-origin'] ?? null };
}

test.describe.serial('Live exact-origin CORS @live', () => {
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    // Fail-closed: a missing target is a gate failure, NOT a skip.
    if (!SUPABASE_URL) {
      throw new Error('LIVE_CORS_PROOF_NOT_RUNNABLE: SUPABASE_URL or VITE_SUPABASE_URL is required');
    }
    ctx = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('active production Origin is accepted and echoed exactly', async () => {
    for (const name of FUNCTIONS) {
      const { acao } = await probe(ctx, name, APPROVED_ORIGIN, 'POST');
      expect(acao, `${name} must echo the approved origin`).toBe(APPROVED_ORIGIN);
    }
  });

  test('approved preflight → 204 with exact ACAO; hostile preflight → 403 with no ACAO', async () => {
    for (const name of FUNCTIONS) {
      const ok = await probe(ctx, name, APPROVED_ORIGIN, 'OPTIONS');
      expect(ok.status, `${name} approved preflight status`).toBe(204);
      expect(ok.acao, `${name} approved preflight ACAO`).toBe(APPROVED_ORIGIN);

      const hostile = await probe(ctx, name, 'https://app.example.com.evil.test', 'OPTIONS');
      expect(hostile.status, `${name} hostile preflight status`).toBe(403);
      expect(hostile.acao, `${name} hostile preflight must have no ACAO`).toBeNull();
    }
  });

  test('hostile Origins are rejected (403), never reflected, no fallback, no downstream', async () => {
    for (const name of FUNCTIONS) {
      for (const origin of HOSTILE_ORIGINS) {
        const { status, acao } = await probe(ctx, name, origin, 'POST');
        const label = `${name} ← ${origin}`;
        expect(status, `${label} must be 403`).toBe(403);
        expect(acao, `${label} must not send ACAO`).toBeNull();
        expect(acao, `${label} must never reflect the hostile origin`).not.toBe(origin);
        expect(acao, `${label} must not fall back to the approved origin`).not.toBe(APPROVED_ORIGIN);
      }
    }
  });

  test('allowed production request still works (approved origin is not collateral-damaged)', async () => {
    // Approved origin, no auth → the function's OWN response (401 / 403 payments_disabled), never a
    // CORS 403 origin_not_allowed — and it still carries the exact approved ACAO.
    const { status, acao } = await probe(ctx, 'assemblyai-token', APPROVED_ORIGIN, 'POST');
    expect(acao).toBe(APPROVED_ORIGIN);
    expect(status).not.toBe(403); // assemblyai-token's own gate is 401 (missing auth), not a CORS 403
  });
});
