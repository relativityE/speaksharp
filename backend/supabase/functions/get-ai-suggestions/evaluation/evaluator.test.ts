import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decodeProviderAnswer, decodeProviderError } from '../providerDecode.ts';
import { geminiProvider } from '../providers/gemini.ts';
import type { CoachingProvider, ProviderAttemptInput, ProviderAttemptResult } from '../providers/types.ts';
import evaluationSet from './transcripts.json' with { type: 'json' };
import {
  compareSummaries, estimateCost, evaluateProvider, evaluationPrompt, type EvaluationSet, type EvaluatorRuntime, measureGrounding, outcomeOf, parseEvaluationSet,
} from './evaluator.ts';

/**
 * OFFLINE CONTROLS. Every provider answer below is a SYNTHETIC CONTROL written to drive one metric path; none is model output, and no
 * test here makes a network call. The incumbent controls run through the REAL Gemini adapter (its URL, key placement, body and
 * decoding) with `fetch` replaced; the candidate controls run through a scripted double of the same closed attempt contract, which is
 * what makes the evaluator provider-neutral.
 */
const SET = parseEvaluationSet(evaluationSet);
const KEY = 'offline-control-key-not-a-secret';

/** A clock that advances by `stepMs` per reading: latency = stepMs per take, deterministic. */
function steppedRuntime(stepMs: number): EvaluatorRuntime {
  let t = 0;
  return { now: () => (t += stepMs), timeout: () => new AbortController().signal };
}

const pair = (what_worked: string, what_to_try_next: string, version = 'gemini_coaching_v1') => JSON.stringify({ version, what_worked, what_to_try_next });

/** Per take: the synthetic Gemini-shaped answer the replaced fetch returns. */
const INCUMBENT_CONTROLS: Record<string, { status: number; text?: string; modelVersion?: string | null }> = {
  // Valid, within the 8-10 word band, quotes the transcript exactly, anchored.
  'om-01-team-update': { status: 200, text: pair('Naming "the verification email arrives late" made the problem concrete.', 'Open with the checklist result before describing the setup delay.') },
  // Valid but a metric recital, outside the word band.
  'om-02-filler-heavy': { status: 200, text: pair('You used 12 fillers.', 'Pause silently before naming the raised beds and volunteers.') },
  // Valid, but an invented quote and an unsupported claim (slides).
  'om-03-fast-pitch': { status: 200, text: pair('The line "we doubled revenue twice" landed with real confidence.', 'Slow down and add one slide showing the pilot results.') },
  // Contract-invalid: an extra key.
  'om-04-too-short': { status: 200, text: JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'x', what_to_try_next: 'y', extra: 1 }) },
  // Contract-invalid: over the 240-character ceiling.
  'om-05-quotes-and-placeholders': { status: 200, text: pair('a '.repeat(130).trim(), 'Read each date out loud before you sign the lease.') },
  // A valid pair, but the provider reported no model version: the handler refuses it.
  'om-06-long-structure': { status: 200, text: pair('The three-part structure made the evening hours easy to follow.', 'Close by naming the parking fix and the city request.'), modelVersion: null },
  // Provider failure.
  'fp-01-points-all-detected': { status: 503 },
  // Valid and within band, but generic: nothing from this transcript.
  'fp-02-point-not-detected': { status: 200, text: pair('Your delivery sounded clear and calm throughout this practice take.', 'Keep practicing regularly to build even more speaking confidence.', 'gemini_coaching_focus_v1') },
};

/** Synthetic provider-reported usage on every answered incumbent control (Gemini's usageMetadata shape). */
const CONTROL_USAGE = { promptTokenCount: 400, candidatesTokenCount: 30, thoughtsTokenCount: 20, totalTokenCount: 450 };
/** A synthetic price for the arithmetic only. Real prices are a reviewed input for the approved live run. */
const CONTROL_PRICE = { inputUsdPerMillion: 1, outputUsdPerMillion: 2, thinkingUsdPerMillion: 2 };

async function withControlFetch<T>(run: () => Promise<T>): Promise<{ value: T; urls: string[]; prompts: string[] }> {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const prompts: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(url.toString());
    const prompt = String(JSON.parse(String(init?.body)).contents[0].parts[0].text);
    prompts.push(prompt);
    const item = SET.items.find((i) => prompt.includes(i.transcript));
    if (!item) throw new Error('control fetch: unknown take');
    const control = INCUMBENT_CONTROLS[item.id];
    if (control.status !== 200) return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: control.status });
    const modelVersion = control.modelVersion === undefined ? 'gemini-3.6-flash' : control.modelVersion;
    return new Response(JSON.stringify({
      ...(modelVersion ? { modelVersion } : {}), candidates: [{ content: { parts: [{ text: control.text }] } }], usageMetadata: CONTROL_USAGE,
    }), { status: 200 });
  }) as typeof fetch;
  try {
    return { value: await run(), urls, prompts };
  } finally {
    globalThis.fetch = original;
  }
}

/** The candidate: a scripted double of the closed attempt contract, answering in take order. */
function scriptedCandidate(script: Array<{ status?: number; text?: string; modelVersion?: string | null; unreadable?: boolean; throws?: string; usage?: Record<string, number> }>): CoachingProvider {
  let call = 0;
  return {
    id: 'offline_candidate',
    keyVariable: 'OFFLINE_CANDIDATE_KEY',
    attempt({ onResponse }: ProviderAttemptInput): Promise<ProviderAttemptResult> {
      const step = script[call++];
      if (step.throws) return Promise.reject(new DOMException('transport', step.throws));
      const status = step.status ?? 200;
      const ok = status >= 200 && status < 300;
      onResponse(status, ok ? undefined : null);
      if (!ok) return Promise.resolve({ status, ok, errorCodes: decodeProviderError('{}'), bodyUnreadable: false, answer: null });
      if (step.unreadable) return Promise.resolve({ status, ok, errorCodes: null, bodyUnreadable: true, answer: null });
      return Promise.resolve({
        status, ok, errorCodes: null, bodyUnreadable: false,
        answer: { text: step.text, modelVersion: step.modelVersion === undefined ? 'candidate-model-1' : step.modelVersion, codes: decodeProviderAnswer(step.usage ? { usageMetadata: step.usage } : {}) },
      });
    },
  };
}

Deno.test('the committed set is synthetic, bounded, and every anchor and trap is checked against its transcript', () => {
  assertEquals(SET.items.length, 8);
  assertEquals(SET.items.filter((i) => i.product === 'focus_points').length, 2);
  const mutate = (change: (set: EvaluationSet) => void) => { const copy = structuredClone(evaluationSet) as EvaluationSet; change(copy); return copy; };
  for (const [code, change] of [
    ['EVAL_SET_NOT_SYNTHETIC', (s: EvaluationSet) => { s.provenance = 'customer export'; }],
    ['EVAL_ITEM_ID_INVALID', (s: EvaluationSet) => { s.items[1].id = s.items[0].id; }],
    ['EVAL_ITEM_TRANSCRIPT_TOO_LONG', (s: EvaluationSet) => { s.items[0].transcript = 'word '.repeat(1700); }],
    ['EVAL_ITEM_FOCUS_INVALID', (s: EvaluationSet) => { delete s.items[6].focus; }],
    // An anchor must be a whole word of the transcript: 'date' is not inside 'update'.
    ['EVAL_ITEM_ANCHOR_NOT_IN_TRANSCRIPT', (s: EvaluationSet) => { s.items[0].grounding.anchors = ['date']; }],
    ['EVAL_ITEM_UNSUPPORTED_IN_TRANSCRIPT', (s: EvaluationSet) => { s.items[0].grounding.unsupported = ['\\bchecklist\\b']; }],
  ] as const) {
    assertThrows(() => parseEvaluationSet(mutate(change)), Error, code);
  }
});

Deno.test('the prompt is the handler\'s: transcript inserted once and verbatim, placeholders in a transcript left inert', () => {
  for (const item of SET.items) {
    const prompt = evaluationPrompt(item);
    assertEquals(prompt.split(item.transcript).length, 2, item.id);
    assertEquals(prompt.includes('{{TRANSCRIPT}}') || prompt.includes('{{METRICS}}'), item.id === 'om-05-quotes-and-placeholders', item.id);
    assertEquals(prompt.includes('Focus Points session'), item.product === 'focus_points', item.id);
  }
  // The Focus take with an undetected point carries the handler's rule against saying it was missed.
  const notDetected = evaluationPrompt(SET.items.find((i) => i.id === 'fp-02-point-not-detected')!);
  assertEquals(notDetected.includes('Never say a point was missed'), true);
  assertEquals(notDetected.includes('Filler Words'), true, 'the take\'s chosen delivery signal (filler_rate)');
  assertEquals(notDetected.includes('Words Per Minute'), false);
});

Deno.test('grounding proxies: exact quotes count, invented quotes and unsupported claims are caught, whole-word anchors only', () => {
  const item = SET.items[0];
  assertEquals(measureGrounding(['Naming "the verification email arrives late." helped.', 'x'], item), { quotes: 1, ungroundedQuotes: 0, unsupportedClaim: false, anchored: true });
  assertEquals(measureGrounding(['"We tripled sales" was strong.', 'Add a slide.'], item), { quotes: 1, ungroundedQuotes: 1, unsupportedClaim: true, anchored: false });
  assertEquals(measureGrounding(['Give a quick update.', 'Speak up.'], item).anchored, false, '"update" is not the anchor "setup"');
  assertEquals(measureGrounding(["Don't rush; it's fine to pause.", 'x'], item).quotes, 0, 'apostrophes are not quotes');
  assertEquals(measureGrounding(["Your line 'the first three customers used it' landed.", 'x'], item), { quotes: 1, ungroundedQuotes: 0, unsupportedClaim: false, anchored: false });
});

Deno.test('the incumbent through the REAL Gemini adapter, offline: every outcome class and measure from the synthetic controls', async () => {
  const { value: summary, urls, prompts } = await withControlFetch(() => evaluateProvider(geminiProvider, KEY, SET, 'offline_controls', { runtime: steppedRuntime(50) }));
  assertEquals(urls.length, 8, 'one attempt per take, no retries');
  assertEquals(urls.every((u) => u.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=')), true);
  assertEquals(prompts, SET.items.map(evaluationPrompt), 'the adapter sent exactly the evaluation prompt');
  assertEquals(summary.providerId, 'google_gemini');
  assertEquals(summary.outcomes, { none: 4, invalid_shape: 1, over_character_ceiling: 1, missing_model_version: 1, provider_http_5xx: 1 });
  assertEquals([summary.valid, summary.validRate], [4, 0.5]);
  assertEquals(summary.modelVersions, ['gemini-3.6-flash']);
  // Of the four served: om-01, om-03 and fp-02 are within band; om-02 is a recital.
  assertEquals([summary.withinTargetRate, summary.metricRecitalRate], [0.75, 0.25]);
  assertEquals([summary.quotes, summary.ungroundedQuotes, summary.unsupportedClaimRate, summary.anchoredRate], [2, 1, 0.25, 0.75]);
  assertEquals(summary.latencyMs, { p50: 50, p95: 50, max: 50 });
  // Seven answered takes report usage (the 503 has no answer); with no reviewed price the cost is UNPRICED, never guessed.
  assertEquals(summary.tokens, { prompt: 2800, output: 210, thinking: 140, takesWithUsage: 7 });
  assertEquals(summary.cost, { status: 'UNPRICED', reason: 'no_reviewed_price' });
  assertEquals(summary.records.find((r) => r.id === 'fp-01-points-all-detected')!.status, 503);
});

Deno.test('the candidate through any adapter of the same contract: transport, timeout and malformed bodies are closed outcomes', async () => {
  const valid = (worked: string, next: string) => ({ text: pair(worked, next) });
  const candidate = scriptedCandidate([
    valid('Naming "the verification email arrives late" made the problem concrete.', 'Open with the checklist result before describing the setup delay.'),
    valid('Short concrete sentences about the raised beds sounded confident.', 'Replace each "um" with a silent breath before volunteers.'),
    { throws: 'TypeError' },
    { throws: 'TimeoutError' },
    { unreadable: true },
    { status: 429 },
    // Take 7 is fp-01 (the clinic): the answer must be about that transcript to count as anchored.
    valid('Stating the problem first made the online booking story clear.', 'Pause after the result, then introduce the text reminders plan.'),
    { text: 'not json at all' },
  ]);
  const summary = await evaluateProvider(candidate, KEY, SET, 'offline_controls', { runtime: steppedRuntime(80) });
  assertEquals(summary.outcomes, { none: 3, provider_transport: 1, provider_timeout: 1, provider_malformed_response: 1, provider_http_4xx: 1, invalid_shape: 1 });
  assertEquals(summary.modelVersions, ['candidate-model-1']);
  assertEquals([summary.withinTargetRate, summary.anchoredRate, summary.unsupportedClaimRate], [1, 1, 0]);
});

Deno.test('cost: reported tokens times a reviewed price; UNKNOWN when an answered take reports no usage; a bad price is refused', async () => {
  const { value: priced } = await withControlFetch(() => evaluateProvider(geminiProvider, KEY, SET, 'offline_controls', { runtime: steppedRuntime(50), price: CONTROL_PRICE }));
  // 7 answered x (400 x $1 + 30 x $2 + 20 x $2) per million = $0.0035; over 8 takes = $0.0004375 per take.
  // Served-only: the same $0.0035 over the 4 takes that produced coaching.
  assertEquals(priced.cost, { status: 'ESTIMATED', usdTotal: 0.0035, usdPerTake: 0.0004375, usdPerServedTake: 0.000875 });
  const noUsage = await evaluateProvider(scriptedCandidate(SET.items.map(() => ({ text: pair('a b c d e f g h', 'a b c d e f g h') }))), KEY, SET, 'offline_controls', { price: CONTROL_PRICE });
  assertEquals(noUsage.cost, { status: 'UNKNOWN', reason: 'usage_not_reported' });
  assertThrows(() => estimateCost(priced.records, { ...CONTROL_PRICE, outputUsdPerMillion: -1 }), Error, 'EVAL_PRICE_INVALID');
  assertThrows(() => estimateCost(priced.records, { ...CONTROL_PRICE, inputUsdPerMillion: Number.NaN }), Error, 'EVAL_PRICE_INVALID');
});

Deno.test('comparison: same set and mode only; differences, never a verdict', async () => {
  const { value: incumbent } = await withControlFetch(() => evaluateProvider(geminiProvider, KEY, SET, 'offline_controls', { runtime: steppedRuntime(50), price: CONTROL_PRICE }));
  const allValid = SET.items.map(() => ({
    text: pair('Naming the checklist result first made the update concrete.', 'Open with one number, then the next step for setup.'),
    usage: { promptTokenCount: 400, candidatesTokenCount: 40 },
  }));
  const candidate = await evaluateProvider(scriptedCandidate(allValid), KEY, SET, 'offline_controls', { runtime: steppedRuntime(100), price: CONTROL_PRICE });
  const diff = compareSummaries(incumbent, candidate);
  // Candidate: 8 x (400 x $1 + 40 x $2) per million / 8 = $0.00048 per take, vs the incumbent's $0.0004375.
  assertEquals([diff.validRate, diff.latencyP50Ratio, diff.costPerTakeUsd], [0.5, 2, 0.0000425]);
  assertEquals(Object.keys(diff).includes('adopt'), false, 'adoption is the PO\'s bar, not the evaluator\'s');
  assertThrows(() => compareSummaries(incumbent, { ...candidate, setDigest: 'other' }), Error, 'EVAL_COMPARE_DIFFERENT_SETS');
  assertThrows(() => compareSummaries(incumbent, { ...candidate, mode: 'live' }), Error, 'EVAL_COMPARE_DIFFERENT_MODES');
});

Deno.test('PRIVACY: a report carries no transcript, phrase, prompt or key', async () => {
  const { value: summary } = await withControlFetch(() => evaluateProvider(geminiProvider, KEY, SET, 'offline_controls', { runtime: steppedRuntime(50) }));
  const report = JSON.stringify(summary);
  assertEquals(report.includes(KEY), false);
  for (const item of SET.items) assertEquals(report.includes(item.transcript.slice(0, 24)), false, item.id);
  for (const control of Object.values(INCUMBENT_CONTROLS)) {
    if (!control.text) continue;
    for (const phrase of Object.values(JSON.parse(control.text) as Record<string, unknown>)) {
      if (typeof phrase === 'string' && phrase.length > 20) assertEquals(report.includes(phrase), false);
    }
  }
  assertEquals(report.includes('expert public speaking coach'), false, 'no prompt text');
});

/**
 * Independent review of 1c83108c (2026-11-08): defects in the measures, each reproduced before the fix.
 */
Deno.test('REVIEW P2: a short quoted filler does not break quote pairing, and both quotes are grounded', () => {
  const item = SET.items.find((i) => i.id === 'om-02-filler-heavy')!;
  // Before: "um" was too short to match, so ' for a pause before ' was taken as one invented quote.
  assertEquals(measureGrounding(['Swap "um" for a pause before "raised beds" next time.', 'x'], item),
    { quotes: 2, ungroundedQuotes: 0, unsupportedClaim: false, anchored: true });
});

Deno.test('REVIEW P3: quotes with an inner apostrophe, and curly single quotes, are counted', () => {
  const item = SET.items[0];
  assertEquals(measureGrounding(["Your line 'that's my update' closed it.", 'x'], item).quotes, 1);
  assertEquals(measureGrounding(['Your line ‘that’s my update’ closed it.', 'x'], item), { quotes: 1, ungroundedQuotes: 0, unsupportedClaim: false, anchored: false });
  assertEquals(measureGrounding(["Don't rush; it's fine to pause.", 'x'], item).quotes, 0, 'apostrophes alone are still not quotes');
});

Deno.test('REVIEW P3: a quote is grounded only by whole words of the transcript', () => {
  const item = SET.items.find((i) => i.id === 'om-02-filler-heavy')!;
  // Before: "ate" counted as grounded because "watering" contains it.
  assertEquals(measureGrounding(['You said "ate" twice.', 'x'], item).ungroundedQuotes, 1);
  assertEquals(measureGrounding(['You said "watering schedule" clearly.', 'x'], item).ungroundedQuotes, 0);
});

Deno.test('REVIEW P3: speed and cost are also reported over served takes, so failing everything is not "faster"', async () => {
  const { value: incumbent } = await withControlFetch(() => evaluateProvider(geminiProvider, KEY, SET, 'offline_controls', { runtime: steppedRuntime(100), price: CONTROL_PRICE }));
  const failing = await evaluateProvider(scriptedCandidate(SET.items.map(() => ({ status: 429 }))), KEY, SET, 'offline_controls', { runtime: steppedRuntime(1), price: CONTROL_PRICE });
  assertEquals(failing.servedLatencyMs, null, 'no served take, no served latency');
  const diff = compareSummaries(incumbent, failing);
  assertEquals([diff.validRate, diff.servedLatencyP50Ratio, diff.costPerServedTakeUsd], [-0.5, null, null]);
  // 7 answered x $0.0005 = $0.0035 over 4 served takes.
  assertEquals(incumbent.cost.status === 'ESTIMATED' ? incumbent.cost.usdPerServedTake : 'not estimated', 0.000875);
});

Deno.test('REVIEW P3: a model id that is not a safe id never reaches the report', async () => {
  const leaked = 'transcript text pretending to be a model id';
  const summary = await evaluateProvider(scriptedCandidate(SET.items.map(() => ({ text: pair('a b c d e f g h', 'a b c d e f g h'), modelVersion: leaked }))), KEY, SET, 'offline_controls');
  assertEquals(JSON.stringify(summary).includes(leaked), false);
  assertEquals(summary.outcomes, { missing_model_version: 8 }, 'an unsafe id is treated as absent, as the handler does');
});

Deno.test('REVIEW P3: an unreadable body that still carries a valid answer is classified as the handler does', () => {
  const result = { status: 200, ok: true, errorCodes: null, bodyUnreadable: true,
    answer: { text: pair('Naming the checklist result first made the update concrete.', 'Open with one number, then the next step for setup.'), modelVersion: 'm-1', codes: decodeProviderAnswer({}) } };
  assertEquals(outcomeOf(result, false).outcome, 'none');
});

Deno.test('REVIEW: Focus point shapes are validated, so a malformed point cannot produce a prompt the handler would not', () => {
  const mutate = (change: (set: EvaluationSet) => void) => { const copy = structuredClone(evaluationSet) as EvaluationSet; change(copy); return copy; };
  for (const change of [
    (s: EvaluationSet) => { (s.items[6].focus!.points[0] as Record<string, unknown>).detectedAtSeconds = '4'; },
    (s: EvaluationSet) => { (s.items[6].focus!.points[0] as Record<string, unknown>).verdict = 'maybe'; },
    (s: EvaluationSet) => { (s.items[6].focus!.points[0] as Record<string, unknown>).label = 7; },
    (s: EvaluationSet) => { s.items[6].focus!.points = []; },
  ]) assertThrows(() => parseEvaluationSet(mutate(change)), Error, 'EVAL_ITEM_FOCUS_INVALID');
});

Deno.test('RE-REVIEW of e1120368 (R2): a present quote is grounded despite edge punctuation or non-ASCII letters', () => {
  const om02 = SET.items.find((i) => i.id === 'om-02-filler-heavy')!;
  assertEquals(measureGrounding(['You open with "...the kids eat lunch" and it lands.', 'x'], om02).ungroundedQuotes, 0);
  assertEquals(measureGrounding(['Replace "um. " with a breath.', 'x'], om02).ungroundedQuotes, 0);
  const cafe = { ...om02, transcript: 'Order a café au lait before the talk.', grounding: { anchors: ['café'], unsupported: [] } };
  assertEquals(measureGrounding(['Saying "café" twice was warm.', 'x'], cafe), { quotes: 1, ungroundedQuotes: 0, unsupportedClaim: false, anchored: true });
  // Whole words still: an accented word inside a longer one does not ground it.
  assertEquals(measureGrounding(['You said "caf" quickly.', 'x'], cafe).ungroundedQuotes, 1);
});

Deno.test("RE-REVIEW of e1120368 (R1): a one-letter single-quoted span such as rock 'n' roll is not a quote", () => {
  assertEquals(measureGrounding(["Keep the rock 'n' roll energy.", 'x'], SET.items[0]).quotes, 0);
});
