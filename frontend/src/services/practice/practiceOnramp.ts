/**
 * #1116 — Session-page on-ramp content: removes the "blank page" friction when a user reaches the
 * session page and doesn't know what to say or how to test the product.
 *
 * Two optional aids (never required, never scored):
 *  - SPEAKING_PROMPTS  → "Give me a prompt": short original speaking starters.
 *  - SAMPLE_PASSAGES   → "Let me test with a sample": a ≤1-minute PUBLIC-DOMAIN passage to read aloud
 *    so a first-timer can try the product without composing anything.
 *
 * COPYRIGHT: sample passages are PUBLIC DOMAIN only (pre-1929 / U.S. government works). Do NOT add
 * modern copyrighted speeches (MLK, Churchill, JFK, etc.). Keep each read ≤ ~1 minute (~150 words).
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
 * ≤1-minute read-aloud samples for "Let me test with a sample". PUBLIC DOMAIN ONLY.
 * `estSeconds` is an approximate read time at a relaxed ~140 wpm.
 */
export const SAMPLE_PASSAGES = [
  {
    id: 'gettysburg',
    title: 'The Gettysburg Address',
    attribution: 'Abraham Lincoln, 1863 · public domain',
    estSeconds: 60,
    text:
      'Four score and seven years ago our fathers brought forth on this continent a new nation, ' +
      'conceived in liberty, and dedicated to the proposition that all men are created equal. ' +
      'Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived ' +
      'and so dedicated, can long endure. It is for us the living, rather, to be dedicated here to the ' +
      'unfinished work which they who fought here have thus far so nobly advanced — that this nation, ' +
      'under God, shall have a new birth of freedom, and that government of the people, by the people, ' +
      'for the people, shall not perish from the earth.',
  },
  {
    id: 'hamlet-soliloquy',
    title: 'Hamlet — "To be, or not to be"',
    attribution: 'William Shakespeare · public domain',
    estSeconds: 45,
    text:
      'To be, or not to be, that is the question: whether ’tis nobler in the mind to suffer ' +
      'the slings and arrows of outrageous fortune, or to take arms against a sea of troubles ' +
      'and by opposing end them. To die — to sleep, no more; and by a sleep to say we end ' +
      'the heart-ache and the thousand natural shocks that flesh is heir to: ’tis a consummation ' +
      'devoutly to be wished.',
  },
  {
    id: 'declaration',
    title: 'The Declaration of Independence',
    attribution: 'United States, 1776 · public domain',
    estSeconds: 40,
    text:
      'We hold these truths to be self-evident, that all men are created equal, that they are endowed ' +
      'by their Creator with certain unalienable Rights, that among these are Life, Liberty and the ' +
      'pursuit of Happiness. That to secure these rights, Governments are instituted among Men, ' +
      'deriving their just powers from the consent of the governed.',
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
