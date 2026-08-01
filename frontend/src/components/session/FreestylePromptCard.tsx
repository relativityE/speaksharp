import { Lightbulb, Target } from 'lucide-react';
import type { PracticeFocus } from '@/services/practice/practiceFocus';
import { PRACTICE_FOCUS_OPTIONS } from '@/services/practice/practiceFocus';

export function FreestylePromptCard({ focus, prompt }: { focus: PracticeFocus; prompt: string | null }) {
  if (focus === 'just-practice' && !prompt) return null;
  const focusLabel = PRACTICE_FOCUS_OPTIONS.find((option) => option.id === focus)?.label ?? 'Just practice';
  return (
    <aside className="mx-auto mb-5 max-w-7xl rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm sm:px-6" data-testid="freestyle-prompt-card" aria-label="Your Freestyle setup">
      <div className="flex items-start gap-3">
        {prompt ? <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" /> : <Target className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Focus: {focusLabel}</p>
          {prompt && <p className="mt-1 text-sm leading-relaxed text-foreground" data-testid="resolved-freestyle-prompt">{prompt}</p>}
        </div>
      </div>
    </aside>
  );
}
