import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ReadinessModel, ClaimResult, ReadinessStore } from './modelReadiness.ts';
import contract from './contract.json' with { type: 'json' };
import { parseProviderDescriptor, PROVIDER_CATALOG } from './providers/catalog.ts';
import { createGeminiAdapter } from './providers/gemini.ts';

// Gemini text models from 3.5 up. Ignore moving aliases,
// previews and specialist models; the real coaching probe supplies the capability check.
const GEMINI_TEXT = /^gemini-(\d{1,3})(?:\.(\d{1,3}))?-(pro|flash|flash-lite)(?:-(\d{3}))?$/;
// Gemini 4 uses named variants at the same version. Prefer the faster everyday model first.
const GEMINI_4_BY_PRIORITY = ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-4-argon', 'gemini-4-carbon'];
const descriptor = PROVIDER_CATALOG.find((p) => p.id === 'google_gemini');
const CATALOG_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function rank(id: string): number[] | null {
  const named = GEMINI_4_BY_PRIORITY.indexOf(id);
  if (named >= 0) return [4, 0, GEMINI_4_BY_PRIORITY.length + 2 - named, 0];
  const match = GEMINI_TEXT.exec(id);
  if (!match) return null;
  const [, major, minor = '0', tier, revision = '0'] = match;
  if (+major < 3 || (+major === 3 && +minor < 5)) return null;
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
): Promise<ReadinessModel[] | null> {
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
        return null;
      }
      const page = await catalogPage(response);
      if (!Array.isArray(page?.models) || page.models.length > 100) return null;
      for (const item of page.models) {
        const id = typeof item?.name === 'string' && item.name.startsWith('models/') ? item.name.slice(7) : '';
        const order = rank(id);
        if (order && Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent')) {
          models.set(id, order);
        }
      }
      if (signal.aborted) return null;
      const next: unknown = page.nextPageToken;
      if (next === undefined || next === '') {
        return [...models.entries()].sort(([a, x], [b, y]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || y[3] - x[3] || a.localeCompare(b))
          .map(([id]) => ({ id, observedVersions: [id] }));
      }
      if (typeof next !== 'string' || next.length > 2048 || tokens.has(next)) return null;
      tokens.add(next);
      token = next;
    }
  } catch { /* Unavailable or incomplete catalog cannot select a model. */ }
  return null;
}

function state(value: unknown): value is { model: string; revision: number } {
  if (!value || typeof value !== 'object') return false;
  const x = value as Record<string, unknown>;
  return typeof x.model === 'string' && Number.isSafeInteger(x.revision) && Number(x.revision) > 0;
}
export function createReadinessStore(client: SupabaseClient, admin = false): ReadinessStore {
  return {
    async claim() {
      const { data, error } = await client.rpc('claim_coaching_model_probe_v2', { p_incumbent: contract.model, p_admin: admin });
      if (error || !data) throw Error('coaching_model_selection_unavailable');
      if (data.kind === 'claimed' && state(data.lease?.state)
        && typeof data.lease.token === 'string' && Number.isSafeInteger(data.lease.deadlineMs)) return data as ClaimResult;
      if ((data.kind === 'busy' || data.kind === 'cooldown') && state(data.state)) return data as ClaimResult;
      throw Error('coaching_model_selection_unavailable');
    },
    async finish(lease, result, outcome) {
      const { data, error } = await client.rpc('finish_coaching_model_probe_v2', {
        p_revision: lease.state.revision,
        p_token: lease.token,
        p_verified: result.verified ?? null,
        p_promote_to: result.promoteTo ?? null,
        p_retry_after_ms: result.retryAfterMs ?? null,
        p_outcome: outcome,
      });
      if (error) throw Error('coaching_model_selection_unavailable');
      return data === true;
    },
  };
}

export const COACHING_MODEL_SELECTION_FIELDS = 'model,revision,checked,verified,verified_until,probe_deadline,next_probe_at';
type Selection = { model?: unknown; checked?: unknown; verified?: unknown;
  verified_until?: unknown; probe_deadline?: unknown; next_probe_at?: unknown };

/**
 * What serving uses: the live selection only. A readiness result (unverified, a check's wait, an in-flight or abandoned
 * check) selects WHICH model serves; it never decides WHETHER serving calls Gemini (PO 11-27: coaching must not refuse users
 * because of a check's result). Real requests keep their own bounded provider-error handling. Only an unreadable or invalid
 * selection is unavailable: that is an infrastructure fault, not a check result. Ops Health uses the same selection resolver.
 */
export type CoachingServingModel = { kind: 'ready'; model: string } | { kind: 'unprobed' } | { kind: 'unavailable' };
export function coachingServingModel(data: Selection | null): CoachingServingModel {
  if (!data) return { kind: 'unprobed' };
  if (typeof data.model !== 'string' || !geminiReadinessModel(data.model)
    || typeof data.checked !== 'boolean' || typeof data.verified !== 'boolean') return { kind: 'unavailable' };
  // A pre-rollout take keeps the established route only while the reviewed default was never checked.
  if (!data.checked && data.model === contract.model) return { kind: 'unprobed' };
  return { kind: 'ready', model: data.model };
}

export async function readReadyCoachingModel(client: SupabaseClient, signal: AbortSignal): Promise<CoachingServingModel> {
  // An in-flight check may promote a model, but optional polling must never discard a usable selection.
  const deadline = Date.now() + 1500;
  const unavailable = { kind: 'unavailable' } as const;
  let lastUsable: CoachingServingModel | undefined;
  for (;;) {
    if (signal.aborted) return unavailable;
    const remaining = deadline - Date.now();
    if (lastUsable && remaining <= 0) return lastUsable;
    try {
      const { data, error } = await client.from('coaching_model_selection').select(COACHING_MODEL_SELECTION_FIELDS)
        .eq('single', true).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(700, remaining)))])).maybeSingle();
      if (signal.aborted) return unavailable;
      if (error) return lastUsable ?? unavailable;
      const selection = coachingServingModel(data);
      if (selection.kind === 'unavailable') return lastUsable ?? unavailable;
      if (lastUsable && !data) return lastUsable;
      lastUsable = selection;
      const inFlight = typeof data?.probe_deadline === 'string' && Date.parse(data.probe_deadline) > Date.now();
      if (!inFlight) return selection;
    } catch {
      return signal.aborted ? unavailable : lastUsable ?? unavailable;
    }
    const wait = Math.min(150, Math.max(0, deadline - Date.now()));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
