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
  { id: 'recent-work', text: 'Explain something you worked on recently: what it was, why it mattered, and what happened next.' },
  { id: 'short-update', text: 'Give a short update: main point, current status, and next step.' },
  { id: 'recent-decision', text: 'Describe a recent decision and why you made it.' },
  { id: 'familiar-process', text: 'Explain a familiar process to someone new.' },
  { id: 'teach-an-idea', text: 'Teach one idea using a simple example.' },
] as const;

export type FreestylePromptId = (typeof FREESTYLE_PROMPTS)[number]['id'];

export interface FreestyleOnrampSelection {
  focus: PracticeFocus;
  promptId: FreestylePromptId | null;
}

export function getNextFreestylePrompt(currentIndex: number | null): {
  index: number;
  prompt: (typeof FREESTYLE_PROMPTS)[number];
} {
  const index = currentIndex === null ? 0 : (currentIndex + 1) % FREESTYLE_PROMPTS.length;
  return { index, prompt: FREESTYLE_PROMPTS[index] };
}

export function resolvePracticeFocus(value: string | null | undefined): PracticeFocus {
  return PRACTICE_FOCUS_OPTIONS.some((option) => option.id === value)
    ? value as PracticeFocus
    : 'just-practice';
}

export function resolveFreestylePrompt(value: string | null | undefined) {
  return FREESTYLE_PROMPTS.find((prompt) => prompt.id === value) ?? null;
}

export function buildFreestyleSessionSearch(
  selection: FreestyleOnrampSelection,
  options: { privateTrial?: boolean } = {},
): string {
  const params = new URLSearchParams();
  params.set('focus', resolvePracticeFocus(selection.focus));
  if (resolveFreestylePrompt(selection.promptId)) params.set('prompt', selection.promptId as FreestylePromptId);
  if (options.privateTrial) params.set('trial', 'private');
  return `?${params.toString()}`;
}
