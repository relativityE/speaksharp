import { closeAccount, type ClosureDependencies } from './accountClosure.ts';

export interface ClosureRequestDependencies {
  authenticate(req: Request): Promise<{ id: string; email: string } | null>;
  siteUrl: string;
  randomToken(): string;
  hashToken(token: string): Promise<string>;
  issue(userId: string, hash: string): Promise<boolean>;
  revoke(userId: string, hash: string): Promise<void>;
  sendLink(email: string, redirect: string): Promise<void>;
  closure(req: Request): ClosureDependencies;
  finish(userId: string, requestId: string): Promise<void>;
}

const reply = (status: number, data: object) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function handleClosureRequest(req: Request, deps: ClosureRequestDependencies): Promise<Response> {
  if (req.method !== 'POST') return reply(405, { error: 'post_required' });
  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > 4096) return reply(413, { error: 'request_too_large' });
  try {
    const user = await deps.authenticate(req);
    if (!user?.id || !user.email) return reply(401, { error: 'sign_in_required' });
    let text = '';
    const reader = req.body?.getReader();
    if (reader) {
      let bytes = 0;
      let timedOut = false;
      const decoder = new TextDecoder();
      const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10_000);
      try {
        while (true) {
          const chunk = await reader.read();
          if (timedOut) return reply(408, { error: 'request_body_timeout' });
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 4096) { await reader.cancel(); return reply(413, { error: 'request_too_large' }); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { clearTimeout(timeout); reader.releaseLock(); }
    }
    let body: Record<string, unknown>;
    try { body = JSON.parse(text) as Record<string, unknown>; }
    catch { return reply(400, { error: 'invalid_request' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'invalid_request' });
    if (body.action === 'request') {
      const origin = new URL(deps.siteUrl);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash
        || origin.pathname !== '/') return reply(503, { error: 'email_redirect_unavailable' });
      const token = deps.randomToken();
      if (!/^[a-f0-9]{64}$/.test(token)) return reply(503, { error: 'verification_unavailable' });
      const hash = await deps.hashToken(token);
      if (!(await deps.issue(user.id, hash))) return reply(429, { error: 'verification_request_busy' });
      const redirect = new URL('/account/delete', origin);
      redirect.searchParams.set('account_deletion_token', token);
      try { await deps.sendLink(user.email, redirect.href); }
      catch {
        await deps.revoke(user.id, hash);
        return reply(503, { error: 'verification_email_failed' });
      }
      return reply(200, { outcome: 'email_requested', expiresInSeconds: 900 });
    }
    if (body.action !== 'confirm' || body.confirmIrreversible !== true
      || typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
      return reply(400, { error: 'explicit_confirmation_required' });
    }
    const adapters = deps.closure(req);
    const originalClaim = adapters.consumeProof.bind(adapters);
    let requestId: string | null = null;
    const result = await closeAccount(user.id, body.token, {
      ...adapters,
      consumeProof: async (id, token) => {
        const proof = await originalClaim(id, token);
        requestId = proof?.requestId ?? null;
        return proof;
      },
    });
    if (requestId && !result.accountDeleted) await deps.finish(user.id, requestId);
    return reply(result.outcome === 'deleted' ? 200 : result.outcome === 'refused' ? 403 : 409, result);
  } catch {
    return reply(503, { error: 'account_closure_unavailable' });
  }
}
