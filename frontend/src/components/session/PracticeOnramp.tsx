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
 * know what to say. Option A: a FLOATING, NON-MODAL teleprompter card pinned top-center. It stays
 * visible while recording so the user can read a prompt/sample aloud, and it never blocks the mic or
 * the live transcript — the wrapper is pointer-events-none, only the card itself is interactive.
 * Collapsible + dismissible. Optional, non-persistent, never scored or saved.
 *   - "Give me a prompt": a short speaking starter.
 *   - "Let me test with a sample": a ≤30–60s PUBLIC-DOMAIN passage to read aloud.
 */
export function PracticeOnramp({ className = '' }: { className?: string }) {
  const [view, setView] = React.useState<'choose' | 'prompt' | 'sample'>('choose');
  const [promptIdx, setPromptIdx] = React.useState<number | null>(null);
  const [sampleIdx, setSampleIdx] = React.useState<number | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  const prompt = promptIdx === null ? null : SPEAKING_PROMPTS[promptIdx];
  const sample = sampleIdx === null ? null : SAMPLE_PASSAGES[sampleIdx];
  const showPrompt = () => { const n = getNextPrompt(promptIdx); setPromptIdx(n.index); setView('prompt'); };
  const showSample = () => { const n = getNextSample(sampleIdx); setSampleIdx(n.index); setView('sample'); };

  return (
    // #1046 slice 0.1: render IN-FLOW at ALL widths (relative, full width). The fixed floating card was
    // covering the recorder + Live Coaching cards on desktop and intercepting mic/selector clicks on
    // mobile. In-flow it takes its own space above the recorder and never overlaps anything. (The
    // prompt/sample OUTPUT will move into the Live Transcript panel in a follow-up so the box itself can
    // shrink; for now it sits in-flow, un-covering the controls.)
    <div className={`relative mb-4 w-full ${className}`}>
      <section
        data-testid="practice-onramp"
        aria-label="Reading helper — not sure what to say?"
        className="pointer-events-auto rounded-xl border border-[color:var(--ss-border,#e2e8f0)] bg-slate-100/85 dark:bg-slate-800/85 backdrop-blur-md p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[color:var(--ss-text,#0f172a)]">
            {collapsed ? 'Reading helper' : 'Not sure what to say?'}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid={collapsed ? 'onramp-expand' : 'onramp-collapse'}
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand reading helper' : 'Collapse reading helper'}
              className="ss-ring rounded-md px-2 text-sm leading-none text-[color:var(--ss-text-muted,#64748b)]"
            >
              {collapsed ? '▸' : '–'}
            </button>
            <button
              type="button"
              data-testid="onramp-dismiss"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss reading helper"
              className="ss-ring rounded-md px-2 text-lg leading-none text-[color:var(--ss-text-muted,#64748b)]"
            >
              ×
            </button>
          </div>
        </div>

        {!collapsed && view === 'choose' && (
          <div data-testid="onramp-choose" className="mt-2 space-y-3">
            <p className="text-base leading-snug text-blue-700 dark:text-blue-300">
              Get a quick starter — or read a short sample aloud to try it out. Then press the mic; this stays up so you can read it.
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Homage to the homepage mode palette: Open Mic green + Focus Points violet. */}
              <Button type="button" size="sm" data-testid="onramp-give-prompt" onClick={showPrompt} className="bg-[#0d7d74] text-white hover:bg-[#0a5f58]">Give me a prompt</Button>
              <Button type="button" size="sm" data-testid="onramp-test-sample" onClick={showSample} className="bg-[#7b5ce0] text-white hover:bg-[#6a4fd0]">
                Let me test with a sample
              </Button>
            </div>
          </div>
        )}

        {!collapsed && view === 'prompt' && prompt && (
          <div data-testid="onramp-prompt" className="mt-2 space-y-2">
            <p className="text-base leading-snug text-[color:var(--ss-text,#0f172a)]">{prompt.text}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" data-testid="onramp-next-prompt" onClick={showPrompt}>Another prompt</Button>
              <Button type="button" size="sm" variant="ghost" data-testid="onramp-switch-sample" onClick={showSample}>Read a sample instead</Button>
            </div>
          </div>
        )}

        {!collapsed && view === 'sample' && sample && (
          <div data-testid="onramp-sample" className="mt-2 space-y-2">
            <p className="text-sm font-semibold text-[color:var(--ss-text,#0f172a)]">
              {sample.title} <span className="font-normal text-[color:var(--ss-text-muted,#64748b)]">· ~{sample.estSeconds}s to read</span>
            </p>
            <blockquote
              data-testid="onramp-sample-text"
              className="max-h-[38vh] overflow-auto border-l-2 border-[color:var(--ss-border,#cbd5e1)] pl-3 text-base italic leading-relaxed text-[color:var(--ss-text,#0f172a)]"
            >
              {sample.text}
            </blockquote>
            <p className="text-xs text-[color:var(--ss-text-muted,#64748b)]">{sample.attribution}</p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button type="button" size="sm" variant="outline" data-testid="onramp-next-sample" onClick={showSample}>Another sample</Button>
              <Button type="button" size="sm" variant="ghost" data-testid="onramp-switch-prompt" onClick={showPrompt}>Get a prompt instead</Button>
            </div>
          </div>
        )}

        {!collapsed && (
          <p className="mt-2 text-sm text-foreground/80">
            Optional. Nothing here is saved or scored.
          </p>
        )}
      </section>
    </div>
  );
}
