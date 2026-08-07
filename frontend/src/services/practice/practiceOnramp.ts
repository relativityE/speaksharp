/**
 * #1116 — Session-page on-ramp content: removes the "blank page" friction when a user reaches the
 * session page and doesn't know what to say or how to test the product.
 *
 * Two optional aids (never required, never scored):
 *  - SPEAKING_PROMPTS  → "Give me a prompt": short original speaking starters.
 *  - SAMPLE_PASSAGES   → "Let me test with a sample": a 30–45s complete PUBLIC-DOMAIN passage to read aloud
 *    so a first-timer can try the product without composing anything.
 *
 * COPYRIGHT: sample passages are PUBLIC DOMAIN only (pre-1929 / U.S. government works). Do NOT add
 * modern copyrighted speeches (MLK, Churchill, JFK, etc.). Keep each read in 30–45s (~70–105 words); curated set = one ~45s + two ~30s.
 * Internal identifiers are function-based (no product name) per the naming boundary (STT.md).
 */

export const PRACTICE_FOCUS_OPTIONS = [
  { id: 'just-practice', label: 'Just practice' },
  { id: 'concise', label: 'Be more concise' },
  { id: 'fillers', label: 'Reduce filler words' },
  { id: 'pace', label: 'Keep a steady pace' },
  { id: 'clarity', label: 'Deliver clearly' },
] as const;
export type PracticeFocus = (typeof PRACTICE_FOCUS_OPTIONS)[number]['id'];

/** Optional speaking starters (#1116). Never become required points, agendas, or coverage checks. */
export const SPEAKING_PROMPTS = [
  { id: 'recent-work', text: 'Explain something you worked on recently: what it was, why it mattered, and what happened next.' },
  { id: 'short-update', text: 'Give a short update: main point, current status, and next step.' },
  { id: 'recent-decision', text: 'Describe a recent decision and why you made it.' },
  { id: 'familiar-process', text: 'Explain a familiar process to someone new.' },
  { id: 'teach-an-idea', text: 'Teach one idea using a simple example.' },
] as const;
export type SpeakingPromptId = (typeof SPEAKING_PROMPTS)[number]['id'];

/**
 * 30–45 second read-aloud samples for "Let me test with a sample". PUBLIC DOMAIN ONLY.
 * `estSeconds` is an approximate read time at a relaxed ~140 wpm; keep every passage in [30, 45].
 */
export const SAMPLE_PASSAGES = [
  {
    id: 'man-in-the-arena',
    title: 'The Man in the Arena',
    attribution: 'Theodore Roosevelt, 1910 · public domain',
    estSeconds: 45,
    text:
      'It is not the critic who counts; not the man who points out how the strong man stumbles, or where ' +
      'the doer of deeds could have done them better. The credit belongs to the man who is actually in ' +
      'the arena, whose face is marred by dust and sweat and blood; who strives valiantly; who errs, who ' +
      'comes short again and again; but who does actually strive to do the deeds; who spends himself in a ' +
      'worthy cause; who at the best knows the triumph of high achievement.',
  },
  {
    id: 'nothing-to-fear',
    title: '"The only thing we have to fear…"',
    attribution: 'Franklin D. Roosevelt, 1933 · public domain',
    estSeconds: 30,
    text:
      'This is preeminently the time to speak the truth, the whole truth, frankly and boldly. So, first of ' +
      'all, let me assert my firm belief that the only thing we have to fear is fear itself — nameless, ' +
      'unreasoning, unjustified terror which paralyzes needed efforts to convert retreat into advance.',
  },
  {
    id: 'give-me-liberty',
    title: '"Give me liberty, or give me death"',
    attribution: 'Patrick Henry, 1775 · public domain',
    estSeconds: 32,
    text:
      'Gentlemen may cry, peace, peace — but there is no peace. The war is actually begun! The next gale ' +
      'that sweeps from the north will bring to our ears the clash of resounding arms! Why stand we here ' +
      'idle? Is life so dear, or peace so sweet, as to be purchased at the price of chains and slavery? ' +
      'Forbid it, Almighty God! Give me liberty, or give me death!',
  },
] as const;
export type SamplePassageId = (typeof SAMPLE_PASSAGES)[number]['id'];

export function getNextPrompt(currentIndex: number | null): { index: number; prompt: (typeof SPEAKING_PROMPTS)[number] } {
  const index = currentIndex === null ? 0 : (currentIndex + 1) % SPEAKING_PROMPTS.length;
  return { index, prompt: SPEAKING_PROMPTS[index] };
}

export function getNextSample(currentIndex: number | null): { index: number; sample: (typeof SAMPLE_PASSAGES)[number] } {
  const index = currentIndex === null ? 0 : (currentIndex + 1) % SAMPLE_PASSAGES.length;
  return { index, sample: SAMPLE_PASSAGES[index] };
}

export function resolvePracticeFocus(value: string | null | undefined): PracticeFocus {
  return PRACTICE_FOCUS_OPTIONS.some((o) => o.id === value) ? (value as PracticeFocus) : 'just-practice';
}
