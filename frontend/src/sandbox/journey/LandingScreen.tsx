/**
 * Phase 2 SANDBOX — first-use activity launcher.
 *
 * Preamble → three prominent activity categories (collapsed) → single-open numbered step accordion
 * inside the selected category → one obvious primary action. Learn-by-doing: "Try a sample rehearsal"
 * launches the complete simulated journey. Clean at rest; detail only when the user asks for it.
 * Only ONE category and ONE step may be open at a time. Real buttons + aria-expanded/aria-controls;
 * meaning never depends on color or arrow direction alone.
 */

import React from 'react';
import { ChevronDown, Check, Play, PencilLine } from 'lucide-react';
import { T } from '../theme';
import { PrimaryButton, SecondaryButton, GhostButton } from '../components/ui';
import { QuickPracticeVignette, ExecutiveRehearsalVignette, ReviewProgressVignette } from '../components/vignettes';

export interface LandingActions {
  startRehearsal: () => void; // Executive Rehearsal — the sample journey
  createRehearsal: () => void; // Executive Rehearsal — edit the brief first
  startQuick: () => void; // Quick Practice
  reviewProgress: () => void; // Review My Progress
}

interface StepDef {
  title: string;
  actions: number;
  subtasks: string[];
  rollup: string;
  primary?: { label: string; icon?: React.ReactNode; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}
interface CategoryDef {
  key: 'quick' | 'exec' | 'review';
  title: string;
  benefit: string;
  Vignette: React.FC;
  steps: StepDef[];
}

function StepAccordion({ steps, openStep, setOpenStep }: { steps: StepDef[]; openStep: number; setOpenStep: (n: number) => void }) {
  return (
    <ol className="mt-4 space-y-2">
      {steps.map((s, i) => {
        const open = openStep === i;
        const done = i < openStep; // steps before the open one read as completed rollups
        return (
          <li key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`step-panel-${i}`}
              aria-label={s.title}
              onClick={() => setOpenStep(open ? -1 : i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? 'bg-emerald-100 text-emerald-700' : open ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {done ? <Check size={15} aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-slate-900">{s.title}</span>
                {!open ? <span className="block text-xs text-slate-500">{done ? s.rollup : `${s.actions} ${s.actions === 1 ? 'action' : 'actions'}`}</span> : null}
              </span>
              <ChevronDown size={16} aria-hidden className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open ? (
              <div id={`step-panel-${i}`} className="ss-fade-up border-t border-slate-100 px-4 py-3">
                <ul className="mb-3 space-y-1.5 text-sm text-slate-600">
                  {s.subtasks.map((t) => (
                    <li key={t} className="flex items-start gap-2"><span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />{t}</li>
                  ))}
                </ul>
                {s.primary || s.secondary ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {s.primary ? <PrimaryButton className="px-4 py-2 text-sm" onClick={s.primary.onClick}>{s.primary.icon}{s.primary.label}</PrimaryButton> : null}
                    {s.secondary ? <SecondaryButton onClick={s.secondary.onClick}>{s.secondary.label}</SecondaryButton> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function LandingScreen({ actions, returning = false }: { actions: LandingActions; returning?: boolean }) {
  const [openCat, setOpenCat] = React.useState<CategoryDef['key'] | null>(returning ? null : 'exec');
  const [openStep, setOpenStep] = React.useState(0);
  const [hintDismissed, setHintDismissed] = React.useState(false);

  const categories: CategoryDef[] = [
    {
      key: 'quick', title: 'Quick Practice', benefit: 'Speak freely without preparing an agenda.', Vignette: QuickPracticeVignette,
      steps: [
        { title: 'Speak freely', actions: 1, rollup: 'Ready to record', subtasks: ['Just begin — no agenda to set up.'], primary: { label: 'Start speaking', icon: <Play size={15} aria-hidden />, onClick: actions.startQuick } },
        { title: 'Finish the session', actions: 1, rollup: 'Session captured', subtasks: ['Stop when you’re done; SpeakSharp finalizes on your device.'] },
        { title: 'Review one improvement', actions: 1, rollup: 'One focus to try next', subtasks: ['See a single, plain-language thing to work on next time.'] },
      ],
    },
    {
      key: 'exec', title: 'Executive Rehearsal', benefit: 'Practice against the outcomes you intend to cover.', Vignette: ExecutiveRehearsalVignette,
      steps: [
        { title: 'Prepare', actions: 3, rollup: '3 agenda points prepared', subtasks: ['Define the presentation or conversation.', 'Identify the audience and intended outcome.', 'Add 3–5 agenda points or use the prepared sample.'], primary: { label: 'Start rehearsal', icon: <Play size={15} aria-hidden />, onClick: actions.startRehearsal }, secondary: { label: 'Create my rehearsal', onClick: actions.createRehearsal } },
        { title: 'Rehearse naturally', actions: 2, rollup: 'Agenda tracked passively', subtasks: ['Speak while your agenda is tracked passively.', 'Request help only if you want it — Pause or Finish anytime.'] },
        { title: 'Review and recover', actions: 3, rollup: 'Covered · recovered · next focus', subtasks: ['See what you covered, partly covered, missed, and recovered.', 'Inspect one suggested remedy.', 'Rehearse again.'] },
      ],
    },
    {
      key: 'review', title: 'Review My Progress', benefit: 'See how your delivery is changing compared with your past sessions.', Vignette: ReviewProgressVignette,
      steps: [
        { title: 'Choose a comparable session', actions: 1, rollup: 'Compared to your own baseline', subtasks: ['Compare against a similar past session — same kind of practice.'], primary: { label: 'Review my sessions', onClick: actions.reviewProgress } },
        { title: 'Review raw movement', actions: 1, rollup: 'Plain-language change', subtasks: ['Lead with human-readable change vs your own baseline.'] },
        { title: 'Open details if wanted', actions: 1, rollup: 'Numbers behind the scenes', subtasks: ['Formulas, confidence, and percentages live under optional details.'] },
      ],
    },
  ];

  // ----- Returning-user compact state -----
  if (returning) {
    return (
      <div className={`min-h-[calc(100vh-3.5rem)] ${T.frame} px-5 py-10 sm:px-8`}>
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-semibold text-white">Welcome back.</h2>
          <p className="mt-2 text-[15px] text-slate-400">Pick up where you left off.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={actions.startRehearsal}><Play size={18} aria-hidden /> Start rehearsal</PrimaryButton>
            <SecondaryButton onClick={actions.startQuick}>Quick practice</SecondaryButton>
          </div>
          <details className="mt-6 rounded-xl border border-slate-700 bg-slate-800/40">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">How Executive Rehearsal works</summary>
            <ol className="space-y-1 px-6 py-3 text-sm text-slate-300">
              <li>1 · Prepare — set the outcomes you want to cover.</li>
              <li>2 · Rehearse — speak while your agenda tracks itself.</li>
              <li>3 · Review — see what you covered, recovered, and should strengthen next.</li>
            </ol>
          </details>
        </div>
      </div>
    );
  }

  // ----- First-use full orientation -----
  return (
    <div className={`min-h-[calc(100vh-3.5rem)] ${T.frame} px-5 py-10 sm:px-8`}>
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-medium text-indigo-300">Executive Rehearsal</p>
        <h2 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Improve how you speak, present, and deliver important outcomes.</h2>
        <p className="mt-3 text-[15px] text-slate-300">Choose how you want to practice, and SpeakSharp will guide you through the next step.</p>

        {/* Learn-by-doing hero */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={actions.startRehearsal}><Play size={18} aria-hidden /> Try a sample rehearsal</PrimaryButton>
          <GhostButton className="text-slate-300 hover:bg-slate-800" onClick={actions.createRehearsal}><PencilLine size={15} aria-hidden /> Create my rehearsal</GhostButton>
        </div>
        {!hintDismissed ? (
          <p className="ss-fade-up mt-2 inline-flex items-center gap-2 text-xs text-slate-400">
            New here? The sample needs no setup — press it and follow along.
            <button onClick={() => setHintDismissed(true)} className="rounded px-1.5 py-0.5 font-medium text-slate-300 underline decoration-slate-600 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-indigo-400">Got it</button>
          </p>
        ) : null}

        {/* Activity categories (mutually-exclusive accordion) */}
        <div className="mt-8 space-y-3">
          {categories.map((c) => {
            const open = openCat === c.key;
            return (
              <div key={c.key} className={`overflow-hidden rounded-2xl ring-1 transition-colors ${open ? 'bg-[#faf8f4] ring-indigo-300' : 'bg-slate-800/50 ring-slate-700/70 hover:ring-slate-500'}`}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`cat-panel-${c.key}`}
                  aria-label={`${c.title}: ${c.benefit}`}
                  onClick={() => { setOpenCat(open ? null : c.key); setOpenStep(0); }}
                  className="flex w-full items-center gap-4 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <c.Vignette />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-lg font-semibold ${open ? 'text-slate-900' : 'text-white'}`}>{c.title}</span>
                    <span className={`block text-sm ${open ? 'text-slate-600' : 'text-slate-400'}`}>{c.benefit}</span>
                  </span>
                  <ChevronDown size={20} aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-180 text-slate-500' : 'text-slate-400'}`} />
                </button>
                {open ? (
                  <div id={`cat-panel-${c.key}`} className="ss-fade-up border-t border-slate-200 px-4 pb-4">
                    <StepAccordion steps={c.steps} openStep={openStep} setOpenStep={setOpenStep} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
