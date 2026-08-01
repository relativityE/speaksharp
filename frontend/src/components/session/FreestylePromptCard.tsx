import * as React from 'react';
import { Lightbulb, Target, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PracticeFocus } from '@/services/practice/practiceFocus';
import { PRACTICE_FOCUS_OPTIONS } from '@/services/practice/practiceFocus';

export function FreestylePromptCard({ focus, prompt }: { focus: PracticeFocus; prompt: string | null }) {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed || (focus === 'just-practice' && !prompt)) return null;
  const focusLabel = PRACTICE_FOCUS_OPTIONS.find((option) => option.id === focus)?.label ?? 'Just practice';
  return (
    <aside className="mx-auto mb-5 max-w-7xl rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm sm:px-6" data-testid="freestyle-prompt-card" aria-label="Your Freestyle setup">
      <div className="flex items-start gap-3">
        {prompt ? <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" /> : <Target className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Focus: {focusLabel}</p>
          {prompt && <p className="mt-1 text-sm leading-relaxed text-foreground" data-testid="resolved-freestyle-prompt">{prompt}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-1 h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss Freestyle setup"
          data-testid="dismiss-freestyle-prompt"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
