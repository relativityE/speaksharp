import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@16';
import { corsGuard, corsHeaders } from '../_shared/cors.ts';
import { handleClosureRequest, type ClosureRequestDependencies } from '../_shared/accountClosureRequest.ts';
import type { ClosureDependencies, ClosureProof } from '../_shared/accountClosure.ts';

type Env = (key: string) => string | undefined;

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildDependencies(env: Env, admin: SupabaseClient, auth: SupabaseClient, stripe: Stripe | null): ClosureRequestDependencies {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error('closure_storage_unavailable');
    return data as unknown;
  };
  const useStripe = () => { if (!stripe) throw new Error('billing_unavailable'); return stripe; };
  return {
    siteUrl: env('SITE_URL') ?? '', randomToken, hashToken,
    authenticate: async () => {
      const { data, error } = await auth.auth.getUser();
      return !error && data.user?.email && data.user.email_confirmed_at
        ? { id: data.user.id, email: data.user.email } : null;
    },
    issue: async (userId, hash) => {
      const rows = await rpc('issue_account_closure_token', { p_user_id: userId, p_token_hash: hash });
      return Array.isArray(rows) && rows.length === 1;
    },
    revoke: async (userId, hash) => { await rpc('revoke_account_closure_token', { p_user_id: userId, p_token_hash: hash }); },
    sendLink: async (email, redirect) => {
      // Supabase owns the single-use magic link and its configured SMTP transport. Never a no-op sender.
      const { error } = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirect } });
      if (error) throw new Error('verification_delivery_failed');
    },
    finish: async (userId, requestId) => {
      await rpc('finish_account_closure_attempt', { p_user_id: userId, p_request_id: requestId });
    },
    closure: () => {
      let proof: ClosureProof | null = null;
      const adapters: ClosureDependencies = {
        now: () => Date.now(),
        consumeProof: async (userId, token) => {
          const rows = await rpc('claim_account_closure_token', { p_user_id: userId, p_token_hash: await hashToken(token) });
          if (!Array.isArray(rows) || rows.length !== 1) return null;
          const row = rows[0] as Record<string, unknown>;
          if (typeof row.user_id !== 'string' || typeof row.email !== 'string' || typeof row.request_id !== 'string'
            || (row.customer_id !== null && typeof row.customer_id !== 'string') || typeof row.expires_at !== 'string') {
            throw new Error('closure_proof_malformed');
          }
          proof = { userId: row.user_id, email: row.email, customerId: row.customer_id,
            requestId: row.request_id, expiresAt: Date.parse(row.expires_at) };
          return proof;
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
          await useStripe().subscriptions.cancel(id, { invoice_now: options.invoice_now, prorate: options.prorate },
            { idempotencyKey: options.idempotencyKey });
        },
        settleBilling: async (userId, subscriptions) => {
          if (!proof?.customerId) throw new Error('billing_proof_missing');
          await rpc('settle_account_closure_billing', { p_user_id: userId, p_request_id: proof.requestId,
            p_customer_id: proof.customerId, p_subscriptions: subscriptions });
        },
        deleteCustomer: async (customerId) => {
          const client = useStripe();
          const before = await client.customers.retrieve(customerId);
          if (before.id !== customerId) throw new Error('customer_identity_mismatch');
          const deleted = before.deleted === true ? before : await client.customers.del(customerId);
          return { deleted: deleted.id === customerId && deleted.deleted === true };
        },
        preserveTrialEmail: async (userId) => { await rpc('preserve_account_trial_email', { p_user_id: userId }); },
        removeOwnedStorage: async (userId) => {
          const read = async () => {
            const rows = await rpc('list_account_closure_storage', { p_user_id: userId });
            if (!Array.isArray(rows)) throw new Error('storage_readback_missing');
            return rows as { bucket_id: string; name: string }[];
          };
          for (const row of await read()) {
            if (!row.bucket_id || !row.name) throw new Error('storage_identity_missing');
            const { error } = await admin.storage.from(row.bucket_id).remove([row.name]);
            if (error) throw new Error('storage_removal_failed');
          }
          if ((await read()).length !== 0) throw new Error('storage_residue');
        },
        deleteAuthUser: async (userId) => {
          const { error } = await admin.auth.admin.deleteUser(userId, false);
          if (error) return { deleted: false };
          const read = await admin.auth.admin.getUserById(userId);
          return { deleted: read.error?.status === 404 && read.error.code === 'user_not_found' };
        },
        verifyResidue: async (userId) => ({ clean: await rpc('verify_account_closure_residue', {
          p_user_id: userId, p_email: proof?.email ?? '',
        }) === true }),
      };
      return adapters;
    },
  };
}

export async function handler(req: Request, env: Env = (key) => Deno.env.get(key)): Promise<Response> {
  const rejected = corsGuard(req);
  if (rejected) return rejected;
  const headers = corsHeaders(req);
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  const secret = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret || !env('SITE_URL')) {
    return new Response(JSON.stringify({ error: 'account_closure_unavailable' }), { status: 503, headers });
  }
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401, headers });
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, secret, options);
  const auth = createClient(url, anon, { ...options, global: { headers: { Authorization: authorization } } });
  const stripeKey = env('STRIPE_SECRET_KEY');
  const stripe = stripeKey ? new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient(), timeout: 10_000, maxNetworkRetries: 0 }) : null;
  const response = await handleClosureRequest(req, buildDependencies(env, admin, auth, stripe));
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

if (import.meta.main) serve((req) => handler(req));
