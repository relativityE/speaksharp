import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ReadinessModel, ClaimResult, ReadinessStore } from './modelReadiness.ts';
import contract from './contract.json' with { type: 'json' };
import { parseProviderDescriptor, PROVIDER_CATALOG } from './providers/catalog.ts';
import { createGeminiAdapter } from './providers/gemini.ts';

// Numbered Gemini text models from 3.4 up. Ignore moving aliases,
// previews and specialist models; the real coaching probe supplies the capability check.
const GEMINI_TEXT = /^gemini-(\d{1,3})(?:\.(\d{1,3}))?-(pro|flash|flash-lite)(?:-(\d{3}))?$/;
const descriptor = PROVIDER_CATALOG.find((p) => p.id === 'google_gemini');
const CATALOG_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function rank(id: string): number[] | null {
  const match = GEMINI_TEXT.exec(id);
  if (!match) return null;
  const [, major, minor = '0', tier, revision = '0'] = match;
  if (+major < 3 || (+major === 3 && +minor < 4)) return null;
  return [+major, +minor, tier === 'pro' ? 2 : tier === 'flash' ? 1 : 0, +revision];
}

export function geminiReadinessModel(id: unknown): ReadinessModel | null {
  return typeof id === 'string' && (id === contract.model || rank(id))
    ? { id, observedVersions: [id] } : null;
}

export function readinessProvider(id: string) {
  if (!descriptor || !geminiReadinessModel(id)) return null;
  return createGeminiAdapter(parseProviderDescriptor({ ...descriptor, model: id }));
}

async function catalogPage(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return JSON.parse(text + decoder.decode());
      bytes += chunk.value.byteLength;
      if (bytes > 262_144) return null;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function discoverGeminiReadinessModels(
  apiKey: string, signal: AbortSignal, fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ReadinessModel[]> {
  const models = new Map<string, number[]>();
  const tokens = new Set<string>();
  let token: string | undefined;
  try {
    for (let i = 0; i < 4 && !signal.aborted; i++) {
      const url = new URL(CATALOG_ENDPOINT);
      url.searchParams.set('pageSize', '100');
      if (token) url.searchParams.set('pageToken', token);
      const response = await fetchImpl(url, { method: 'GET', headers: { 'x-goog-api-key': apiKey }, redirect: 'error', signal });
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        return [];
      }
      const page = await catalogPage(response);
      if (!Array.isArray(page?.models) || page.models.length > 100) return [];
      for (const item of page.models) {
        const id = typeof item?.name === 'string' && item.name.startsWith('models/') ? item.name.slice(7) : '';
        const order = rank(id);
        if (order && Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent')) {
          models.set(id, order);
        }
      }
      const next: unknown = page.nextPageToken;
      if (next === undefined || next === '') {
        return [...models.entries()].sort(([a, x], [b, y]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || y[3] - x[3] || a.localeCompare(b))
          .map(([id]) => ({ id, observedVersions: [id] }));
      }
      if (typeof next !== 'string' || next.length > 2048 || tokens.has(next)) return [];
      tokens.add(next);
      token = next;
    }
  } catch { /* Unavailable or incomplete catalog cannot select a model. */ }
  return [];
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
