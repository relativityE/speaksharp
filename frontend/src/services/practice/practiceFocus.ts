export const PRACTICE_FOCUS_OPTIONS = [
  { id: 'just-practice', label: 'Just practice' },
  { id: 'concise', label: 'Be more concise' },
  { id: 'fillers', label: 'Reduce filler words' },
  { id: 'pace', label: 'Keep a steady pace' },
  { id: 'clarity', label: 'Deliver clearly' },
] as const;

export type PracticeFocus = (typeof PRACTICE_FOCUS_OPTIONS)[number]['id'];

/**
 * The approved, deliberately short Freestyle prompt corpus from #1116.
 * Prompts are optional speaking starters. They are never converted into
 * required points, agendas, time budgets, readiness, or coverage checks.
 */
export const FREESTYLE_PROMPTS = [
  'Explain something you worked on recently: what it was, why it mattered, and what happened next.',
  'Give a short update: main point, current status, and next step.',
  'Describe a recent decision and why you made it.',
  'Explain a familiar process to someone new.',
  'Teach one idea using a simple example.',
] as const;

export function getNextFreestylePrompt(currentIndex: number | null): {
  index: number;
  prompt: (typeof FREESTYLE_PROMPTS)[number];
} {
  const index = currentIndex === null ? 0 : (currentIndex + 1) % FREESTYLE_PROMPTS.length;
  return { index, prompt: FREESTYLE_PROMPTS[index] };
}
