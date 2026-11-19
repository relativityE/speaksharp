import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decodeProviderAnswer } from '../providerDecode.ts';
import type { CoachingProvider, ProviderAttemptInput, ProviderAttemptResult } from '../providers/types.ts';
import evaluationSet from './transcripts.json' with { type: 'json' };
import { type EvaluationItem, evaluateItem, evaluationPrompt, type EvaluatorRuntime, type ItemRecord, parseEvaluationSet } from './evaluator.ts';

/**
 * #1816 SYNTHETIC COACHING BOT CHECKS, layer L1 (handback/1816-coaching-bot-test-plan-2026-11-17.md): grounding (C1, C2, C3,
 * C7, C8) and wrong-take (C5). Each check runs through the REAL evaluator path (`evaluateItem`: the handler's prompt, its validity
 * gate and its quality measure) with a scripted provider. Every answer below is a SYNTHETIC CONTROL written for one check; none is
 * model output, and nothing here makes a network call or needs a key.
 *
 * A check counts only when it has been seen to PASS on a correct answer AND to FAIL on its injected fault.
 * Grounding is judged by the evaluator's stated deterministic PROXIES, not a semantic judge.
 */
const SET = parseEvaluationSet(evaluationSet);
const KEY = 'offline-control-key-not-a-secret';
const item = (id: string): EvaluationItem => SET.items.find((i) => i.id === id)!;
const runtime: EvaluatorRuntime = { now: (() => { let t = 0; return () => (t += 5); })(), timeout: () => new AbortController().signal };

const pair = (what_worked: string, what_to_try_next: string, version = 'gemini_coaching_v1') =>
  JSON.stringify({ version, what_worked, what_to_try_next });

/** A correct, grounded answer per take: specific to its own transcript, no unsupported claims, an exact quote where it quotes. */
const CORRECT: Record<string, string> = {
  'om-01-team-update': pair('Leading with the new onboarding checklist result made the update clear.', 'Name the verification delay before asking for setup help.'),
  'om-02-filler-heavy': pair('The raised beds and volunteers made the garden project feel real.', 'Replace each filler with a silent pause before key points.'),
  'om-03-fast-pitch': pair('Opening with renters arguing over the electric bill hooked attention fast.', 'Slow down when you share the pilot results on late payments.'),
  'om-04-too-short': pair('Saying you were testing the microphone set clear expectations.', 'Record a full practice take so there is something to coach.'),
  'om-05-quotes-and-placeholders': pair('Your grandmother\'s "measure twice, cut once" gave the contract point weight.', 'Read the lease date out loud before moving to rent.'),
  'om-06-long-structure': pair('Covering why the evening hours changed first gave the library talk structure.', 'Close by naming the parking lot lights request to the city.'),
  'fp-01-points-all-detected': pair('Stating the problem with the phone line first set up online booking.', 'Give one number showing morning calls dropped after March.', 'gemini_coaching_focus_v1'),
  'fp-02-point-not-detected': pair('Explaining that glass now goes in the blue bin was very clear.', 'Add one sentence on why the plant now sorts the glass.', 'gemini_coaching_focus_v1'),
};

/** A provider double of the closed attempt contract that answers each take from `answers`, keyed by the take its prompt carries. */
function scripted(answers: Record<string, string>): CoachingProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: 'offline_bot_check',
    keyVariable: 'OFFLINE_BOT_CHECK_KEY',
    prompts,
    attempt({ prompt, onResponse }: ProviderAttemptInput): Promise<ProviderAttemptResult> {
      prompts.push(prompt);
      const take = SET.items.find((i) => prompt.includes(i.transcript));
      if (!take) throw new Error('scripted provider: unknown take');
      onResponse(200, undefined);
      return Promise.resolve({
        status: 200, ok: true, errorCodes: null, bodyUnreadable: false,
        answer: { text: answers[take.id] ?? CORRECT[take.id], modelVersion: 'offline-bot-model-1', codes: decodeProviderAnswer({}) },
      });
    },
  };
}

type Verdict = { verdict: 'PASS' | 'FAIL'; why: string[] };
const verdict = (why: string[]): Verdict => ({ verdict: why.length ? 'FAIL' : 'PASS', why });

/** C7: the take was served with both advice sections (the handler's own validity gate) and no number recital. */
function servedBothSections(r: ItemRecord): Verdict {
  if (r.outcome !== 'none' || !r.grounding || !r.quality) return verdict([`not served: ${r.outcome}`]);
  return verdict(r.quality.metric_recital ? ['metric recital as advice'] : []);
}

/** C1 / C2 / C8: grounding proxies on a served pair: no unsupported claim, no invented quote, anchored to this take. */
function grounded(r: ItemRecord): Verdict {
  if (r.outcome !== 'none' || !r.grounding) return verdict([`not served: ${r.outcome}`]);
  const why: string[] = [];
  if (r.grounding.unsupportedClaim) why.push('unsupported claim');
  if (r.grounding.ungroundedQuotes > 0) why.push(`${r.grounding.ungroundedQuotes} invented quote(s)`);
  if (!r.grounding.anchored) why.push('not anchored to this take');
  return verdict(why);
}

const STOP = new Set(['it', 'the', 'a', 'an', 'to', 'of', 'and', 'with', 'do', 'is']);
const stem = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').replace(/s$/, '');
/**
 * C3 proxy: praise of a point the matcher did NOT detect. `what_worked` FAILs when it carries every content word (stemmed) of a
 * not-detected label, e.g. "why" and "change" for "Why it changes". Suggesting the point in `what_to_try_next` is allowed.
 */
function noPraiseForUndetected(take: EvaluationItem, answerText: string): Verdict {
  const worked = new Set((JSON.parse(answerText).what_worked as string).split(/\s+/).map(stem));
  const praised = (take.focus?.points ?? []).filter((p) => p.verdict === 'not_detected')
    .filter((p) => p.label.split(/\s+/).filter((w) => !STOP.has(w.toLowerCase())).map(stem).every((w) => [...worked].some((x) => x.startsWith(w))));
  return verdict(praised.map((p) => `what_worked praises the undetected point "${p.label}"`));
}

/** C5: the pair is about THIS take. FAIL when it is anchored only to another take's anchors (a cross-wired answer). */
function ownTake(take: EvaluationItem, r: ItemRecord, answerText: string): Verdict {
  if (r.outcome !== 'none') return verdict([`not served: ${r.outcome}`]);
  const parsed = JSON.parse(answerText) as { what_worked: string; what_to_try_next: string };
  const phrases = [parsed.what_worked, parsed.what_to_try_next];
  const hasAnchor = (anchor: string, text: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
  const anchoredTo = (other: EvaluationItem, text = phrases.join(' ')) =>
    other.grounding.anchors.some((anchor) => hasAnchor(anchor, text));
  const others = SET.items.filter((o) => o.id !== take.id && anchoredTo(o)).map((o) => o.id);
  if (anchoredTo(take)) {
    // Each field can be cross-wired independently. A correct praise line cannot
    // lend its grounding to a next step that's exclusively about another fixture.
    const crossed = Object.entries({ what_worked: parsed.what_worked, what_to_try_next: parsed.what_to_try_next }).flatMap(([field, text]) => {
      if (anchoredTo(take, text)) return [];
      const wrongTakes = SET.items.filter((o) => o.id !== take.id && o.grounding.anchors.some((anchor) =>
        hasAnchor(anchor, text) && !hasAnchor(anchor, take.transcript))).map((o) => o.id);
      return wrongTakes.length ? [`${field} is anchored only to another take (${wrongTakes.join(', ')})`] : [];
    });
    return verdict(crossed);
  }
  return verdict([others.length ? `anchored to another take (${others.join(', ')}), not this one` : 'not anchored to any take']);
}

const run = async (answers: Record<string, string>, id: string) => {
  const provider = scripted(answers);
  const record = await evaluateItem(provider, KEY, item(id), runtime);
  return { record, prompts: provider.prompts, text: answers[id] ?? CORRECT[id] };
};

const log = (check: string, fixture: string, control: Verdict, fault: Verdict) =>
  console.log(`#1816_BOT_CHECK ${JSON.stringify({ check, fixture, control: control.verdict, fault: fault.verdict, faultCaughtBy: fault.why })}`);

Deno.test('#1816 bot checks: every correct control answer is served, grounded and about its own take (all 8 fixtures)', async () => {
  for (const take of SET.items) {
    const { record, prompts } = await run({}, take.id);
    assertEquals(prompts.length, 1, `${take.id}: one attempt`);
    assertEquals(prompts[0], evaluationPrompt(take), `${take.id}: the handler's prompt`);
    assertEquals(servedBothSections(record), verdict([]), take.id);
    assertEquals(grounded(record), verdict([]), take.id);
    assertEquals(ownTake(take, record, CORRECT[take.id]), verdict([]), take.id);
  }
});

Deno.test('#1816 C1 unsupported advice: slides and an invented quote on a garden talk are caught', async () => {
  const id = 'om-02-filler-heavy';
  const control = grounded((await run({}, id)).record);
  const fault = grounded((await run({ [id]: pair('Your slides were clear and "we doubled the garden" landed well.', 'Pause silently before naming the raised beds.') }, id)).record);
  log('C1 unsupported advice (G)', id, control, fault);
  assertEquals(control.verdict, 'PASS');
  assertEquals(fault.verdict, 'FAIL');
  assertEquals(fault.why, ['unsupported claim', '1 invented quote(s)']);
});

Deno.test('#1816 C2 Focus fit, full: "you missed the results point" on a 3 of 3 take is caught', async () => {
  const id = 'fp-01-points-all-detected';
  const control = grounded((await run({}, id)).record);
  const fault = grounded((await run({ [id]: pair('You missed the results point about morning calls.', 'Add the result before talking about online booking.', 'gemini_coaching_focus_v1') }, id)).record);
  log('C2 Focus fit, full (F)', id, control, fault);
  assertEquals(control.verdict, 'PASS');
  assertEquals(fault.verdict, 'FAIL');
  assertEquals(fault.why, ['unsupported claim']);
});

Deno.test('#1816 C3 Focus fit, partial: the prompt marks "Why it changes" not detected, and praising it is caught', async () => {
  const id = 'fp-02-point-not-detected';
  const { prompts } = await run({}, id);
  // The handler's prompt carries the point as not detected, with its rule against calling it missed.
  assertEquals(/Why it changes[^\n]*not detected by the keyword matcher/.test(prompts[0]), true);
  assertEquals(prompts[0].includes('Never say a point was missed'), true);
  const control = noPraiseForUndetected(item(id), CORRECT[id]);
  const faultText = pair('Explaining why the recycling rules change made the reason clear.', 'Say what to do with old crates at the depot.', 'gemini_coaching_focus_v1');
  const fault = noPraiseForUndetected(item(id), faultText);
  // The praise fault is otherwise well grounded: only C3 catches it.
  assertEquals(grounded((await run({ [id]: faultText }, id)).record).verdict, 'PASS');
  log('C3 Focus fit, partial (F)', id, control, fault);
  assertEquals(control.verdict, 'PASS');
  assertEquals(fault.verdict, 'FAIL');
});

Deno.test('#1816 C5 wrong-session tips: a cross-wired answer (om-01\'s pair served for om-03) is caught', async () => {
  const id = 'om-03-fast-pitch';
  const control = ownTake(item(id), (await run({}, id)).record, CORRECT[id]);
  const crossed = await run({ [id]: CORRECT['om-01-team-update'] }, id);
  const fault = ownTake(item(id), crossed.record, crossed.text);
  log('C5 wrong-session tips (S, swap)', id, control, fault);
  assertEquals(control.verdict, 'PASS');
  assertEquals(fault.verdict, 'FAIL');
  assertEquals(fault.why.length, 1);
  assertEquals(/^anchored to another take \(.*om-01-team-update.*\), not this one$/.test(fault.why[0]), true);
  // The swap, every way round among the six Open Mic takes: each crossed answer is caught.
  const openMic = SET.items.filter((i) => i.product === 'open_mic');
  let caught = 0;
  for (const target of openMic) {
    for (const source of openMic) {
      if (source.id === target.id) continue;
      const swapped = await run({ [target.id]: CORRECT[source.id] }, target.id);
      if (ownTake(target, swapped.record, swapped.text).verdict === 'FAIL') caught += 1;
    }
  }
  console.log(`#1816_BOT_CHECK ${JSON.stringify({ check: 'C5 swap matrix', fixture: 'om-01..06', crossedPairs: 30, caught })}`);
  assertEquals(caught, 30);
});

Deno.test('#1905 wrong-take coaching fails when only one advice section is cross-wired', async () => {
  for (const id of ['om-03-fast-pitch', 'fp-02-point-not-detected']) {
    const current = JSON.parse(CORRECT[id]);
    const foreign = JSON.parse(CORRECT['om-01-team-update']);
    const good = await run({}, id);
    assertEquals(ownTake(item(id), good.record, good.text).verdict, 'PASS');
    for (const field of ['what_worked', 'what_to_try_next']) {
      const mixed = JSON.stringify({ ...current, [field]: foreign[field] });
      const output = await run({ [id]: mixed }, id);
      assertEquals(ownTake(item(id), output.record, output.text).verdict, 'FAIL', `${id} ${field}: advice from the other take`);
    }
  }
});

Deno.test('#1816 C7 both advice sections: a one-section answer is refused and a number recital is flagged', async () => {
  const id = 'om-01-team-update';
  const control = servedBothSections((await run({}, id)).record);
  const oneSection = await run({ [id]: JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'Leading with the onboarding checklist was clear.' }) }, id);
  const recital = await run({ [id]: pair('The onboarding checklist update was easy to follow.', 'You used 12 fillers.') }, id);
  const faultShape = servedBothSections(oneSection.record);
  const faultRecital = servedBothSections(recital.record);
  log('C7 both sections (W, A): one section', id, control, faultShape);
  log('C7 both sections (W, A): metric recital', id, control, faultRecital);
  assertEquals(control.verdict, 'PASS');
  assertEquals(faultShape, verdict(['not served: invalid_shape']));
  assertEquals(faultRecital, verdict(['metric recital as advice']));
});

Deno.test('#1816 C8 thin take: invented praise of a conclusion and a story on a microphone test is caught', async () => {
  const id = 'om-04-too-short';
  const control = grounded((await run({}, id)).record);
  const fault = grounded((await run({ [id]: pair('Your strong conclusion tied the whole story together well.', 'Keep that same confident energy in your next talk.') }, id)).record);
  log('C8 thin take', id, control, fault);
  assertEquals(control.verdict, 'PASS');
  assertEquals(fault.verdict, 'FAIL');
  assertEquals(fault.why, ['unsupported claim', 'not anchored to this take']);
});
