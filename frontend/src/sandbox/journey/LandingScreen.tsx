/**
 * Phase 2 SANDBOX — practice starting page (ONE product, TWO practice modes; Theme A).
 *
 * SpeakSharp is presented as a single product with two ways to practice — NOT two unrelated products:
 *   • Quick Practice   — speak freely; no agenda; transcript + delivery feedback (→ existing /session).
 *   • Guided Rehearsal — prepare outcomes; SpeakSharp tracks coverage; recover missed points.
 * ("Executive Rehearsal" survives only as a template/use case inside Guided Rehearsal, not the label.)
 *
 * The landing leads with product identity, a plain-language headline/preamble, and a decision prompt
 * ("speak freely, or practice toward specific outcomes?"). Each mode is a card with FOUR always-visible
 * markers (intent / setup / result / best-for) so the two can be told apart WITHOUT opening either one;
 * additional "how it works" detail is progressively disclosed, one card at a time. Selecting a card
 * gives it a stronger border, tint, elevation, and an explicit "Selected" indicator. Colour (teal vs
 * violet) reinforces but never carries the distinction alone. Frozen: two equal columns, subordinate
 * progress link, no sidebar. Mobile stacks Quick Practice first. Theme A tokens flow from the app root.
 */

import React from 'react';
import { Check, Play, PencilLine, ArrowRight, ChevronDown } from 'lucide-react';
import { QuickPracticeArt, GuidedRehearsalArt } from '../components/vignettes';

export type LandingTheme = 'a' | 'b' | 'c';

export interface LandingActions {
  startRehearsal: () => void;
  createRehearsal: () => void;
  startSession: () => void; // Quick Practice → doorway to the existing SpeakSharp session (/session)
  reviewProgress: () => void;
}

type Col = 'quick' | 'guided';
interface ColumnDef {
  key: Col;
  title: string;
  promise: string;
  description: string;
  markers: string[];
  steps: string[];
  Art: React.FC<{ emphasis?: boolean }>;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}

// Per-card accent variables — Quick Practice = teal (Session accent), Guided Rehearsal = violet.
const CARD_VARS: Record<Col, React.CSSProperties> = {
  quick: {
    ['--ss-card' as string]: 'var(--ss-session-accent)',
    ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
    ['--ss-card-soft' as string]: 'var(--ss-session-soft)',
    ['--ss-card-panel' as string]: 'var(--ss-session-panel)',
    ['--ss-card-warm' as string]: 'var(--ss-sun)',
  },
  guided: {
    ['--ss-card' as string]: 'var(--ss-exec-accent)',
    ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
    ['--ss-card-soft' as string]: 'var(--ss-exec-soft)',
    ['--ss-card-panel' as string]: 'var(--ss-exec-panel)',
    ['--ss-card-warm' as string]: 'var(--ss-coral)',
  },
};

function AccentButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="ss-accent-btn ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-[filter]">
      {children}
    </button>
  );
}

function Card({ c, selected, onSelect }: { c: ColumnDef; selected: boolean; onSelect: () => void }) {
  const stepsId = `how-${c.key}`;
  return (
    <section
      style={CARD_VARS[c.key]}
      className={`flex flex-col overflow-hidden rounded-3xl bg-[color:var(--ss-surface)] transition-all duration-200 ${
        selected
          ? 'shadow-xl shadow-slate-900/[0.13] ring-2 ring-[color:var(--ss-card)] -translate-y-1'
          : 'shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/[0.09]'
      }`}
    >
      {/* Selection toggle (whole header) — reveals the "how it works" detail and marks the card selected */}
      <button
        type="button"
        aria-pressed={selected}
        aria-expanded={selected}
        aria-controls={stepsId}
        onClick={onSelect}
        className="ss-ring block text-left"
      >
        <div className={`ss-card-panel relative h-20 border-b border-[color:var(--ss-border)] transition-opacity ${selected ? 'opacity-100' : 'opacity-90'}`}>
          <div className="absolute inset-0 px-5 py-3"><c.Art emphasis={selected} /></div>
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-[color:var(--ss-text)]">{c.title}</h3>
            <p className="mt-0.5 text-sm font-semibold text-[color:var(--ss-card-btn)]">{c.promise}</p>
          </div>
          {selected ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--ss-card-soft)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">
              <Check size={12} aria-hidden /> Selected
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[color:var(--ss-neutral)]">
              How it works <ChevronDown size={13} aria-hidden />
            </span>
          )}
        </div>
      </button>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-2">
        <p className="text-sm text-[color:var(--ss-text-secondary)]">{c.description}</p>

        {/* Four always-visible markers — intent / setup / result / best-for (tell modes apart unopened) */}
        <ul className="mt-3 space-y-1.5">
          {c.markers.map((m, i) => (
            <li key={m} className="flex items-start gap-2 text-sm text-[color:var(--ss-text)]">
              {i < 3
                ? <Check size={15} aria-hidden className="mt-0.5 shrink-0" style={{ color: 'var(--ss-card-btn)' }} />
                : <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--ss-neutral)' }} />}
              <span className={i === 3 ? 'text-[color:var(--ss-text-secondary)]' : undefined}>{m}</span>
            </li>
          ))}
        </ul>

        {/* Progressively-disclosed detail — only the selected card's steps are shown */}
        {selected ? (
          <ol id={stepsId} className="ss-fade-up mt-3 space-y-1.5 rounded-xl bg-[color:var(--ss-card-soft)] px-4 py-3 text-sm text-[color:var(--ss-text-secondary)]">
            {c.steps.map((s, i) => (
              <li key={s} className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: 'var(--ss-card-btn)' }}>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
          <AccentButton onClick={c.primary.onClick}>
            {c.key === 'guided' ? <PencilLine size={15} aria-hidden /> : <Play size={15} aria-hidden />} {c.primary.label}
          </AccentButton>
          {c.secondary ? (
            <button onClick={c.secondary.onClick} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-[color:var(--ss-card-btn)] hover:underline">
              {c.secondary.label}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function LandingScreen({ actions, returning = false, lastMode, theme = 'a' }: { actions: LandingActions; returning?: boolean; lastMode?: Col; theme?: LandingTheme }) {
  const [selected, setSelected] = React.useState<Col | null>(returning && lastMode ? lastMode : null);
  const toggle = (c: Col) => setSelected((s) => (s === c ? null : c));

  const columns: ColumnDef[] = [
    {
      key: 'quick', title: 'Quick Practice', promise: 'Speak freely.',
      description: 'Start immediately without preparing an agenda. SpeakSharp captures your words, gives focused delivery feedback, and compares this session with your prior practice.',
      markers: ['No agenda or setup required', 'Transcript and focused delivery feedback', 'Session-over-session progress', 'Best for everyday speaking practice'],
      steps: ['Pick how you want to capture — the modes you already use.', 'Speak as you normally would; SpeakSharp transcribes as you go.', 'Review your delivery feedback and how it compares with your prior practice.'],
      Art: QuickPracticeArt,
      primary: { label: 'Start speaking', onClick: actions.startSession },
    },
    {
      key: 'guided', title: 'Guided Rehearsal', promise: 'Prepare for an outcome.',
      description: 'Enter the points you need to cover, rehearse while SpeakSharp tracks them quietly, and review what you covered, missed, or recovered.',
      markers: ['Begin with your agenda or intended outcomes', 'Passive coverage tracking', 'Sparse help — only when you ask', 'Best for presentations, pitches, interviews, and important meetings'],
      steps: ['Define what you’re rehearsing and add 3–5 key points (or use a prepared template).', 'Speak while your agenda is tracked passively — request help only if you want it.', 'See what you covered, partly covered, missed, and recovered; then rehearse again.'],
      Art: GuidedRehearsalArt,
      primary: { label: 'Set up a rehearsal', onClick: actions.createRehearsal },
      secondary: { label: 'Try a sample', onClick: actions.startRehearsal },
    },
  ];

  return (
    <div data-ss-theme={theme} className="min-h-screen bg-[color:var(--ss-canvas)]">
      {/* Integrated LIGHT hero — product identity + headline + preamble + decision prompt */}
      <div className="ss-theme-hero">
        <div className="mx-auto max-w-5xl px-5 pb-12 pt-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="mr-auto text-sm font-bold uppercase tracking-wide text-[color:var(--ss-text)]">SpeakSharp</span>
            <span className="rounded-full border border-[color:var(--ss-border)] bg-white/70 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">Sandbox</span>
          </div>
          <h2 className="mt-6 max-w-2xl text-3xl font-semibold tracking-tight text-[color:var(--ss-text)] sm:text-4xl">Practice how you speak — and whether you say what matters.</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">
            {returning ? 'Welcome back. Pick up where you left off, or choose a different way to practice today.' : 'SpeakSharp helps you rehearse important speaking moments, review focused feedback, and see your progress over time. Choose the type of practice that matches what you need today.'}
          </p>
          <p className="mt-4 text-sm font-semibold text-[color:var(--ss-text)]">Do you want to speak freely, or practice toward specific outcomes?</p>
        </div>
      </div>

      <div className="mx-auto -mt-6 max-w-5xl px-5 pb-12 sm:px-8">
        {/* Two equal modes — Quick Practice first (also first when stacked on mobile) */}
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2">
          {columns.map((c) => <Card key={c.key} c={c} selected={selected === c.key} onSelect={() => toggle(c.key)} />)}
        </div>

        {/* Reassurance — lower the stakes of the choice */}
        <p className="mt-5 text-center text-sm text-[color:var(--ss-text-secondary)]">
          Not sure? Start with <span className="font-semibold text-[color:var(--ss-text)]">Quick Practice</span> — you can use both modes anytime.
        </p>

        {/* View past progress — subordinate, below the two practice choices */}
        <div className="mt-4 text-center">
          <button onClick={actions.reviewProgress} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[color:var(--ss-text-secondary)] transition-colors hover:text-[color:var(--ss-primary)]">
            View past progress <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
