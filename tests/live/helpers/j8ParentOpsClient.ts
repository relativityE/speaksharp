/**
 * J8 browser spec → parent operations (scripts/rwt-j8-parent-ops.mts). In the J8 runner the spec holds NO service-role key: every
 * production read or write it needs goes through the parent's four named, account-bound operations over loopback. These proxies
 * keep the shapes the existing helpers already take (FenceRpcClient, the chain row's ReportReader), so the helpers are unchanged.
 * A parent refusal becomes an error (code `parent_refused`), so every caller's existing fail-closed path applies.
 */
import type { FenceRpcClient } from './feedbackFence';

type OpReply = { data?: unknown; error?: { code?: string | null } | null; refused?: string; failures?: number; claimed?: boolean };
export interface J8ParentOps { call(op: string, args: Record<string, unknown>): Promise<OpReply> }

/** The parent-operations client of this run, or null outside the J8 runner. Only a loopback address is accepted. */
export function j8ParentOpsFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): J8ParentOps | null {
    const url = env.RWT_J8_OPS_URL; const token = env.RWT_J8_OPS_TOKEN;
    if (!url || !token) return null;
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/op' || !/^[a-f0-9]{64}$/.test(token)) {
        throw new Error('J8 parent operations: only the loopback /op address with a run token is accepted');
    }
    return {
        async call(op, args) {
            const res = await fetchImpl(parsed.href, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ op, args }) });
            const body = await res.json().catch(() => null) as OpReply | null;
            if (!body) return { refused: 'unreadable_reply' };
            return body;
        },
    };
}

const asResult = (r: OpReply) => r.refused
    ? { data: null, error: { code: 'parent_refused', message: r.refused } }
    : { data: r.data ?? null, error: r.error ? { code: r.error.code ?? undefined } : null };

/** The run-owned identity check and canary claim, done by the parent for the admitted account. */
export async function parentIdentityAndClaim(ops: J8ParentOps, uid: string): Promise<{ failures: string[]; claimed: boolean }> {
    const r = await ops.call('identity_and_claim', { uid });
    if (r.refused) return { failures: [`parent refused the account (${r.refused})`], claimed: false };
    return { failures: (r.failures ?? 0) > 0 ? ['run-owned identity check failed in the parent'] : [], claimed: r.claimed === true };
}

/** The feedback fence's RPC client, served by the parent (only the four fence RPCs, only for this account and run). */
export function parentFenceClient(ops: J8ParentOps): FenceRpcClient {
    return { rpc: async (fn, args) => asResult(await ops.call('fence', { fn, args })) };
}

/** The chain row's report reader: `from('user_issue_reports').select(..).eq('id', reportId).eq('user_id', uid)`, served by id. */
export function parentReportReader(ops: J8ParentOps) {
    return {
        from(table: string) {
            return { select(columns: string) {
                void columns; // the parent's operation fixes the columns; the caller's choice is not forwarded
                return { eq(c1: string, v1: string) {
                    return { eq(c2: string, v2: string) {
                        void v2; // the parent's operation filters to its own bound account; the caller's id is not forwarded
                        if (table !== 'user_issue_reports' || c1 !== 'id' || c2 !== 'user_id') {
                            return Promise.resolve({ data: null, error: { code: 'parent_refused' } });
                        }
                        // The parent filters to its bound account itself; the caller's user id is never trusted.
                        return ops.call('issue_reports', { by: 'id', value: v1 }).then((r) => asResult(r) as { data: Array<Record<string, unknown>> | null; error: { code?: string } | null });
                    } };
                } };
            } };
        },
    };
}

/** user_issue_reports rows of the bound account by idempotency key(s). */
export async function parentReportsByKeys(ops: J8ParentOps, keys: readonly string[]) {
    return asResult(await ops.call('issue_reports', keys.length === 1 ? { by: 'key', value: keys[0] } : { by: 'keys', value: [...keys] }));
}

/** sessions rows (the take projection) of the bound account. */
export async function parentTakeRows(ops: J8ParentOps, ids: readonly string[]) {
    return asResult(await ops.call('take_digests', { ids: [...ids] }));
}
