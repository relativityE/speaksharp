import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ApprovedModel, ClaimResult, ReadinessStore } from './modelReadiness.ts';
import contract from './contract.json' with { type: 'json' };
import { parseProviderDescriptor, PROVIDER_CATALOG } from './providers/catalog.ts';
import { createGeminiAdapter } from './providers/gemini.ts';

/** Eligibility is reviewed release data, not a second active selection. No unqualified candidate is enabled. */
export const APPROVED_COACHING_MODELS: readonly ApprovedModel[] = [
  { id: contract.model, observedVersions: [contract.model] },
];
const descriptor = PROVIDER_CATALOG.find((p) => p.id === 'google_gemini');
export function providerForApprovedModel(id: string) {
  if (!descriptor || !APPROVED_COACHING_MODELS.some((p) => p.id === id)) return null;
  return createGeminiAdapter(parseProviderDescriptor({ ...descriptor, model: id }));
}

function state(value: unknown): value is { model: string; revision: number } {
  if (!value || typeof value !== 'object') return false;
  const x = value as Record<string, unknown>;
  return typeof x.model === 'string' && Number.isSafeInteger(x.revision) && Number(x.revision) > 0;
}
export function createReadinessStore(client: SupabaseClient): ReadinessStore {
  return {
    async claim() {
      const { data, error } = await client.rpc('claim_coaching_model_probe_v1');
      if (error || !data) throw Error('coaching_model_selection_unavailable');
      if (data.kind === 'claimed' && state(data.lease?.state)
        && typeof data.lease.token === 'string' && Number.isSafeInteger(data.lease.deadlineMs)) return data as ClaimResult;
      if ((data.kind === 'busy' || data.kind === 'cooldown') && state(data.state)) return data as ClaimResult;
      throw Error('coaching_model_selection_unavailable');
    },
    async finish(lease, result) {
      const { data, error } = await client.rpc('finish_coaching_model_probe_v1', {
        p_revision: lease.state.revision,
        p_token: lease.token,
        p_verified: result.verified ?? null,
        p_promote_to: result.promoteTo ?? null,
        p_retry_after_ms: result.retryAfterMs ?? null,
      });
      if (error) throw Error('coaching_model_selection_unavailable');
      return data === true;
    },
  };
}

/** Report exactly the active row for a fresh request. Do not use a stale or configured candidate while a check is pending. */
export type CoachingModelReadiness =
  | { kind: 'ready'; model: string }
  | { kind: 'pending' }
  | { kind: 'unavailable' };

export async function readReadyCoachingModel(client: SupabaseClient, signal: AbortSignal): Promise<CoachingModelReadiness> {
  const deadline = Date.now() + 1500;
  let probeUntil = 0;
  for (;;) {
    const remaining = deadline - Date.now();
    if (signal.aborted) return { kind: 'unavailable' };
    if (remaining <= 0) return { kind: probeUntil > Date.now() ? 'pending' : 'unavailable' };
    const { data, error } = await client.from('coaching_model_selection').select('model,verified,probe_deadline')
      .eq('single', true).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(Math.min(700, remaining))])).maybeSingle();
    if (error || !data || signal.aborted) return { kind: 'unavailable' };
    // Probe-sharing freshness is not a recording duration cap.
    if (data.probe_deadline === null) return data.verified === true && typeof data.model === 'string'
      ? { kind: 'ready', model: data.model } : { kind: 'unavailable' };
    probeUntil = typeof data.probe_deadline === 'string' ? Date.parse(data.probe_deadline) : NaN;
    if (!(probeUntil > Date.now())) return { kind: 'unavailable' };
    await new Promise((resolve) => setTimeout(resolve, Math.min(150, Math.max(0, deadline - Date.now()))));
  }
}
