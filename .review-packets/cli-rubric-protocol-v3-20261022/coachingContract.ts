/** One pure coaching contract used by the existing endpoint and all local providers. */
import coachingContract from '../get-ai-suggestions/contract.json' with { type: 'json' };

export const COACHING_CHARACTER_CEILING = Object.freeze({
  what_worked: coachingContract.generationConfig.responseSchema.properties.what_worked.maxLength,
  what_to_try_next: coachingContract.generationConfig.responseSchema.properties.what_to_try_next.maxLength,
});

export type CoachingVersion = 'gemini_coaching_v1' | 'gemini_coaching_focus_v1';

export const COACHING_VERSIONS: ReadonlySet<string> = new Set<CoachingVersion>(['gemini_coaching_v1', 'gemini_coaching_focus_v1']);

export interface AISuggestions {
  version: CoachingVersion;
  what_worked: string;
  what_to_try_next: string;
}

export type CoachingProduct='open_mic'|'focus_points';
export type CoachingProvider='gemini'|'llama:3.2-1b';
export type LocalCoachingVersion='llama_coaching_v1'|'llama_coaching_focus_v1';
export type CoachingPair=Omit<AISuggestions,'version'>&{version:CoachingVersion|LocalCoachingVersion};
/** A service-bound persistence receipt is still client-reported output, never observed inference. */
export const LOCAL_COACHING_IDENTITY = Object.freeze({
  provider: 'llama:3.2-1b',
  model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  modelRevision: '2a37b0a5ecb622d51ddc2fac74de0b95872affd7',
  provenance: 'client_reported_local',
} as const);
export interface LocalCoachingReceipt {
  provider: typeof LOCAL_COACHING_IDENTITY.provider;
  model: typeof LOCAL_COACHING_IDENTITY.model;
  modelRevision: typeof LOCAL_COACHING_IDENTITY.modelRevision;
  provenance: typeof LOCAL_COACHING_IDENTITY.provenance;
  generationId: string; contextSha256: string; outputSha256: string;
}
export function parseLocalCoachingReceipt(value: unknown): LocalCoachingReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.provider !== LOCAL_COACHING_IDENTITY.provider || r.model !== LOCAL_COACHING_IDENTITY.model
    || r.modelRevision !== LOCAL_COACHING_IDENTITY.modelRevision || r.provenance !== LOCAL_COACHING_IDENTITY.provenance
    || typeof r.generationId !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(r.generationId)
    || typeof r.contextSha256 !== 'string' || !/^[a-f\d]{64}$/.test(r.contextSha256)
    || typeof r.outputSha256 !== 'string' || !/^[a-f\d]{64}$/.test(r.outputSha256)) return null;
  return { ...LOCAL_COACHING_IDENTITY, generationId: r.generationId, contextSha256: r.contextSha256, outputSha256: r.outputSha256 };
}
export interface LocalCoachingDiagnosticFields {
  source: 'local_generated' | 'local_cache'; provider: typeof LOCAL_COACHING_IDENTITY.provider;
  local_model: typeof LOCAL_COACHING_IDENTITY.model; local_model_revision: typeof LOCAL_COACHING_IDENTITY.modelRevision;
  local_provenance: typeof LOCAL_COACHING_IDENTITY.provenance; local_receipt_bound: true;
  operation: 'generate' | 'prepare_local' | 'commit_local' | 'read_local';
}
/** Validate the closed persistence claim before projecting it; it never proves a model actually ran. */
export function localCoachingDiagnostic(value: Record<string, unknown> | null): LocalCoachingDiagnosticFields | null {
  const d = value;
  if (!d || (d.source !== 'local_generated' && d.source !== 'local_cache')
    || d.provider !== LOCAL_COACHING_IDENTITY.provider || d.local_model !== LOCAL_COACHING_IDENTITY.model
    || d.local_model_revision !== LOCAL_COACHING_IDENTITY.modelRevision || d.local_provenance !== LOCAL_COACHING_IDENTITY.provenance
    || d.local_receipt_bound !== true || d.outcome !== 'success' || d.phase !== 'complete'
    || !Number.isInteger(d.status) || Number(d.status) < 200 || Number(d.status) >= 300
    || d.provider_status != null || d.observed_model != null || d.provider_attempts !== 0 || d.retry_count !== 0
    || d.provider_wait_ms_total !== 0 || d.provider_duration_ms !== 0
    || (d.source === 'local_generated' ? d.operation !== 'commit_local' : d.operation !== 'generate' && d.operation !== 'prepare_local' && d.operation !== 'read_local')) return null;
  // A local persistence claim cannot smuggle cloud token/attempt observations through another projection.
  const cloud = ['provider_error_status', 'provider_error_reason', 'provider_finish_reason', 'provider_block_reason',
    'provider_prompt_tokens', 'provider_output_tokens', 'provider_thinking_tokens', 'provider_total_tokens',
    'attempt_1_reason', 'attempt_1_status', 'attempt_1_ms', 'attempt_2_reason', 'attempt_2_status', 'attempt_2_ms',
    'attempt_3_reason', 'attempt_3_status', 'attempt_3_ms'];
  if (cloud.some(key => d[key] != null)) return null;
  return { source: d.source, provider: LOCAL_COACHING_IDENTITY.provider, local_model: LOCAL_COACHING_IDENTITY.model,
    local_model_revision: LOCAL_COACHING_IDENTITY.modelRevision, local_provenance: LOCAL_COACHING_IDENTITY.provenance,
    local_receipt_bound: true, operation: d.operation as LocalCoachingDiagnosticFields['operation'] };
}
export function versionForProvider(provider:CoachingProvider,product:CoachingProduct):CoachingPair['version'] {
  if(provider==='gemini') return product==='focus_points'?'gemini_coaching_focus_v1':'gemini_coaching_v1';
  if(provider==='llama:3.2-1b') return product==='focus_points'?'llama_coaching_focus_v1':'llama_coaching_v1';
  throw new Error('unknown coaching provider');
}

export interface SessionEvidence {
  transcript: string | null;
  transcript_state: string | null;
  duration: number | null;
  total_words: number | null;
  filler_words: unknown;
  /** #1258: the per-word counts saves now write; `filler_words` is stripped on save and kept only for legacy rows. */
  filler_counts: unknown;
  clarity_score: number | null;
  wpm: number | null;
  pause_metrics: unknown;
  /** The product's own saved next action for this take (`{ metric, ... }`); selects Focus Points' one delivery signal. */
  next_action_signal?: unknown;
  ai_suggestions: unknown;
  /** #1537: the durable product marker written at session creation; absent/NULL on rows created before it. */
  product?: unknown;
}

export function parseSuggestions(rawText: string, { enforceCharacterCeiling = false } = {}): AISuggestions | null {
  return parsePair(rawText,COACHING_VERSIONS,enforceCharacterCeiling) as AISuggestions|null;
}

/** Legacy Gemini reads and local generations share exactly the same shape/length validator. */
function parsePair(rawText:string,versions:ReadonlySet<string>,enforceCharacterCeiling:boolean):CoachingPair|null {
  try {
    const parsed = JSON.parse(rawText.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const candidate = parsed as Record<string, unknown>;
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['version', 'what_to_try_next', 'what_worked'])) return null;
    if (typeof candidate.version !== 'string' || !versions.has(candidate.version)) return null;
    if (typeof candidate.what_worked !== 'string' || !candidate.what_worked.trim()) return null;
    if (typeof candidate.what_to_try_next !== 'string' || !candidate.what_to_try_next.trim()) return null;
    // Refused, never truncated: cutting advice changes what the coach said.
    if (enforceCharacterCeiling) {
      if (candidate.what_worked.trim().length > COACHING_CHARACTER_CEILING.what_worked) return null;
      if (candidate.what_to_try_next.trim().length > COACHING_CHARACTER_CEILING.what_to_try_next) return null;
    }

    return {
      version: candidate.version as CoachingPair['version'],
      what_worked: candidate.what_worked.trim(),
      what_to_try_next: candidate.what_to_try_next.trim(),
    };
  } catch (error) {
    // #1258 (PM 5953504835): the error NAME only. A JSON SyntaxError message quotes the text it failed on — model output.
    console.error('Failed to parse AI suggestions JSON.', JSON.stringify({ error: error instanceof Error ? error.name : 'unknown' }));
    return null;
  }
}

export function parseProviderSuggestions(rawText:string,provider:CoachingProvider,product:CoachingProduct,
  enforceCharacterCeiling=true):CoachingPair|null {
  return parsePair(rawText,new Set([versionForProvider(provider,product)]),enforceCharacterCeiling);
}

export function parseSavedCoaching(rawText:string,product?:CoachingProduct):CoachingPair|null {
  const products:CoachingProduct[]=product?[product]:['open_mic','focus_points'];
  return parsePair(rawText,new Set(products.flatMap(p=>[
    versionForProvider('gemini',p),versionForProvider('llama:3.2-1b',p),
  ])),false);
}

export function providerOutputSchema(provider:CoachingProvider,product:CoachingProduct) {
  return {type:'object',additionalProperties:false,properties:{
    version:{type:'string',enum:[versionForProvider(provider,product)]},
    what_worked:{type:'string',minLength:1,maxLength:COACHING_CHARACTER_CEILING.what_worked,pattern:'.*\\S.*'},
    what_to_try_next:{type:'string',minLength:1,maxLength:COACHING_CHARACTER_CEILING.what_to_try_next,pattern:'.*\\S.*'},
  },required:['version','what_worked','what_to_try_next']};
}

export interface FocusPointEvidence {
  label: string;
  verdict: 'detected' | 'not_detected' | 'unavailable';
  detectedAtSeconds: number | null;
}

export type FocusContext =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'focus'; topic: string | null; points: FocusPointEvidence[] }
  | { kind: 'error' };

export const MAX_FOCUS_LABEL_CHARS = 200;

export const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const quoteLabel = (text: string): string => `"${text.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FOCUS_LABEL_CHARS)}"`;

export function buildDeliverySignals(session: SessionEvidence, focusContext: FocusContext): string {
  // #1258: saves write `filler_counts` and strip `filler_words`; the legacy field is only a fallback for older rows.
  const fillerEvidence = session.filler_counts ?? session.filler_words;
  const fillers = `- Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}`;
  const pace = `- Words Per Minute (WPM): ${session.wpm ?? 'N/A'}`;
  if (focusContext.kind !== 'focus') {
    return `
      Delivery signals:
      ${pace}
      ${fillers}
    `;
  }
  const metric = (session.next_action_signal as { metric?: unknown } | null | undefined)?.metric;
  const chosen = metric === 'filler_rate' ? fillers : metric === 'wpm' ? pace : null;
  return chosen
    ? `
      Delivery signal (the one most actionable for this take):
      ${chosen}
    `
    : `
      Delivery signals: none material for this take - coach from the Focus Points results.
    `;
}

export function buildFocusCoachingText(context: FocusContext): string {
  if (context.kind !== 'focus') return '';
  const lines = context.points.map((point, index) => {
    const result = point.verdict === 'detected'
      ? `detected${point.detectedAtSeconds !== null ? ` at ${clockText(point.detectedAtSeconds)}` : ''}`
      : point.verdict === 'not_detected'
        ? 'not detected by the keyword matcher (the speaker may have covered it in other words)'
        : 'not checked';
    return `      ${index + 1}. ${quoteLabel(point.label)}: ${result}`;
  });
  const allDetected = context.points.every((point) => point.verdict === 'detected');
  return `
      Focus Points session. The speaker chose these points to cover, in this order${context.topic ? `, for the topic ${quoteLabel(context.topic)}` : ''}. A keyword matcher checked the transcript for each:
${lines.join('\n')}

      Focus Points coaching rules:
      - Both phrases must help the speaker cover THESE chosen points in the next run: which point to open, introduce or signpost, where it belongs, or pacing between points, when this transcript and these results support it.
      - "Not detected" is only what the matcher found. Never say a point was missed, skipped or not mentioned; suggest how to make it unmistakable instead.
${allDetected ? '      - Every point was detected. Do not suggest covering a point as if it were missing; coach placement, transitions or pace between points.\n' : ''}`;
}

export function buildCoachingPrompt(transcriptForPrompt: string, metricsText: string): string {
  return coachingContract.promptTemplate.replace(
    /\{\{(TRANSCRIPT|METRICS)\}\}/g,
    (_marker, name: string) => name === 'TRANSCRIPT' ? transcriptForPrompt : metricsText,
  );
}

/** Inputs must come from the saved session/context reader, never from a text-only component prop. */
export function buildProviderCoachingPrompt(session:SessionEvidence,focus:FocusContext,
  provider:CoachingProvider,product:CoachingProduct):string {
  if(session.transcript_state!=='available'||!session.transcript?.trim()) throw new Error('saved transcript unavailable');
  if(session.product!==product) throw new Error('saved product mismatch');
  if(product==='focus_points'&&focus.kind!=='focus') throw new Error('saved Focus results unavailable or pending');
  if(product==='open_mic'&&focus.kind!=='none') throw new Error('unexpected Focus context for Open Mic');
  const metrics=buildDeliverySignals(session,focus)+buildFocusCoachingText(focus);
  // Substitute provenance in the TEMPLATE before inserting user content; transcript literals remain evidence.
  const template=coachingContract.promptTemplate.split(coachingContract.version).join(versionForProvider(provider,product));
  return template.replace(/\{\{(TRANSCRIPT|METRICS)\}\}/g,
    (_marker,name:string)=>name==='TRANSCRIPT'?session.transcript!:metrics);
}

