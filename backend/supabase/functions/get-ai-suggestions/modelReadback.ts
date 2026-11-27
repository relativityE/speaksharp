import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import contract from './contract.json' with { type: 'json' };
import { COACHING_MODEL_SELECTION_FIELDS, coachingServingModel } from './modelReadinessStore.ts';

export function authorizeModelReadback(req: Request, serviceRole: string | undefined, header = 'Authorization'): boolean {
  if (req.method !== 'POST' || req.headers.has('Origin') || !serviceRole) return false;
  const enc = new TextEncoder();
  const actual = enc.encode(req.headers.get(header) ?? '');
  const expected = enc.encode(header === 'Authorization' ? 'Bearer ' + serviceRole : serviceRole);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}
export async function activeCoachingModelReadback(client: () => SupabaseClient, enabled: boolean, signal: AbortSignal) {
  const bootstrap = { model: contract.model, revision: null, readiness: 'not_checked',
    serving: 'configured', source: 'bootstrap', bootstrapModel: contract.model, providerVersion: null,
    lastCheckAt: null, nextUserCheckAt: null, providerCheckAfter: null, lastCheckOutcome: null };
  if (!enabled) return bootstrap;
  const fields = `${COACHING_MODEL_SELECTION_FIELDS},last_check_at,user_next_check_at,provider_check_after,last_check_outcome` as const;
  const { data, error } = await client().from('coaching_model_selection').select(fields)
    .eq('single', true).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(700)])).maybeSingle();
  if (error || signal.aborted) return null;
  if (!data) return bootstrap;
  const selection = coachingServingModel(data);
  if (selection.kind === 'unavailable') return null;
  const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
  const checking = typeof data.probe_deadline === 'string' && Date.parse(data.probe_deadline) > Date.now();
  return {
    model: selection.kind === 'ready' ? selection.model : contract.model,
    revision: Number.isSafeInteger(data.revision) ? data.revision : null,
    serving: 'configured', source: 'selection', bootstrapModel: contract.model,
    readiness: checking ? 'checking' : data.verified ? 'verified' : data.checked ? 'unavailable' : 'not_checked',
    providerVersion: data.verified && selection.kind === 'ready' ? selection.model : null,
    lastCheckAt: date(data.last_check_at), nextUserCheckAt: date(data.user_next_check_at),
    providerCheckAfter: date(data.provider_check_after), lastCheckOutcome: data.last_check_outcome ?? null,
  };
}
