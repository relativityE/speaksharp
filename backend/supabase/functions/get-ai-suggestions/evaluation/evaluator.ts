/**
 * LLM COACHING EVALUATOR (offline-first, provider-neutral).
 *
 * Purpose: evidence for keeping or switching the coaching model. It runs ANY `CoachingProvider` (the closed attempt contract in
 * providers/types.ts) over a fixed, committed transcript set and reports content-free measures that can be compared between the
 * incumbent and a candidate.
 *
 * What it reuses from the handler, so it measures what customers would get rather than a restatement:
 *   - the prompt: `buildDeliverySignals` + `buildFocusCoachingText` + `buildCoachingPrompt` (index.ts), via prompt.ts;
 *   - validity: `classifyGeneratedSuggestions` (the exact gate a fresh answer passes before it is persisted);
 *   - format: `measureCoachingQuality` (the word band and metric-recital flag the handler records);
 *   - the first attempt's timeout: `attemptTimeoutMs(0)` (providerRetry.ts).
 * It makes ONE attempt per transcript: the handler's retries would hide a provider's first-attempt failure rate.
 *
 * Grounding is measured with deterministic PROXIES, stated as such, not a semantic judge:
 *   - quoted spans in a phrase must occur in the transcript (an invented quote is ungrounded);
 *   - per-transcript `unsupported` patterns name claims the transcript cannot support (slides, an audience, "missed" points);
 *   - per-transcript `anchors` test whether a pair refers to this transcript at all rather than generic advice.
 *
 * Cost comes from the provider-REPORTED token counts the adapter already decodes (`answer.codes`) times a reviewed price that the
 * caller supplies. No price is assumed: without one the cost is UNPRICED, and a served take without reported usage makes it UNKNOWN.
 *
 * Privacy: the report carries counts, rates, closed reason codes, safe model ids, token counts and timings only. It never carries a
 * phrase, a transcript, a prompt or a key.
 *
 * No live call happens here. A live run needs a candidate adapter, its key and a PO-approved bound (count and cost cap).
 */
import { type CoachingFailureReason, classifyGeneratedSuggestions, measureCoachingQuality } from '../index.ts';
import { attemptTimeoutMs } from '../providerRetry.ts';
import type { CoachingProvider, ProviderAttemptResult } from '../providers/types.ts';
import { EVALUATION_MAX_TRANSCRIPT_CHARS, type EvaluationItem, evaluationPrompt } from './prompt.ts';

export { EVALUATION_MAX_TRANSCRIPT_CHARS, type EvaluationItem, evaluationPrompt };

export interface EvaluationSet {
  schemaVersion: 1;
  kind: 'speaksharp-coaching-eval-set';
  id: string;
  provenance: string;
  items: EvaluationItem[];
}

const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Shape validation of the committed set. A refusal names a closed code only. */
export function parseEvaluationSet(input: unknown): EvaluationSet {
  const refuse = (code: string): never => { throw new Error(code); };
  if (typeof input !== 'object' || input === null) refuse('EVAL_SET_NOT_OBJECT');
  const set = input as Record<string, unknown>;
  if (set.schemaVersion !== 1 || set.kind !== 'speaksharp-coaching-eval-set' || typeof set.id !== 'string') refuse('EVAL_SET_HEADER_INVALID');
  if (typeof set.provenance !== 'string' || !set.provenance.startsWith('SYNTHETIC.')) refuse('EVAL_SET_NOT_SYNTHETIC');
  if (!Array.isArray(set.items) || set.items.length === 0) refuse('EVAL_SET_EMPTY');
  const ids = new Set<string>();
  for (const raw of set.items as unknown[]) {
    const item = raw as Record<string, unknown>;
    if (typeof item?.id !== 'string' || !ITEM_ID.test(item.id) || ids.has(item.id)) refuse('EVAL_ITEM_ID_INVALID');
    ids.add(item.id as string);
    if (item.product !== 'open_mic' && item.product !== 'focus_points') refuse('EVAL_ITEM_PRODUCT_INVALID');
    if (typeof item.transcript !== 'string' || !item.transcript.trim()) refuse('EVAL_ITEM_TRANSCRIPT_INVALID');
    if ((item.transcript as string).length > EVALUATION_MAX_TRANSCRIPT_CHARS) refuse('EVAL_ITEM_TRANSCRIPT_TOO_LONG');
    if ((item.product === 'focus_points') !== (typeof item.focus === 'object' && item.focus !== null)) refuse('EVAL_ITEM_FOCUS_INVALID');
    const grounding = item.grounding as Record<string, unknown> | undefined;
    if (!Array.isArray(grounding?.anchors) || grounding.anchors.length === 0 || !Array.isArray(grounding?.unsupported)) refuse('EVAL_ITEM_GROUNDING_INVALID');
    for (const anchor of grounding!.anchors as unknown[]) {
      if (typeof anchor !== 'string' || !wordMatch(anchor).test(normalize(item.transcript as string))) refuse('EVAL_ITEM_ANCHOR_NOT_IN_TRANSCRIPT');
    }
    for (const pattern of grounding!.unsupported as unknown[]) {
      if (typeof pattern !== 'string') refuse('EVAL_ITEM_UNSUPPORTED_INVALID');
      // An "unsupported" claim the transcript itself makes would be a mislabelled fixture.
      if (new RegExp(pattern as string, 'i').test(item.transcript as string)) refuse('EVAL_ITEM_UNSUPPORTED_IN_TRANSCRIPT');
    }
  }
  return set as unknown as EvaluationSet;
}

const normalize = (value: string): string => value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole-word (or whole-phrase) match, so 'date' does not match 'update'. */
const wordMatch = (anchor: string): RegExp => new RegExp(`\\b${escapeRegExp(normalize(anchor))}\\b`);
// Single quotes count only with non-letters outside them, so apostrophes ("don't ... it's") are not a quote.
const QUOTED = /"([^"]{3,})"|“([^”]{3,})”|(?<![A-Za-z])'([^']{3,})'(?![A-Za-z])/g;

/** Grounding proxies for one served pair. */
export function measureGrounding(phrases: string[], item: EvaluationItem): { quotes: number; ungroundedQuotes: number; unsupportedClaim: boolean; anchored: boolean } {
  const transcript = normalize(item.transcript);
  let quotes = 0;
  let ungroundedQuotes = 0;
  for (const phrase of phrases) {
    for (const match of phrase.matchAll(QUOTED)) {
      const span = normalize((match[1] ?? match[2] ?? match[3]).replace(/[.,!?;:]+$/, ''));
      quotes += 1;
      if (!transcript.includes(span)) ungroundedQuotes += 1;
    }
  }
  const joined = phrases.join(' ');
  return {
    quotes,
    ungroundedQuotes,
    unsupportedClaim: item.grounding.unsupported.some((pattern) => new RegExp(pattern, 'i').test(joined)),
    anchored: item.grounding.anchors.some((anchor) => wordMatch(anchor).test(normalize(joined))),
  };
}

export type EvaluationOutcome = CoachingFailureReason | 'none';

/** One take's content-free record. */
export interface ItemRecord {
  id: string;
  outcome: EvaluationOutcome;
  status: number | null;
  modelVersion: string | null;
  latencyMs: number;
  promptChars: number;
  answerChars: number | null;
  quality: ReturnType<typeof measureCoachingQuality> | null;
  grounding: ReturnType<typeof measureGrounding> | null;
  /** Provider-reported usage for an answered take (null fields when not reported); null when nothing was answered. */
  tokens: { prompt: number | null; output: number | null; thinking: number | null } | null;
}

/** The handler's mapping of one attempt to a closed reason (index.ts, the provider attempt loop), for a single attempt. */
export function outcomeOf(result: ProviderAttemptResult, timedOut: boolean): { outcome: EvaluationOutcome; phrases: string[] | null; modelVersion: string | null } {
  if (!result.ok) return { outcome: result.status >= 500 ? 'provider_http_5xx' : 'provider_http_4xx', phrases: null, modelVersion: null };
  if (result.bodyUnreadable) return { outcome: timedOut ? 'provider_timeout' : 'provider_malformed_response', phrases: null, modelVersion: null };
  // A readable answer with nothing to classify: the handler records the attempt as 'invalid_shape'.
  if (result.answer === null) return { outcome: 'invalid_shape', phrases: null, modelVersion: null };
  const classified = classifyGeneratedSuggestions(result.answer.text);
  if (!('suggestions' in classified)) return { outcome: classified.reason, phrases: null, modelVersion: result.answer.modelVersion };
  const phrases = [classified.suggestions.what_worked, classified.suggestions.what_to_try_next];
  return { outcome: result.answer.modelVersion ? 'none' : 'missing_model_version', phrases, modelVersion: result.answer.modelVersion };
}

export interface EvaluatorRuntime {
  now(): number;
  timeout(ms: number): AbortSignal;
}
export const realEvaluatorRuntime: EvaluatorRuntime = { now: () => performance.now(), timeout: (ms) => AbortSignal.timeout(ms) };

/** One attempt for one take, measured. Throws nothing: a thrown transport error is a closed outcome. */
export async function evaluateItem(provider: CoachingProvider, apiKey: string, item: EvaluationItem, runtime: EvaluatorRuntime = realEvaluatorRuntime): Promise<ItemRecord> {
  const prompt = evaluationPrompt(item);
  const signal = runtime.timeout(attemptTimeoutMs(0));
  const startedAt = runtime.now();
  let status: number | null = null;
  let mapped: ReturnType<typeof outcomeOf>;
  let answerChars: number | null = null;
  let tokens: ItemRecord['tokens'] = null;
  try {
    const result = await provider.attempt({ prompt, apiKey, signal, onResponse: (s) => { status = s; } });
    mapped = outcomeOf(result, signal.aborted);
    answerChars = typeof result.answer?.text === 'string' ? result.answer.text.length : null;
    if (result.answer) tokens = { prompt: result.answer.codes.prompt_tokens, output: result.answer.codes.output_tokens, thinking: result.answer.codes.thinking_tokens };
  } catch (error) {
    const name = error instanceof Error || error instanceof DOMException ? error.name : 'unknown';
    mapped = { outcome: name === 'TimeoutError' || name === 'AbortError' ? 'provider_timeout' : 'provider_transport', phrases: null, modelVersion: null };
  }
  const latencyMs = Math.max(0, Math.round(runtime.now() - startedAt));
  const quality = mapped.phrases ? measureCoachingQuality({ version: 'gemini_coaching_v1', what_worked: mapped.phrases[0], what_to_try_next: mapped.phrases[1] }) : null;
  return {
    id: item.id, outcome: mapped.outcome, status, modelVersion: mapped.modelVersion, latencyMs, promptChars: prompt.length, answerChars,
    quality, grounding: mapped.phrases ? measureGrounding(mapped.phrases, item) : null, tokens,
  };
}

/** A reviewed price for one provider/model, in US dollars per million tokens. Supplied by the caller; never assumed here. */
export interface ReviewedPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  /** Stated separately: providers differ in how reasoning ("thinking") tokens are billed. */
  thinkingUsdPerMillion: number;
}

export type CostEstimate =
  | { status: 'UNPRICED'; reason: 'no_reviewed_price' }
  | { status: 'UNKNOWN'; reason: 'usage_not_reported' }
  | { status: 'ESTIMATED'; usdTotal: number; usdPerTake: number };

/** Cost from reported usage. Unanswered takes carry no tokens; any answered take without reported prompt/output usage is UNKNOWN. */
export function estimateCost(records: ItemRecord[], price: ReviewedPrice | null): CostEstimate {
  if (!price) return { status: 'UNPRICED', reason: 'no_reviewed_price' };
  for (const value of Object.values(price)) if (!(Number.isFinite(value) && value >= 0)) throw new Error('EVAL_PRICE_INVALID');
  const answered = records.filter((r) => r.tokens !== null);
  if (answered.some((r) => r.tokens!.prompt === null || r.tokens!.output === null)) return { status: 'UNKNOWN', reason: 'usage_not_reported' };
  const usd = answered.reduce((total, r) => total
    + (r.tokens!.prompt! * price.inputUsdPerMillion + r.tokens!.output! * price.outputUsdPerMillion + (r.tokens!.thinking ?? 0) * price.thinkingUsdPerMillion) / 1e6, 0);
  const round = (v: number) => Math.round(v * 1e8) / 1e8;
  return { status: 'ESTIMATED', usdTotal: round(usd), usdPerTake: round(records.length ? usd / records.length : 0) };
}

export interface ProviderSummary {
  providerId: string;
  setId: string;
  setDigest: string;
  mode: 'offline_controls' | 'live';
  takes: number;
  valid: number;
  validRate: number;
  outcomes: Record<string, number>;
  modelVersions: string[];
  withinTargetRate: number | null;
  metricRecitalRate: number | null;
  quotes: number;
  ungroundedQuotes: number;
  unsupportedClaimRate: number | null;
  anchoredRate: number | null;
  latencyMs: { p50: number; p95: number; max: number };
  tokens: { prompt: number; output: number; thinking: number; takesWithUsage: number };
  cost: CostEstimate;
  records: ItemRecord[];
}

const rate = (count: number, of: number): number | null => (of === 0 ? null : Math.round((count / of) * 1000) / 1000);
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** sha256 of the committed set's canonical JSON: a report is bound to the exact transcripts it measured. */
export async function setDigest(set: EvaluationSet): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(set));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every take, sequentially (a bounded live run must not burst), summarized content-free. */
export async function evaluateProvider(
  provider: CoachingProvider, apiKey: string, set: EvaluationSet, mode: ProviderSummary['mode'],
  { runtime = realEvaluatorRuntime, price = null }: { runtime?: EvaluatorRuntime; price?: ReviewedPrice | null } = {},
): Promise<ProviderSummary> {
  const records: ItemRecord[] = [];
  for (const item of set.items) records.push(await evaluateItem(provider, apiKey, item, runtime));
  const served = records.filter((r) => r.outcome === 'none');
  const outcomes: Record<string, number> = {};
  for (const r of records) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    providerId: provider.id,
    setId: set.id,
    setDigest: await setDigest(set),
    mode,
    takes: records.length,
    valid: served.length,
    validRate: rate(served.length, records.length) ?? 0,
    outcomes,
    modelVersions: [...new Set(records.map((r) => r.modelVersion).filter((v): v is string => v !== null))].sort(),
    withinTargetRate: rate(served.filter((r) => r.quality?.within_target).length, served.length),
    metricRecitalRate: rate(served.filter((r) => r.quality?.metric_recital).length, served.length),
    quotes: served.reduce((n, r) => n + (r.grounding?.quotes ?? 0), 0),
    ungroundedQuotes: served.reduce((n, r) => n + (r.grounding?.ungroundedQuotes ?? 0), 0),
    unsupportedClaimRate: rate(served.filter((r) => r.grounding?.unsupportedClaim).length, served.length),
    anchoredRate: rate(served.filter((r) => r.grounding?.anchored).length, served.length),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.at(-1) ?? 0 },
    tokens: {
      prompt: records.reduce((n, r) => n + (r.tokens?.prompt ?? 0), 0),
      output: records.reduce((n, r) => n + (r.tokens?.output ?? 0), 0),
      thinking: records.reduce((n, r) => n + (r.tokens?.thinking ?? 0), 0),
      takesWithUsage: records.filter((r) => r.tokens?.prompt != null && r.tokens?.output != null).length,
    },
    cost: estimateCost(records, price),
    records,
  };
}

/** Incumbent vs candidate on the same set: differences only. Whether a difference justifies switching is the PO's adoption bar. */
export function compareSummaries(incumbent: ProviderSummary, candidate: ProviderSummary) {
  if (incumbent.setDigest !== candidate.setDigest) throw new Error('EVAL_COMPARE_DIFFERENT_SETS');
  if (incumbent.mode !== candidate.mode) throw new Error('EVAL_COMPARE_DIFFERENT_MODES');
  const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((b - a) * 1000) / 1000);
  return {
    setDigest: incumbent.setDigest,
    mode: incumbent.mode,
    incumbent: incumbent.providerId,
    candidate: candidate.providerId,
    validRate: delta(incumbent.validRate, candidate.validRate),
    withinTargetRate: delta(incumbent.withinTargetRate, candidate.withinTargetRate),
    metricRecitalRate: delta(incumbent.metricRecitalRate, candidate.metricRecitalRate),
    unsupportedClaimRate: delta(incumbent.unsupportedClaimRate, candidate.unsupportedClaimRate),
    anchoredRate: delta(incumbent.anchoredRate, candidate.anchoredRate),
    ungroundedQuotes: candidate.ungroundedQuotes - incumbent.ungroundedQuotes,
    latencyP50Ratio: incumbent.latencyMs.p50 > 0 ? Math.round((candidate.latencyMs.p50 / incumbent.latencyMs.p50) * 100) / 100 : null,
    costPerTakeUsd: incumbent.cost.status === 'ESTIMATED' && candidate.cost.status === 'ESTIMATED'
      ? Math.round((candidate.cost.usdPerTake - incumbent.cost.usdPerTake) * 1e8) / 1e8
      : null,
  };
}
