import { completePendingAccount, type CompletionGrant, type CompletionResult } from './accountClosureCompletion.ts';
import { createAccountCompletionPorts, type CompletionBinding, type CompletionRpcPorts } from './accountClosureCompletionAdapter.ts';
import { assertCompletionPolicyPorts, createAccountCompletionPolicy, type CompletionPolicyPorts } from './accountClosureCompletionPolicy.ts';

export interface CompletionExecutorPorts extends CompletionRpcPorts {
  /** Private source composition selection; absent is OFF. This is not a browser flag or activation mechanism. */
  enabled?: boolean;
  authenticate(request: Request, targetUrl: string): Promise<unknown>;
  policy: CompletionPolicyPorts;
}
export type CompletionExecution = CompletionResult | { outcome: 'unauthorized' | 'unavailable' };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const keys = ['projectId', 'environment', 'url', 'scopeDigest'] as const;
const same = (actual: unknown, expected: CompletionBinding) => object(actual)
  && Object.keys(actual).length === keys.length && keys.every(key => actual[key] === expected[key]);

/** Server-only composition; absent selection stays disabled. No default client/provider or credential acquisition. */
export function createAccountCompletionExecutor(input: CompletionBinding, ports: CompletionExecutorPorts) {
  const binding = structuredClone(input);
  return {
    async execute(request: Request, input: unknown): Promise<CompletionExecution> {
      if (ports.enabled !== true) return { outcome: 'unavailable' };
      try {
        const body = structuredClone(input);
        if (!object(body) || Object.keys(body).length !== 1 || !uuid(body.requestId)) return { outcome: 'unavailable' };
        if (!/^Bearer \S{1,4096}$/.test(request.headers.get('authorization') ?? '')) return { outcome: 'unauthorized' };
        const current = async () => {
          const actual = await ports.currentBinding();
          if (!same(actual, binding)) throw new Error('completion_binding_changed');
          return actual;
        };
        await current();
        // Refuse an incomplete paid adapter before claiming any execution, including for free accounts.
        assertCompletionPolicyPorts(ports.policy);
        const rpc = createAccountCompletionPorts(binding, {
          createAdminClient: url => ports.createAdminClient(url), currentBinding: current,
          now: () => ports.policy.now(),
          policy: grant => createAccountCompletionPolicy(grant, ports.policy, () => authority(grant)),
        });
        const authority = async (grant: Readonly<CompletionGrant>) => {
          const live = () => {
            const now = ports.policy.now();
            if (!Number.isFinite(now) || now >= grant.expiresAt) throw new Error('completion_expired');
          };
          await current(); live();
          const receipt = await rpc.inspect(grant);
          if (!object(receipt) || Object.keys(receipt).length !== 6 || receipt.userId !== grant.userId
            || receipt.requestId !== grant.requestId || receipt.executionId !== grant.executionId
            || receipt.scopeDigest !== grant.scopeDigest || receipt.key !== 'authority' || receipt.phase !== 'processing') {
            throw new Error('completion_authority_unverified');
          }
          await current(); live();
        };
        const result = structuredClone(await ports.authenticate(request, binding.url));
        await current();
        if (!object(result) || result.error !== null || !object(result.data) || !object(result.data.user)
          || !uuid(result.data.user.id) || typeof result.data.user.email_confirmed_at !== 'string'
          || !result.data.user.email_confirmed_at) return { outcome: 'unauthorized' };
        return await completePendingAccount({ userId: result.data.user.id, requestId: body.requestId }, rpc);
      } catch { return { outcome: 'unavailable' }; }
    },
  };
}
