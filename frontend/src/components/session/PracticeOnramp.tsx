import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  SPEAKING_PROMPTS,
  SAMPLE_PASSAGES,
  getNextPrompt,
  getNextSample,
} from '@/services/practice/practiceOnramp';

/**
 * #1116 — Session-page on-ramp for the "blank page" problem: users reach the session page and don't
 * know what to say. Optional, dismissible, non-persistent. Two aids:
 *   - "Give me a prompt" (primary): a short speaking starter.
 *   - "Let me test with a sample": a ≤1-minute PUBLIC-DOMAIN passage to read aloud to try the product.
 * Nothing here is required, scored, or saved — it only helps the user begin. Rendered only while idle.
 */
export function PracticeOnramp({ className = '' }: { className?: string }) {
  const [view, setView] = React.useState<'choose' | 'prompt' | 'sample'>('choose');
  const [promptIdx, setPromptIdx] = React.useState<number | null>(null);
  const [sampleIdx, setSampleIdx] = React.useState<number | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  const prompt = promptIdx === null ? null : SPEAKING_PROMPTS[promptIdx];
  const sample = sampleIdx === null ? null : SAMPLE_PASSAGES[sampleIdx];

  const showPrompt = () => { const n = getNextPrompt(promptIdx); setPromptIdx(n.index); setView('prompt'); };
  const showSample = () => { const n = getNextSample(sampleIdx); setSampleIdx(n.index); setView('sample'); };

  return (
    <section
      data-testid="practice-onramp"
      aria-label="Not sure what to say?"
      className={`rounded-xl border border-[color:var(--ss-border,#e2e8f0)] bg-[color:var(--ss-surface,#fff)] p-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-[color:var(--ss-text,#0f172a)]">Not sure what to say?</h3>
        <button
          type="button"
          data-testid="onramp-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss suggestions"
          className="ss-ring shrink-0 rounded-md px-2 text-lg leading-none text-[color:var(--ss-text-muted,#64748b)]"
        >
          ×
        </button>
      </div>

      {view === 'choose' && (
        <div data-testid="onramp-choose" className="mt-2 space-y-3">
          <p className="text-sm text-[color:var(--ss-text-muted,#475569)]">
            Get a quick starter — or read a short sample aloud to try it out. Then press the mic.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" data-testid="onramp-give-prompt" onClick={showPrompt}>Give me a prompt</Button>
            <Button type="button" variant="outline" data-testid="onramp-test-sample" onClick={showSample}>
              Let me test with a sample
            </Button>
          </div>
        </div>
      )}

      {view === 'prompt' && prompt && (
        <div data-testid="onramp-prompt" className="mt-2 space-y-3">
          <p className="text-base text-[color:var(--ss-text,#0f172a)]">{prompt.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" data-testid="onramp-next-prompt" onClick={showPrompt}>Another prompt</Button>
            <Button type="button" variant="ghost" data-testid="onramp-switch-sample" onClick={showSample}>Read a sample instead</Button>
          </div>
        </div>
      )}

      {view === 'sample' && sample && (
        <div data-testid="onramp-sample" className="mt-2 space-y-2">
          <p className="text-sm font-semibold text-[color:var(--ss-text,#0f172a)]">
            {sample.title} <span className="font-normal text-[color:var(--ss-text-muted,#64748b)]">· ~{sample.estSeconds}s to read</span>
          </p>
          <blockquote
            data-testid="onramp-sample-text"
            className="border-l-2 border-[color:var(--ss-border,#cbd5e1)] pl-3 text-base italic text-[color:var(--ss-text,#0f172a)]"
          >
            {sample.text}
          </blockquote>
          <p className="text-xs text-[color:var(--ss-text-muted,#64748b)]">{sample.attribution}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" data-testid="onramp-next-sample" onClick={showSample}>Another sample</Button>
            <Button type="button" variant="ghost" data-testid="onramp-switch-prompt" onClick={showPrompt}>Get a prompt instead</Button>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-[color:var(--ss-text-muted,#64748b)]">
        Optional. Nothing here is saved or scored — read it aloud, then press the mic to start your session.
      </p>
    </section>
  );
}
