/**
 * Phase 2 SANDBOX — overall SpeakSharp landing (level 1 of the three-level journey).
 *
 * Level 1 (this) → per-mode product-overview page (level 2, OverviewScreen) → working interface
 * (level 3). This page introduces the WHOLE product: brand, the umbrella tagline "Private Practice.
 * Public Impact!" (the promise for BOTH modes — never assigned to only one), a private-preparation
 * framing line, a one-sentence explanation, and a decision prompt. Then two equal entry cards —
 * Quick Practice and Guided Rehearsal — each with enough (promise + short description + one marker) to
 * tell the modes apart WITHOUT opening anything; selecting a card opens its specialized overview page.
 * Returning users get a direct "Start now" for their last mode instead of replaying the walkthrough.
 * The tagline never substitutes for disclosure — the per-mode data-processing boundary is stated on
 * each overview page. Theme A tokens flow from the app root. Mobile stacks Quick Practice first.
 */

import React from 'react';
import { ArrowRight, Check, Play } from 'lucide-react';
import { QuickPracticeArt, GuidedRehearsalArt, LandingHeroArt } from '../components/vignettes';

export type LandingTheme = 'a' | 'b' | 'c';
type Col = 'quick' | 'guided';

export interface LandingActions {
  openQuick: () => void; // → Quick Practice overview
  openGuided: () => void; // → Guided Rehearsal overview
  startNow: () => void; // returning users: straight to the last mode's working experience
  reviewProgress: () => void;
}

interface ModeCard { key: Col; title: string; promise: string; description: string; marker: string; Art: React.FC<{ emphasis?: boolean }>; onOpen: () => void; vars: React.CSSProperties }

const QUICK_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-session-accent)', ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-session-soft)', ['--ss-card-panel' as string]: 'var(--ss-session-panel)', ['--ss-card-warm' as string]: 'var(--ss-sun)',
};
const GUIDED_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-exec-accent)', ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-exec-soft)', ['--ss-card-panel' as string]: 'var(--ss-exec-panel)', ['--ss-card-warm' as string]: 'var(--ss-coral)',
};

function ModeEntryCard({ c }: { c: ModeCard }) {
  return (
    <button
      type="button"
      onClick={c.onOpen}
      style={c.vars}
      className="group ss-ring flex flex-col overflow-hidden rounded-3xl bg-[color:var(--ss-surface)] text-left shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)] transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/[0.10] hover:ring-2 hover:ring-[color:var(--ss-card)]"
    >
      <div className="ss-card-panel relative h-20 border-b border-[color:var(--ss-border)]">
        <div className="absolute inset-0 px-5 py-3"><c.Art /></div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold text-[color:var(--ss-text)]">{c.title}</h3>
        <p className="mt-0.5 text-sm font-semibold text-[color:var(--ss-card-btn)]">{c.promise}</p>
        <p className="mt-2 text-sm text-[color:var(--ss-text-secondary)]">{c.description}</p>
        <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-[color:var(--ss-card-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--ss-card-btn)]">
          <Check size={13} aria-hidden /> {c.marker}
        </span>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--ss-card-btn)]">
          Explore {c.title} <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

export function LandingScreen({ actions, returning = false, lastMode, theme = 'a' }: { actions: LandingActions; returning?: boolean; lastMode?: Col; theme?: LandingTheme }) {
  const cards: ModeCard[] = [
    {
      key: 'quick', title: 'Quick Practice', promise: 'Speak freely. See how you’re progressing.',
      description: 'Start immediately without an agenda — get a transcript, focused delivery feedback, and progress against your own prior practice.',
      marker: 'No agenda required.', Art: QuickPracticeArt, onOpen: actions.openQuick, vars: QUICK_VARS,
    },
    {
      key: 'guided', title: 'Guided Rehearsal', promise: 'Prepare what matters. Rehearse until it lands.',
      description: 'Start with the outcomes you need to cover; rehearse while SpeakSharp tracks coverage and helps you recover missed points.',
      marker: 'Agenda and outcome guided.', Art: GuidedRehearsalArt, onOpen: actions.openGuided, vars: GUIDED_VARS,
    },
  ];
  const lastLabel = lastMode === 'guided' ? 'Guided Rehearsal' : 'Quick Practice';

  return (
    <div data-ss-theme={theme} className="ss-landing-canvas min-h-screen">
      {/* Overall product hero — warm amber/gold band uniting both modes: brand, umbrella tagline,
          private-preparation framing, explanation, decision prompt, and the shared branching graphic. */}
      <div className="ss-theme-hero">
        <div className="mx-auto max-w-5xl px-5 pb-12 pt-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="mr-auto text-sm font-bold uppercase tracking-wide text-[color:var(--ss-text)]">SpeakSharp</span>
            <span className="rounded-full border border-[color:var(--ss-border)] bg-white/70 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">Sandbox</span>
          </div>
          <div className="mt-6 grid items-center gap-6 md:grid-cols-[1fr_18rem]">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[color:var(--ss-text)] sm:text-4xl">Private Practice. Public Impact!</h1>
              <span aria-hidden className="mt-2 block h-1 w-16 rounded-full" style={{ background: 'var(--ss-amber)' }} />
              <p className="mt-3 max-w-2xl text-[15px] font-medium text-[color:var(--ss-text)]">Rehearse before the moment matters. You decide when your work is ready to be shared.</p>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">SpeakSharp helps you practice important speaking moments, review focused feedback, and see how you improve over time.</p>
              <p className="mt-4 text-sm font-semibold text-[color:var(--ss-text)]">Do you want to speak freely, or practice toward specific outcomes?</p>
            </div>
            <div className="hidden h-44 w-72 md:block"><LandingHeroArt /></div>
          </div>
        </div>
      </div>

      <div className="mx-auto -mt-6 max-w-5xl px-5 pb-12 sm:px-8">
        {/* Returning users — a direct "Start now" so they don't replay the walkthrough */}
        {returning ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[color:var(--ss-surface)] p-4 shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)]">
            <span className="text-sm text-[color:var(--ss-text-secondary)]">Welcome back — resume <span className="font-semibold text-[color:var(--ss-text)]">{lastLabel}</span>.</span>
            <button onClick={actions.startNow} className="ss-accent-btn ss-ring ml-auto inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-[filter]" style={lastMode === 'guided' ? GUIDED_VARS : QUICK_VARS}>
              <Play size={15} aria-hidden /> Start now
            </button>
          </div>
        ) : null}

        {/* Two equal modes — Quick Practice first (also first when stacked on mobile) */}
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2">
          {cards.map((c) => <ModeEntryCard key={c.key} c={c} />)}
        </div>

        <p className="mt-5 text-center text-sm text-[color:var(--ss-text-secondary)]">
          Not sure? Start with <span className="font-semibold text-[color:var(--ss-text)]">Quick Practice</span> — you can use both modes anytime.
        </p>

        <div className="mt-4 text-center">
          <button onClick={actions.reviewProgress} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[color:var(--ss-text-secondary)] transition-colors hover:text-[color:var(--ss-primary)]">
            View past progress <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
