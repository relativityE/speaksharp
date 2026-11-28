import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  classifyOmission, FOCUS_SAFE_TEMPLATES, guardFocusOmission, isServableOmissionForm, type FocusGuardPoint,
} from './focusOmissionGuard.ts';

// The live J3.b classifier's own corpus labels (tests/unit/rwtCoachingConsistency1258.test.ts).
const LABELS = ['Money-back guarantee', 'Launch date', 'Pricing tiers'];
const POINTS: FocusGuardPoint[] = [
  { label: 'Money-back guarantee', verdict: 'detected' },
  { label: 'Launch date', verdict: 'detected' },
  { label: 'Pricing tiers', verdict: 'not_detected' },
];
const WELL = 'Clear opening with a steady pace.';

Deno.test('every omission phrase family the live classifier FAILs is flagged, with the same form', () => {
  const pastClaims = ['You missed the money-back guarantee.', 'The launch date was not mentioned.', "You didn't cover the pricing tiers.",
    'You left it out at the end.', 'You forgot the guarantee.', 'The guarantee went unmentioned.', 'You skipped your strongest point.',
    'You never mentioned the guarantee.', 'The launch date was never covered.', "You haven't mentioned the launch date.",
    'The pricing tiers have not been covered.', 'The guarantee has never been addressed.', 'You skipped every point.',
    'You omitted the pricing tiers.', 'The launch date was overlooked.', 'You did not get to the pricing tiers.'];
  for (const next of pastClaims) assertEquals({ next, form: classifyOmission(next, LABELS) }, { next, form: 'past_claim' });
  assertEquals(classifyOmission("Don't skip the guarantee next time.", LABELS), 'implied_point');
  assertEquals(classifyOmission('Never forget the launch date.', LABELS), 'implied_point');
  assertEquals(classifyOmission('The pricing tiers are still missing.', LABELS), 'present_point');
  assertEquals(classifyOmission('The missing guarantee needs a mention.', LABELS), 'present_point');
  for (const form of ['past_claim', 'implied_point', 'present_point', 'ambiguous', 'unknown_point'] as const) {
    assertEquals(isServableOmissionForm(form), false, form);
  }
});

Deno.test('ambiguous omission wording (a HOLD in the live row) is also not servable', () => {
  for (const next of ['No chosen point was overlooked.', 'You are missing one of your chosen points.', 'Leaving out the launch date weakens the close.']) {
    assertEquals({ next, form: classifyOmission(next, LABELS) }, { next, form: 'ambiguous' });
  }
});

Deno.test('allowed phrasings pass: clarity, prominence, placement, signposting, pace, and omission words not about a point', () => {
  for (const next of ['Make point 2 clearer by naming it before you explain it.', 'Signpost your third point earlier.',
    'Name the guarantee early so it is unmistakable.', 'Pause before the launch date so it lands.',
    'Move the pricing tiers earlier and give them their own pause.', 'Slow down between the launch date and the pricing tiers.',
    'Skip the filler words between points.', 'Avoid skipping transitions.']) {
    assertEquals({ next, servable: isServableOmissionForm(classifyOmission(next, LABELS)) }, { next, servable: true });
  }
});

Deno.test('an omission claim is replaced in its own field only; the other phrase is kept exactly', () => {
  const next = 'Make the pricing tiers clearer with a signpost.';
  const guarded = guardFocusOmission({ version: 'gemini_coaching_focus_v1', what_worked: 'You skipped the pricing tiers but the opening was clear.', what_to_try_next: next }, POINTS);
  assertEquals(guarded.replaced, ['what_worked']);
  assertEquals(guarded.forms, { what_worked: 'past_claim', what_to_try_next: 'none' });
  assertEquals(guarded.suggestions.what_to_try_next, next);
  assertEquals(guarded.suggestions.version, 'gemini_coaching_focus_v1');
  assertEquals(guarded.suggestions.what_worked, 'Your point "Money-back guarantee" came through clearly enough to be detected.');
  assertEquals(isServableOmissionForm(classifyOmission(`${guarded.suggestions.what_worked}. ${guarded.suggestions.what_to_try_next}`, LABELS)), true);
});

Deno.test('the live J3.b failure shape: a past-tense omission claim in "what to try next" names the open point instead', () => {
  const guarded = guardFocusOmission({ what_worked: WELL, what_to_try_next: 'You never got to the pricing tiers; open with them.' }, POINTS);
  assertEquals(guarded.replaced, ['what_to_try_next']);
  assertEquals(guarded.suggestions.what_worked, WELL);
  assertEquals(guarded.suggestions.what_to_try_next, 'Signpost "Pricing tiers" clearly as you reach it.');
  assertEquals(classifyOmission(guarded.suggestions.what_to_try_next, LABELS), 'none');
});

Deno.test('a clean pair is returned unchanged (same object, nothing replaced)', () => {
  const pair = { what_worked: WELL, what_to_try_next: 'Signpost the pricing tiers earlier.' };
  const guarded = guardFocusOmission(pair, POINTS);
  assertEquals(guarded.replaced, []);
  assertEquals(guarded.suggestions === pair, true);
});

Deno.test('a label with omission wording, sentence punctuation or excess length never enters a replacement', () => {
  for (const label of ["Don't skip the refund window", 'Missing parts. Then the fix', 'x'.repeat(61)]) {
    const points: FocusGuardPoint[] = [{ label, verdict: 'detected' }, { label, verdict: 'not_detected' }];
    const guarded = guardFocusOmission({ what_worked: 'You forgot nothing important here and skipped it.', what_to_try_next: 'You missed it.' }, points);
    assertEquals(guarded.replaced, ['what_worked', 'what_to_try_next']);
    assertEquals(guarded.suggestions, { what_worked: FOCUS_SAFE_TEMPLATES.what_worked, what_to_try_next: FOCUS_SAFE_TEMPLATES.what_to_try_next });
  }
});

Deno.test('the label-free templates are themselves servable, distinct and within the soft length target band', () => {
  for (const labels of [LABELS, ['Mission statement'], []]) {
    for (const text of Object.values(FOCUS_SAFE_TEMPLATES)) assertEquals(isServableOmissionForm(classifyOmission(text, labels)), true, text);
  }
  assertNotEquals(FOCUS_SAFE_TEMPLATES.what_worked, FOCUS_SAFE_TEMPLATES.what_to_try_next);
  for (const text of Object.values(FOCUS_SAFE_TEMPLATES)) {
    const words = text.trim().split(/\s+/).length;
    assertEquals(words >= 8 && words <= 10, true, text);
  }
});
