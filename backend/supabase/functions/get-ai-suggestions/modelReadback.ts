import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import contract from './contract.json' with { type: 'json' };
import { COACHING_MODEL_SELECTION_FIELDS, coachingServingDecision, geminiReadinessModel } from './modelReadinessStore.ts';

export function authorizeModelReadback(req: Request, serviceRole: string | undefined): boolean {
  if (req.method !== 'POST' || req.headers.has('Origin') || !serviceRole) return false;
  const enc = new TextEncoder();
  const actual = enc.encode(req.headers.get('Authorization') ?? '');
  const expected = enc.encode('Bearer ' + serviceRole);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}
export async function activeCoachingModelReadback(client: () => SupabaseClient, enabled: boolean, signal: AbortSignal) {
  if (!enabled) return { model: contract.model, revision: null, readiness: 'not_checked' };
  const { data, error } = await client().from('coaching_model_selection').select(COACHING_MODEL_SELECTION_FIELDS)
    .eq('single', true).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(700)])).maybeSingle();
  if (error) return null;
  if (!data) return { model: contract.model, revision: null, readiness: 'not_checked' };
  if (!geminiReadinessModel(data.model)) return null;
  const decision = coachingServingDecision(data, Date.now());
  return {
    model: data.model, revision: Number.isSafeInteger(data.revision) ? data.revision : null,
    readiness: decision.kind === 'ready' ? 'verified' : decision.kind === 'pending' ? 'checking'
      : decision.kind === 'unprobed' ? 'not_checked' : decision.kind,
  };
}
