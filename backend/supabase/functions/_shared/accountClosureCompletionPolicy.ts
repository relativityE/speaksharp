import type { CompletionGrant, CompletionPorts } from './accountClosureCompletion.ts';
import type { CompletionBinding } from './accountClosureCompletionAdapter.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@16';

type Policy = ReturnType<CompletionPorts['policy']>;
type Subscription = { id: string; status: string; customerId: string };
/** Explicit same-target server adapters; no SDK, credentials or successful defaults. */
export interface CompletionPolicyPorts {
  now(): number;
  verifyCheckouts(grant: Readonly<CompletionGrant>): Promise<boolean>;
  customer(id: string): Promise<{ id: string; deleted?: boolean }>;
  subscriptions(id: string, cursor: string | null): Promise<{ data: Subscription[]; hasMore: boolean }>;
  cancelSubscription(id: string, options: { invoice_now: false; prorate: false; idempotencyKey: string }): Promise<Subscription>;
  /** Must use completion-grant authority, never the legacy drain/token wrapper. */
  settleBilling(grant: Readonly<CompletionGrant>, subscriptions: { id: string; status: string }[]): Promise<void>;
  deleteCustomer(id: string): Promise<{ id: string; deleted: boolean }>;
  preserveTrialEmail(grant: Readonly<CompletionGrant>): Promise<void>;
  listStorage(grant: Readonly<CompletionGrant>): Promise<{ bucket: string; name: string }[]>;
  removeStorageObject(bucket: string, name: string): Promise<void>;
  deleteAuthUser(grant: Readonly<CompletionGrant>): Promise<{ userId: string; deleted: boolean | null }>;
}
const methods = ['now', 'verifyCheckouts', 'customer', 'subscriptions', 'cancelSubscription', 'settleBilling',
  'deleteCustomer', 'preserveTrialEmail', 'listStorage', 'removeStorageObject', 'deleteAuthUser'] as const;
export function assertCompletionPolicyPorts(value: CompletionPolicyPorts): void {
  if (!value || methods.some(key => typeof value[key] !== 'function')) throw new Error('completion_policy_unavailable');
}
const terminal = (status: string) => status === 'canceled' || status === 'incomplete_expired';
const stop = (): never => { throw new Error('completion_policy_unverified'); };

/** New-grant policy composition only. Its caller still owns durable stage dispatch and terminal SQL. */
export function createAccountCompletionPolicy(input: Readonly<CompletionGrant>, ports: CompletionPolicyPorts,
  authority: () => Promise<void>): Policy {
  assertCompletionPolicyPorts(ports);
  const grant = structuredClone(input);
  Object.freeze(grant.proof); Object.freeze(grant.settled); Object.freeze(grant);
  const known = new Set<string>();
  const user = (id: string) => { if (id !== grant.userId || id !== grant.proof.userId) stop(); };
  const customer = (id: string | null) => { if (id !== grant.proof.customerId) stop(); };
  const consume = async <T>(operation: () => Promise<T>): Promise<T> => {
    await authority();
    const now = ports.now();
    if (!Number.isFinite(now) || now >= grant.expiresAt) stop();
    // Do not await between the final local deadline check and the adapter call.
    return operation();
  };
  return {
    now: () => ports.now(),
    verifyCheckouts: async (id, customerId) => {
      user(id); customer(customerId);
      // A free/null-customer account can still have a legacy unknown checkout.
      return await ports.verifyCheckouts(grant) === true;
    },
    listSubscriptions: async id => {
      customer(id);
      const found = structuredClone(await ports.customer(id));
      if (found.id !== id) return stop();
      if (found.deleted === true) return { subscriptions: [], complete: true };
      const subscriptions: { id: string; status: string }[] = [], seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const result: { data: Subscription[]; hasMore: boolean } = structuredClone(await ports.subscriptions(id, cursor));
        if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.hasMore !== 'boolean') return stop();
        for (const sub of result.data) {
          if (!sub || typeof sub.id !== 'string' || !sub.id || typeof sub.status !== 'string' || !sub.status
            || sub.customerId !== id || seen.has(sub.id)) return stop();
          seen.add(sub.id); known.add(sub.id); subscriptions.push({ id: sub.id, status: sub.status });
        }
        if (!result.hasMore) return { subscriptions, complete: true };
        const next: string | undefined = result.data.at(-1)?.id;
        if (!next || next === cursor) return stop();
        cursor = next;
      }
      return { subscriptions, complete: false };
    },
    cancelSubscription: async (id, options) => {
      if (!known.has(id) || options.invoice_now !== false || options.prorate !== false
        || options.idempotencyKey !== `account-closure:${grant.requestId}:${id}`) stop();
      const result = structuredClone(await consume(() => ports.cancelSubscription(id, { ...options })));
      if (result.id !== id || result.customerId !== grant.proof.customerId || !terminal(result.status)) stop();
    },
    settleBilling: async (id, subscriptions) => {
      user(id);
      const snapshot = structuredClone(subscriptions);
      if (!grant.proof.customerId || snapshot.some(sub => !known.has(sub.id) || !terminal(sub.status))) stop();
      await consume(() => ports.settleBilling(grant, snapshot));
    },
    deleteCustomer: async id => {
      customer(id);
      const before = structuredClone(await ports.customer(id));
      if (before.id !== id) return stop();
      if (before.deleted === true) return { deleted: true };
      // Customer lookup is awaited: revalidate AFTER it, directly before DELETE.
      const result = structuredClone(await consume(() => ports.deleteCustomer(id)));
      return { deleted: result.id === id && result.deleted === true };
    },
    preserveTrialEmail: async (id, email) => {
      user(id); if (email !== grant.proof.email) stop();
      await consume(() => ports.preserveTrialEmail(grant));
    },
    removeOwnedStorage: async id => {
      user(id);
      const objects = structuredClone(await ports.listStorage(grant));
      if (!Array.isArray(objects) || objects.length > 2000 || objects.some(row => !row
        || typeof row.bucket !== 'string' || !row.bucket || typeof row.name !== 'string' || !row.name)) stop();
      const seen = new Set<string>();
      for (const row of objects) {
        const key = JSON.stringify([row.bucket, row.name]);
        if (seen.has(key)) stop();
        seen.add(key);
        await consume(() => ports.removeStorageObject(row.bucket, row.name));
      }
      const remaining = await ports.listStorage(grant);
      if (!Array.isArray(remaining) || remaining.length !== 0) stop();
    },
    deleteAuthUser: async id => {
      user(id);
      const result = structuredClone(await consume(() => ports.deleteAuthUser(grant)));
      return { deleted: result.userId === grant.userId && result.deleted === true ? true : null };
    },
  };
}

/** Real same-target SDK adapters. Missing configuration/schema/provider evidence fails, never defaults to success. */
export function createServerCompletionPolicyPorts(binding: CompletionBinding, admin: SupabaseClient,
  stripe: Stripe | null): CompletionPolicyPorts {
  // All accounts require checkout reconciliation, even without a customer ID.
  // Refuse before a controller can consume a grant when this adapter is absent.
  if (!stripe) throw new Error('completion_provider_unavailable');
  const provider = () => { if (!stripe) throw new Error('completion_provider_unavailable'); return stripe; };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args);
    if (error !== null) throw new Error('completion_storage_unavailable');
    return data as unknown;
  };
  const grantArgs = (g: Readonly<CompletionGrant>) => {
    if (g.scopeDigest !== binding.scopeDigest) stop();
    return { p_user_id: g.userId, p_request_id: g.requestId, p_execution_id: g.executionId, p_scope_digest: g.scopeDigest };
  };
  return {
    now: () => Date.now(),
    verifyCheckouts: async grant => {
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await provider().checkout.sessions.list({ limit: 100, starting_after: cursor });
        for (const session of result.data) {
          if (session.client_reference_id !== grant.userId && session.metadata?.userId !== grant.userId) continue;
          if ([session.client_reference_id, session.metadata?.userId].some(id => id && id !== grant.userId)) return false;
          const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
          if (session.status !== 'expired' && (session.status !== 'complete' || !customer || customer !== grant.proof.customerId)) return false;
        }
        if (!result.has_more) return true;
        const next = result.data.at(-1)?.id;
        if (!next || next === cursor) return false;
        cursor = next;
      }
      return false;
    },
    customer: async id => {
      const result = await provider().customers.retrieve(id);
      return { id: result.id, deleted: result.deleted === true };
    },
    subscriptions: async (id, cursor) => {
      const page = await provider().subscriptions.list({ customer: id, status: 'all', limit: 100, starting_after: cursor ?? undefined });
      return { data: page.data.map(sub => ({ id: sub.id, status: sub.status,
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id })), hasMore: page.has_more };
    },
    cancelSubscription: async (id, options) => {
      const sub = await provider().subscriptions.cancel(id, { invoice_now: options.invoice_now, prorate: options.prorate },
        { idempotencyKey: options.idempotencyKey });
      return { id: sub.id, status: sub.status, customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id };
    },
    settleBilling: async (grant, subscriptions) => {
      // This new-grant SQL surface is a separate source/schema prerequisite.
      // Its absence/error is a refusal, never permission to use the revoked legacy RPC.
      if (await rpc('settle_account_completion_billing_v1', { ...grantArgs(grant), p_subscriptions: subscriptions }) !== true) stop();
    },
    deleteCustomer: async id => {
      const result = await provider().customers.del(id);
      return { id: result.id, deleted: result.deleted === true };
    },
    preserveTrialEmail: async grant => {
      if (await rpc('preserve_account_trial_email', { p_user_id: grant.userId }) !== null) stop();
    },
    listStorage: async grant => {
      const rows = await rpc('list_account_closure_storage', { p_user_id: grant.userId });
      if (!Array.isArray(rows) || rows.length > 2000 || rows.some(row => !row || typeof row.bucket_id !== 'string'
        || !row.bucket_id || typeof row.name !== 'string' || !row.name)) return stop();
      return rows.map(row => ({ bucket: row.bucket_id, name: row.name }));
    },
    removeStorageObject: async (bucket, name) => {
      const { error } = await admin.storage.from(bucket).remove([name]);
      if (error !== null) stop();
    },
    deleteAuthUser: async grant => {
      // The completion controller has already durably started delete_auth.
      // No retry; a lost request/reply stays unknown and retains its intent.
      const { error } = await admin.auth.admin.deleteUser(grant.userId, false);
      if (error !== null) return { userId: grant.userId, deleted: null };
      const after = await admin.auth.admin.getUserById(grant.userId);
      return { userId: grant.userId, deleted: after.data?.user === null && after.error?.status === 404
        && after.error.code === 'user_not_found' ? true : null };
    },
  };
}
