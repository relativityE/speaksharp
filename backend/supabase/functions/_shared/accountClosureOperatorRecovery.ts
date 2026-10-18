import { recoverAccountClosure, type ClosureRecoveryResult } from './accountClosureRecovery.ts';
import { createAccountClosureRecoveryAdapter, type ClosureRecoveryClient } from './accountClosureRecoveryAdapter.ts';
import { verifyAccountClosureRuntimeBinding } from './accountClosureRuntimeBinding.ts';

interface Ports {
  env(key: string): string | undefined;
  fetch: typeof fetch;
  createAdminClient(url: string): ClosureRecoveryClient;
}
const held = (): ClosureRecoveryResult => ({ outcome: 'hold', stage: 'authority', reason: 'authority_unavailable', accountDeleted: null });

/**
 * Explicit private operator invocation for one already post-Auth request.
 * No public route, automatic rebind/retry, claim, DELETE, activation or fence
 * release. At most TWO bounded read-only Management API GETs surround recovery;
 * SQL generation checks still enforce invalidation-before-context-change.
 * Current manifest must come from independent release/config/schema evidence.
 * This entry must run only under separate exact-request operational authority.
 */
export async function recoverAccountClosureAsOperator(
  request: { userId: string; requestId: string }, ports: Ports,
): Promise<ClosureRecoveryResult> {
  try {
    const input = structuredClone(request);
    if (!input || Object.keys(input).length !== 2 || ![input.userId, input.requestId].every((id) =>
      typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))) return held();
    const url = new URL(ports.env('SUPABASE_URL') ?? '');
    const project = /^([a-z0-9-]{1,63})\.supabase\.co$/.exec(url.hostname)?.[1];
    const token = ports.env('SUPABASE_ACCESS_TOKEN');
    if (!project || !token || url.protocol !== 'https:' || url.username || url.password || url.port
      || url.search || url.hash || url.pathname !== '/') return held();
    async function deployment() {
      // Fixed official endpoint; redirects cannot forward operator credentials.
      // https://supabase.com/docs/reference/api/v1-get-a-function
      const response = await ports.fetch(`https://api.supabase.com/v1/projects/${project}/functions/account-closure`, {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 200 || Number(response.headers.get('content-length') ?? 0) > 32_768) {
        await response.body?.cancel(); throw new Error('platform_readback_unavailable');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('platform_readback_unavailable');
      let text = ''; let bytes = 0; const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 32_768) { await reader.cancel(); throw new Error('platform_readback_unavailable'); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      const value = JSON.parse(text);
      if (!value || value.slug !== 'account-closure' || value.status !== 'ACTIVE'
        || typeof value.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id)
        || !Number.isSafeInteger(value.version) || value.version <= 0) throw new Error('platform_readback_unavailable');
      return `${project}_${value.id}_${value.version}`;
    }
    const firstId = await deployment();
    const read = () => verifyAccountClosureRuntimeBinding(ports.env('ACCOUNT_CLOSURE_RUNTIME_BINDING'), ports.env('SUPABASE_URL'), firstId);
    const first = read();
    const dependencies = createAccountClosureRecoveryAdapter(first.target, {
      createAdminClient: ports.createAdminClient,
      getCurrentScope: async () => {
        const current = read();
        if (JSON.stringify(current) !== JSON.stringify(first)) throw new Error('context_changed');
        return current.scope;
      },
    }).forRequest(input);
    const result = await recoverAccountClosure(input, dependencies);
    if (await deployment() !== firstId || JSON.stringify(read()) !== JSON.stringify(first)) return held();
    return result;
  } catch { return held(); }
}
