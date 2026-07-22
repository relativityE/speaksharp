/**
 * Phase 2 SANDBOX — product-overview page (level 2 of the journey).
 *
 * Overall landing (level 1) → THIS specialized product-overview page (level 2) → working interface
 * (level 3). Each mode gets its own top-third hero (specialized illustration + heading + one marker +
 * primary CTA) and, below it, a VISUAL numbered journey that explains the whole experience from setup
 * to completion. Journey steps show a concise title + one-line result by default and reveal detail on
 * selection, one step open at a time (keyboard-operable). The big hero belongs ONLY here — once the
 * user starts working, the app collapses to the compact product header (no decorative hero in the
 * active workspace). The tagline never substitutes for disclosure: each mode states, separately and
 * truthfully, that transcription runs on-device OR via a secure cloud service, chosen in the session.
 */

import React from 'react';
import {
  ArrowLeft, Play, PencilLine, ChevronDown, Shield,
  Settings2, Mic, FileText, LineChart, Target,
  ClipboardList, ListChecks, Activity, Lightbulb, MessageSquarePlus, CheckCircle2, RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { QuickPracticeArt, GuidedRehearsalArt } from '../components/vignettes';

export type OverviewMode = 'quick' | 'guided';

interface Step { title: string; result: string; detail: string; Icon: LucideIcon }
interface ModeConfig {
  heading: string;
  supporting: string;
  marker: string;
  primaryLabel: string;
  Art: React.FC<{ emphasis?: boolean }>;
  vars: React.CSSProperties;
  steps: Step[];
  loop?: string[]; // Guided correction loop
}

const QUICK_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-session-accent)', ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-session-soft)', ['--ss-card-panel' as string]: 'var(--ss-session-panel)', ['--ss-card-warm' as string]: 'var(--ss-sun)',
};
const GUIDED_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-exec-accent)', ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-exec-soft)', ['--ss-card-panel' as string]: 'var(--ss-exec-panel)', ['--ss-card-warm' as string]: 'var(--ss-coral)',
};

const CONFIG: Record<OverviewMode, ModeConfig> = {
  quick: {
    heading: 'Speak freely. See how you’re progressing.',
    supporting: 'Start immediately without preparing an agenda. SpeakSharp captures your words and helps you review focused delivery evidence.',
    marker: 'No agenda required.',
    primaryLabel: 'Start speaking',
    Art: QuickPracticeArt,
    vars: QUICK_VARS,
    steps: [
      { title: 'Choose your transcription mode', result: 'On your device, or a secure cloud service.', detail: 'Pick how your speech is transcribed. SpeakSharp shows which mode is active — it is never hidden.', Icon: Settings2 },
      { title: 'Start speaking', result: 'No agenda — just speak.', detail: 'Begin immediately. SpeakSharp transcribes as you go; there is nothing to set up first.', Icon: Mic },
      { title: 'Review your transcript and delivery evidence', result: 'See exactly what you said.', detail: 'Read the transcript alongside focused delivery signals such as pace and filler words.', Icon: FileText },
      { title: 'Compare with your own prior practice', result: 'Progress vs your own baseline.', detail: 'See how this session moves relative to your earlier practice — measured against you, never a public grade.', Icon: LineChart },
      { title: 'Choose what to improve next', result: 'One clear next focus.', detail: 'Pick a single thing to work on next time, so practice compounds instead of scattering.', Icon: Target },
    ],
  },
  guided: {
    heading: 'Prepare what matters. Rehearse until it lands.',
    supporting: 'Define what you need to cover, rehearse naturally, and see what was covered, missed, or recovered.',
    marker: 'Agenda and outcome guided.',
    primaryLabel: 'Set up a rehearsal',
    Art: GuidedRehearsalArt,
    vars: GUIDED_VARS,
    steps: [
      { title: 'Describe the occasion and audience', result: 'Set the context.', detail: 'Say what you’re rehearsing and who it’s for, so tracking reflects the real moment.', Icon: ClipboardList },
      { title: 'Add the points or outcomes you must cover', result: '3–5 outcomes (or a template).', detail: 'List the outcomes you need to land — or start from a prepared template such as an executive briefing.', Icon: ListChecks },
      { title: 'Rehearse while SpeakSharp tracks quietly', result: 'Passive coverage — no interruptions.', detail: 'Speak naturally. Your agenda moves from not-addressed → partly → covered without breaking your flow.', Icon: Activity },
      { title: 'Receive or request one restrained remedy when useful', result: 'One suggestion, only when helpful.', detail: 'If a point is slipping, ask for help — you get a single concise suggestion, not a stream of prompts.', Icon: Lightbulb },
      { title: 'Supplement or recover the missed point', result: 'Address it in the moment.', detail: 'Say the ask out loud; SpeakSharp watches for the recovery so the gap becomes a save.', Icon: MessageSquarePlus },
      { title: 'Review covered, partial, missed, and recovered outcomes', result: 'See the whole picture.', detail: 'A plain-language summary shows what you covered, partly covered, missed, and recovered after guidance.', Icon: CheckCircle2 },
      { title: 'Rehearse again and prove improvement', result: 'Recovery is the payoff.', detail: 'Run it again and watch missed points turn into covered ones — improvement you can see, against your own baseline.', Icon: RotateCcw },
    ],
    loop: ['Rehearse', 'Detect gap', 'One remedy', 'Supplement', 'Prove recovery', 'Rehearse again'],
  },
};

function JourneyStep({ step, index, open, onToggle }: { step: Step; index: number; open: boolean; onToggle: () => void }) {
  const stepId = `step-${index}`;
  return (
    <li className={`overflow-hidden rounded-2xl transition-colors ${open ? 'bg-[color:var(--ss-card-soft)] ring-1 ring-[color:var(--ss-card)]' : 'bg-[color:var(--ss-surface)] ring-1 ring-[color:var(--ss-border)]'}`}>
      <button type="button" aria-expanded={open} aria-controls={stepId} onClick={onToggle} className="ss-ring flex w-full items-center gap-4 px-4 py-3.5 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--ss-card-soft)', color: 'var(--ss-card-btn)' }}>
          <step.Icon size={19} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: 'var(--ss-card-btn)' }}>{index + 1}</span>
            <span className="text-sm font-semibold text-[color:var(--ss-text)]">{step.title}</span>
          </span>
          <span className="mt-0.5 block pl-7 text-[13px] text-[color:var(--ss-text-secondary)]">{step.result}</span>
        </span>
        <ChevronDown size={16} aria-hidden style={{ color: 'var(--ss-card-btn)' }} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <p id={stepId} className="ss-fade-up px-4 pb-4 pl-[4.5rem] text-sm text-[color:var(--ss-text-secondary)]">{step.detail}</p> : null}
    </li>
  );
}

export function OverviewScreen({ mode, onPrimary, onSample, onBack }: { mode: OverviewMode; onPrimary: () => void; onSample?: () => void; onBack: () => void }) {
  const cfg = CONFIG[mode];
  const [openStep, setOpenStep] = React.useState<number | null>(null);
  const journeyRef = React.useRef<HTMLDivElement>(null);
  const seeHow = () => journeyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div style={cfg.vars} className="min-h-[calc(100vh-3.5rem)]">
      {/* Top-third specialized hero — the big hero belongs ONLY to this overview page */}
      <section className="ss-theme-hero">
        <div className="mx-auto max-w-5xl px-5 pb-10 pt-4 sm:px-8">
          <button onClick={onBack} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-[color:var(--ss-text-secondary)] hover:text-[color:var(--ss-card-btn)]">
            <ArrowLeft size={15} aria-hidden /> Back to practice choices
          </button>
          <div className="mt-4 grid items-center gap-6 md:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--ss-card-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">{cfg.marker}</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ss-text)]">{cfg.heading}</h2>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">{cfg.supporting}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button onClick={onPrimary} className="ss-accent-btn ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-[filter]">
                  {mode === 'guided' ? <PencilLine size={16} aria-hidden /> : <Play size={16} aria-hidden />} {cfg.primaryLabel}
                </button>
                <button onClick={seeHow} className="ss-accent-outline ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors">See how it works</button>
                {onSample ? <button onClick={onSample} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-[color:var(--ss-card-btn)] hover:underline">Try a sample</button> : null}
              </div>
            </div>
            <div className="ss-card-panel h-40 overflow-hidden rounded-2xl ring-1 ring-[color:var(--ss-border)]">
              <div className="h-full w-full px-6 py-5"><cfg.Art emphasis /></div>
            </div>
          </div>
          {/* Data-processing disclosure — the tagline frames PRIVATE PREPARATION, not on-device-for-all */}
          <p className="mt-6 inline-flex items-start gap-2 text-xs text-[color:var(--ss-neutral)]">
            <Shield size={14} aria-hidden className="mt-0.5 shrink-0" />
            <span>How your speech is transcribed — on your device or via a secure cloud service — is shown and chosen in each session. “Private” here means private preparation: you decide when your work is ready to share.</span>
          </p>
        </div>
      </section>

      {/* Visual numbered journey — the whole experience, setup → completion, progressively disclosed */}
      <div ref={journeyRef} className="mx-auto max-w-3xl px-5 py-9 sm:px-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">How it works</h3>
        <ol className="mt-4 space-y-2.5">
          {cfg.steps.map((s, i) => (
            <JourneyStep key={s.title} step={s} index={i} open={openStep === i} onToggle={() => setOpenStep((o) => (o === i ? null : i))} />
          ))}
        </ol>

        {cfg.loop ? (
          <div className="mt-7 rounded-2xl bg-[color:var(--ss-card-soft)] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">The correction loop</p>
            <ol className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm font-medium text-[color:var(--ss-text)]">
              {cfg.loop.map((l, i) => (
                <li key={l} className="flex items-center gap-1.5">
                  <span className="rounded-lg bg-[color:var(--ss-surface)] px-2.5 py-1 ring-1 ring-[color:var(--ss-card)]">{l}</span>
                  {i < cfg.loop!.length - 1 ? <span aria-hidden style={{ color: 'var(--ss-card-btn)' }}>→</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button onClick={onPrimary} className="ss-accent-btn ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-[filter]">
            {mode === 'guided' ? <PencilLine size={16} aria-hidden /> : <Play size={16} aria-hidden />} {cfg.primaryLabel}
          </button>
          <button onClick={onBack} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[color:var(--ss-text-secondary)] hover:text-[color:var(--ss-card-btn)]">Back to practice choices</button>
        </div>
      </div>
    </div>
  );
}
