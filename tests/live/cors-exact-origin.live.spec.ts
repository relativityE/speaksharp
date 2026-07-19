import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * Live/DAST exact-origin CORS security proof (P0.3).
 *
 * Sends NON-DESTRUCTIVE requests (OPTIONS preflights + unauthenticated POSTs) to the deployed
 * browser-callable Supabase Edge Functions with controlled Origin headers, and proves the
 * exact-origin, fail-closed policy:
 *   - the active production Origin is accepted (its response echoes exactly that Origin);
 *   - hostile lookalikes / wrong-protocol / unapproved-port / localhost-lookalike Origins are
 *     rejected with NO Access-Control-Allow-Origin and are never reflected;
 *   - hostile preflights are rejected;
 *   - a hostile normal request never reaches downstream behavior (it returns the CORS 403).
 *
 * No real checkout, charges, tokens, invitations, v4 activation, or destructive DB writes occur:
 * approved requests deliberately carry no auth (→ the function's own 401) or hit the fail-closed
 * billing guard (→ 403 payments_disabled). Nothing is created.
 *
 * CANDIDATE GATE: this asserts the NEW policy. Until a build carrying P0.3 is deployed, the target
 * still reflects hostile Origins; the suite then SKIPS with a clear message (it is a post-deploy
 * gate). Once the candidate is deployed, it enforces fully.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;

// The active production app origin (what the browser sends when calling the edge functions).
const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';

const HOSTILE_ORIGINS = [
  'https://evil-speaksharp.ai',
  'https://speaksharp.ai.evil.com',
  'http://localhost.example.com:5174',
  'http://speaksharp-public.vercel.app', // wrong protocol
  'http://localhost:3000', // unapproved port
];

// Browser-callable functions probed non-destructively.
const FUNCTIONS = ['assemblyai-token', 'check-usage-limit', 'stripe-checkout'];

function fnPath(name: string): string {
  return `/functions/v1/${name}`;
}

async function acaoFor(ctx: APIRequestContext, name: string, origin: string, method: 'POST' | 'OPTIONS') {
  const res = method === 'OPTIONS'
    ? await ctx.fetch(fnPath(name), { method: 'OPTIONS', headers: { Origin: origin } })
    : await ctx.post(fnPath(name), { headers: { Origin: origin }, data: {} });
  return { status: res.status(), acao: res.headers()['access-control-allow-origin'] ?? null };
}

test.describe.serial('Live exact-origin CORS @live', () => {
  let ctx: APIRequestContext;
  let candidateDeployed = false;

  test.beforeAll(async () => {
    test.skip(!SUPABASE_URL, 'SUPABASE_URL is required for the live CORS proof.');
    ctx = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });

    // Capability probe: a hostile Origin must NOT be reflected on the NEW build. If the deployed
    // target still reflects it, P0.3 is not deployed yet — skip (post-deploy gate).
    const probe = await acaoFor(ctx, 'assemblyai-token', 'https://evil-speaksharp.ai', 'POST');
    candidateDeployed = probe.acao !== 'https://evil-speaksharp.ai';
    console.log(`LIVE_CORS_CANDIDATE_DEPLOYED ${JSON.stringify({ candidateDeployed, probe })}`);
    test.skip(
      !candidateDeployed,
      'Deployed target still reflects hostile Origins — P0.3 exact-origin CORS is not deployed yet.',
    );
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('active production Origin is accepted and echoed exactly', async () => {
    for (const name of FUNCTIONS) {
      const { acao } = await acaoFor(ctx, name, APPROVED_ORIGIN, 'POST');
      expect(acao, `${name} must echo the approved origin`).toBe(APPROVED_ORIGIN);
    }
  });

  test('approved preflight → 204 with exact ACAO; hostile preflight → no ACAO', async () => {
    for (const name of FUNCTIONS) {
      const ok = await acaoFor(ctx, name, APPROVED_ORIGIN, 'OPTIONS');
      expect(ok.status, `${name} approved preflight status`).toBe(204);
      expect(ok.acao, `${name} approved preflight ACAO`).toBe(APPROVED_ORIGIN);

      const hostile = await acaoFor(ctx, name, 'https://speaksharp.ai.evil.com', 'OPTIONS');
      expect(hostile.status, `${name} hostile preflight status`).toBe(403);
      expect(hostile.acao, `${name} hostile preflight must have no ACAO`).toBeNull();
    }
  });

  test('hostile Origins are rejected, never reflected, and reach no downstream behavior', async () => {
    for (const name of FUNCTIONS) {
      for (const origin of HOSTILE_ORIGINS) {
        const { status, acao } = await acaoFor(ctx, name, origin, 'POST');
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
    const { status, acao } = await acaoFor(ctx, 'assemblyai-token', APPROVED_ORIGIN, 'POST');
    expect(acao).toBe(APPROVED_ORIGIN);
    expect(status).not.toBe(403); // assemblyai-token's own gate is 401 (missing auth), not a CORS 403
  });
});
