import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@16';
import { corsGuard, corsHeaders } from '../_shared/cors.ts';
import { handleClosureRequest, type ClosureRequestDependencies } from '../_shared/accountClosureRequest.ts';
import type { ClosureDependencies, ClosureProof } from '../_shared/accountClosure.ts';
import { readAccountClosureRuntimeBinding } from '../_shared/accountClosureRuntimeBinding.ts';
import { createAccountClosureRecoveryAdapter } from '../_shared/accountClosureRecoveryAdapter.ts';
import { recoverAccountClosure } from '../_shared/accountClosureRecovery.ts';
import { accountClosureConfigProbe, readAccountClosureEffectiveConfig, stripeKeyMode } from '../_shared/accountClosureConfigProbe.ts';

type Env = (key: string) => string | undefined;

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildDependencies(env: Env, admin: SupabaseClient, auth: SupabaseClient, stripe: Stripe | null,
  initialBinding = readAccountClosureRuntimeBinding(env)): ClosureRequestDependencies {
  // One invocation, one backend target, one pinned grant. Never refresh a grant
  // or adopt a new deployment after a provider operation may have started.
  const binding = initialBinding;
  let activeProof: ClosureProof | null = null;
  let irreversibleAttempted = false;
  let authActionEntered = false;
  const currentBinding = () => {
    const next = readAccountClosureRuntimeBinding(env);
    if (binding && JSON.stringify(next) !== JSON.stringify(binding)) throw new Error('closure_runtime_context_changed');
    return next;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error('closure_storage_unavailable');
    return data as unknown;
  };
  const useStripe = () => { if (!stripe) throw new Error('billing_unavailable'); return stripe; };
  const drainRpc = async (name: string, args: Record<string, unknown>) => {
    const { scope } = currentBinding();
    const result = await rpc(name, { ...args, p_attestation_id: scope.attestationId, p_generation: scope.generation,
      p_binding_digest: scope.bindingDigest, p_context: scope.context });
    currentBinding();
    return result;
  };
  const drainVoid = async (name: string, args: Record<string, unknown>) => {
    if (await drainRpc(name, args) !== null) throw new Error('closure_mutation_unverified');
  };
  const assertAuthority = async (phases = ['processing']) => {
    if (!activeProof) throw new Error('closure_proof_missing');
    const { scope } = currentBinding();
    const data = await drainRpc('inspect_account_closure_authority', {
      p_user_id: activeProof.userId, p_request_id: activeProof.requestId,
    }) as { attempt?: Record<string, unknown>; authority?: Record<string, unknown> } | null;
    const a = data?.authority;
    if (!a || data?.attempt?.userId !== activeProof.userId || data.attempt.requestId !== activeProof.requestId
      || data.attempt.email !== activeProof.email || !phases.includes(String(data.attempt.phase))
      || a.userId !== activeProof.userId || a.requestId !== activeProof.requestId
      || a.generation !== scope.generation || a.bindingDigest !== scope.bindingDigest
      || typeof a.validFrom !== 'number' || typeof a.expiresAt !== 'number'
      || !Number.isFinite(a.validFrom) || !Number.isFinite(a.expiresAt)
      || a.validFrom > Date.now() || a.expiresAt <= Date.now() || a.expiresAt <= a.validFrom
      || a.expiresAt - a.validFrom > 900_000) throw new Error('closure_authority_unverified');
  };
  const consuming = async <T>(operation: () => Promise<T>): Promise<T> => {
    await assertAuthority();
    irreversibleAttempted = true;
    const result = await operation();
    await assertAuthority();
    return result;
  };
  const recovery = async () => {
    if (!activeProof) throw new Error('closure_proof_missing');
    const { target } = currentBinding();
    const adapters = createAccountClosureRecoveryAdapter(target, {
      createAdminClient: (url) => {
        if (url !== currentBinding().target.url) throw new Error('closure_target_changed');
        return admin;
      },
      getCurrentScope: async () => currentBinding().scope,
    }).forRequest({ userId: activeProof.userId, requestId: activeProof.requestId });
    return await recoverAccountClosure({ userId: activeProof.userId, requestId: activeProof.requestId }, adapters);
  };
  return {
    siteUrl: env('SITE_URL') ?? '', randomToken, hashToken,
    authenticate: async () => {
      currentBinding();
      const { data, error } = await auth.auth.getUser();
      return !error && data.user?.email && data.user.email_confirmed_at
        ? { id: data.user.id, email: data.user.email } : null;
    },
    issue: async (userId, hash) => {
      currentBinding();
      const rows = await drainRpc('issue_account_closure_token_with_drain', { p_user_id: userId, p_token_hash: hash });
      return Array.isArray(rows) && rows.length === 1;
    },
    revoke: async (userId, hash) => { await rpc('revoke_account_closure_token', { p_user_id: userId, p_token_hash: hash }); },
    sendLink: async (email, redirect) => {
      // Supabase owns the single-use magic link and its configured SMTP transport. Never a no-op sender.
      const { error } = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirect } });
      if (error) throw new Error('verification_delivery_failed');
    },
    finish: async (userId, requestId) => {
      // Unknown provider/storage outcomes retain their fence for independent
      // reconciliation. A generic catch must never reopen checkout behind them.
      if (irreversibleAttempted) return;
      if (activeProof?.userId !== userId || activeProof.requestId !== requestId) throw new Error('closure_proof_missing');
      await assertAuthority();
      await rpc('finish_account_closure_attempt', { p_user_id: userId, p_request_id: requestId });
    },
    closure: () => {
      let proof: ClosureProof | null = null;
      const adapters: ClosureDependencies = {
        now: () => Date.now(),
        consumeProof: async (userId, token) => {
          if (activeProof) throw new Error('closure_request_already_bound');
          currentBinding();
          const hash=await hashToken(token);
          const pending=await rpc('inspect_account_closure_checkouts',{p_user_id:userId,p_token_hash:hash});
          if (!Array.isArray(pending)) throw new Error('checkout_readback_missing');
          for (const operation of pending as {operation_id:string;session_id:string|null}[]) {
            // An interrupted issuance without a known Stripe session cannot be
            // retried or dismissed. It needs independent provider reconciliation.
            if (!operation.operation_id || !operation.session_id) return null;
            const session=await useStripe().checkout.sessions.retrieve(operation.session_id);
            if (session.id!==operation.session_id || session.client_reference_id!==userId
              || session.metadata?.userId!==userId) throw new Error('checkout_identity_mismatch');
            if (session.status==='expired') {
              await drainVoid('reconcile_account_closure_checkout_with_drain',{p_user_id:userId,p_token_hash:hash,
                p_operation_id:operation.operation_id,p_session_id:operation.session_id,p_customer_id:null,p_subscription_id:null});
            } else if (session.status==='complete') {
              const customer=typeof session.customer==='string'?session.customer:session.customer?.id;
              const subscription=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
              if (!customer || !subscription) return null;
              await drainVoid('reconcile_account_closure_checkout_with_drain',{p_user_id:userId,p_token_hash:hash,p_session_id:session.id,
                p_customer_id:customer,p_subscription_id:subscription,p_operation_id:operation.operation_id});
            } else return null;
          }
          const rows = await drainRpc('claim_account_closure_token_with_drain', { p_user_id: userId, p_token_hash: hash });
          if (!Array.isArray(rows) || rows.length !== 1) return null;
          const row = rows[0] as Record<string, unknown>;
          if (typeof row.user_id !== 'string' || typeof row.email !== 'string' || typeof row.request_id !== 'string'
            || (row.customer_id !== null && typeof row.customer_id !== 'string') || typeof row.expires_at !== 'string') {
            throw new Error('closure_proof_malformed');
          }
          proof = { userId: row.user_id, email: row.email, customerId: row.customer_id,
            requestId: row.request_id, expiresAt: Date.parse(row.expires_at) };
          if (proof.userId !== userId || !Number.isFinite(proof.expiresAt) || proof.expiresAt <= Date.now()) {
            throw new Error('closure_proof_malformed');
          }
          activeProof = Object.freeze({ ...proof });
          await assertAuthority();
          return { ...proof };
        },
        verifyCheckouts: async (userId,customerId) => {
          // No customer-null shortcut: legacy checkout creates the customer at completion.
          // This runs after the DB fence and only after old unfenced workers are drained.
          let cursor: string | undefined;
          for (let page=0;page<20;page++) {
            const sessions=await useStripe().checkout.sessions.list({limit:100,starting_after:cursor});
            for (const session of sessions.data) {
              if (session.client_reference_id!==userId && session.metadata?.userId!==userId) continue;
              const owner=typeof session.customer==='string'?session.customer:session.customer?.id;
              if (session.status==='expired') continue;
              if (session.status!=='complete' || !owner || owner!==customerId) return false;
            }
            if (!sessions.has_more) return true;
            const next=sessions.data.at(-1)?.id;
            if (!next || next===cursor) return false;
            cursor=next;
          }
          return false;
        },
        listSubscriptions: async (customerId) => {
          const client = useStripe();
          const customer = await client.customers.retrieve(customerId);
          if (customer.id !== customerId) throw new Error('customer_identity_mismatch');
          if (customer.deleted === true) return { complete: true, subscriptions: [] };
          const subscriptions: { id: string; status: string }[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 20; page++) {
            const result = await client.subscriptions.list({ customer: customerId, status: 'all', limit: 100, starting_after: cursor });
            for (const sub of result.data) {
              const owner = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
              if (owner !== customerId) throw new Error('subscription_identity_mismatch');
              subscriptions.push({ id: sub.id, status: sub.status });
            }
            if (!result.has_more) return { complete: true, subscriptions };
            const next = result.data.at(-1)?.id;
            if (!next || next === cursor) throw new Error('subscription_pagination_stalled');
            cursor = next;
          }
          return { complete: false, subscriptions };
        },
        cancelSubscription: async (id, options) => {
          await consuming(async () => { await useStripe().subscriptions.cancel(id, { invoice_now: options.invoice_now, prorate: options.prorate },
            { idempotencyKey: options.idempotencyKey }); });
        },
        settleBilling: async (userId, subscriptions) => {
          if (!proof?.customerId || proof.userId !== userId) throw new Error('billing_proof_missing');
          await assertAuthority();
          await drainVoid('settle_account_closure_billing_with_drain', { p_user_id: userId, p_request_id: proof.requestId,
            p_customer_id: proof.customerId, p_subscriptions: subscriptions });
          await assertAuthority();
        },
        deleteCustomer: async (customerId) => {
          if (!proof || proof.customerId !== customerId) throw new Error('billing_proof_missing');
          await assertAuthority();
          const client = useStripe();
          const before = await client.customers.retrieve(customerId);
          if (before.id !== customerId) throw new Error('customer_identity_mismatch');
          const deleted = before.deleted === true ? before : await consuming(() => client.customers.del(customerId));
          return { deleted: deleted.id === customerId && deleted.deleted === true };
        },
        preserveTrialEmail: async (userId) => {
          if (proof?.userId !== userId) throw new Error('closure_proof_missing');
          await consuming(async () => {
            if (await rpc('preserve_account_trial_email', { p_user_id: userId }) !== null) throw new Error('trial_retention_unverified');
          });
        },
        removeOwnedStorage: async (userId) => {
          if (proof?.userId !== userId) throw new Error('closure_proof_missing');
          const read = async () => {
            const rows = await rpc('list_account_closure_storage', { p_user_id: userId });
            if (!Array.isArray(rows)) throw new Error('storage_readback_missing');
            return rows as { bucket_id: string; name: string }[];
          };
          for (const row of await read()) {
            if (!row.bucket_id || !row.name) throw new Error('storage_identity_missing');
            const { error } = await consuming(() => admin.storage.from(row.bucket_id).remove([row.name]));
            if (error) throw new Error('storage_removal_failed');
          }
          if ((await read()).length !== 0) throw new Error('storage_residue');
        },
        deleteAuthUser: async (userId) => {
          if (!proof || proof.userId !== userId) throw new Error('closure_proof_missing');
          // This invocation may resume a lost JOURNAL acknowledgment while it
          // still knows no DELETE was sent. It never replays an issued DELETE.
          if (authActionEntered) return { deleted: null };
          authActionEntered = true;
          // Commit the reconciliation hold before the destructive request. This record has
          // no auth FK and survives deletion, process death and lost HTTP responses.
          await assertAuthority();
          const markUnknown = () => drainVoid('record_account_closure_auth_state_with_drain', {
            p_user_id: userId, p_request_id: proof!.requestId, p_state: 'auth_unknown',
          });
          try { await markUnknown(); }
          catch {
            // The authoritative read waits behind any still-running SQL write.
            // A retained same-request hold or untouched processing state may
            // receive ONE bounded acknowledgment retry; no provider retry.
            await assertAuthority(['processing', 'auth_unknown']);
            const before = await admin.auth.admin.getUserById(userId);
            await assertAuthority(['processing', 'auth_unknown']);
            if (before.data?.user === null && before.error?.status === 404 && before.error.code === 'user_not_found') {
              return { deleted: (await recovery()).accountDeleted };
            }
            if (before.error !== null || before.data?.user?.id !== userId) return { deleted: null };
            await markUnknown();
          }
          try {
            await assertAuthority(['auth_unknown']);
            irreversibleAttempted = true;
            const { error } = await admin.auth.admin.deleteUser(userId, false);
            if (error) return { deleted: null };
            const result = await recovery();
            return { deleted: result.accountDeleted };
          } catch { return { deleted: null }; }
        },
        verifyResidue: async (userId) => {
          if (proof?.userId !== userId) throw new Error('closure_proof_missing');
          return { clean: (await recovery()).outcome === 'completed' };
        },
      };
      return adapters;
    },
  };
}

export async function handler(req: Request, env: Env = (key) => Deno.env.get(key)): Promise<Response> {
  const rejected = corsGuard(req);
  if (rejected) return rejected;
  const headers = corsHeaders(req);
  const probe = await accountClosureConfigProbe(req, env, 'account-closure', () =>
    readAccountClosureEffectiveConfig(env, stripeKeyMode(env('STRIPE_SECRET_KEY'))));
  if (probe) {
    for (const [key, value] of Object.entries(headers)) probe.headers.set(key, value);
    return probe;
  }
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  const secret = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret || !env('SITE_URL')) {
    return new Response(JSON.stringify({ error: 'account_closure_unavailable' }), { status: 503, headers });
  }
  let verified: ReturnType<typeof readAccountClosureRuntimeBinding>;
  try { verified = readAccountClosureRuntimeBinding(env); }
  catch {
    return new Response(JSON.stringify({ error: 'account_closure_unavailable' }), { status: 503, headers });
  }
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401, headers });
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(verified.target.url, secret, options);
  const auth = createClient(verified.target.url, anon, { ...options, global: { headers: { Authorization: authorization } } });
  const stripeKey = env('STRIPE_SECRET_KEY');
  const stripe = stripeKey ? new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient(), timeout: 10_000, maxNetworkRetries: 0 }) : null;
  const response = await handleClosureRequest(req, buildDependencies(env, admin, auth, stripe, verified));
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

if (import.meta.main) serve((req) => handler(req));
