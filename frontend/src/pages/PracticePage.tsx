/**
 * PracticePage — authenticated `/practice` entry (the first-run orientation before recording controls).
 *
 * ONE product, TWO modes. Quick Practice → its overview → "Start speaking" navigates to the UNCHANGED
 * /session (a pure navigation handoff; this page imports/changes nothing in the session runtime).
 * Guided Rehearsal is a PREVIEW ONLY: clicking it stays on /practice and expands its overview inline —
 * it exposes no working rehearsal action, no microphone, AI, DB, or external service. Report Issue
 * stays in the global authenticated Navigation and is page-aware via the /practice page-context entry.
 * Warm Theme A visuals are scoped under `.practice-root` (see styles/practice.css).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Check, Play, ChevronDown, Shield, ArrowLeft,
  Settings2, Mic, FileText, LineChart, Target,
  ClipboardList, ListChecks, Activity, Lightbulb, MessageSquarePlus, CheckCircle2, RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import '@/styles/practice.css';
import { LandingHeroArt, QuickPracticeArt, GuidedRehearsalArt } from '@/components/practice/practiceArt';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected, trackPracticeOverviewExpanded,
  trackQuickPracticeStarted, trackGuidedRehearsalPreviewViewed,
} from '@/services/practiceTelemetry';

const QUICK_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-session-accent)', ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-session-soft)', ['--ss-card-panel' as string]: 'var(--ss-session-panel)', ['--ss-card-warm' as string]: 'var(--ss-sun)',
};
const GUIDED_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-exec-accent)', ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-exec-soft)', ['--ss-card-panel' as string]: 'var(--ss-exec-panel)', ['--ss-card-warm' as string]: 'var(--ss-coral)',
};

interface Step { title: string; result: string; detail: string; Icon: LucideIcon }

const QUICK_STEPS: Step[] = [
  { title: 'Choose your transcription mode', result: 'Shown before each session — you choose.', detail: 'Pick how your speech is transcribed. SpeakSharp shows which mode is active before you start — it is never hidden.', Icon: Settings2 },
  { title: 'Start speaking', result: 'No agenda — just speak.', detail: 'Begin immediately. SpeakSharp transcribes as you go; there is nothing to set up first.', Icon: Mic },
  { title: 'Review your live transcript and delivery evidence during the session', result: 'See exactly what you said.', detail: 'Watch your live transcript during the session alongside focused delivery signals such as pace and filler words.', Icon: FileText },
  { title: 'Compare with your own prior practice', result: 'Progress vs your own baseline.', detail: 'See how this session moves relative to your earlier practice — measured against you, never a public grade.', Icon: LineChart },
  { title: 'Choose what to improve next', result: 'One clear next focus.', detail: 'Pick a single thing to work on next time, so practice compounds instead of scattering.', Icon: Target },
];

const GUIDED_STEPS: Step[] = [
  { title: 'Describe the occasion and audience', result: 'Set the context.', detail: 'Say what you’re rehearsing and who it’s for, so tracking reflects the real moment.', Icon: ClipboardList },
  { title: 'Add the points or outcomes you must cover', result: '3–5 outcomes (or a template).', detail: 'List the outcomes you need to land — or start from a prepared template.', Icon: ListChecks },
  { title: 'Rehearse while SpeakSharp tracks quietly', result: 'Passive coverage — no interruptions.', detail: 'Speak naturally. Your agenda moves from not-addressed → partly → covered without breaking your flow.', Icon: Activity },
  { title: 'Receive or request one restrained remedy when useful', result: 'One suggestion, only when helpful.', detail: 'If a point is slipping, ask for help — you get a single concise suggestion, not a stream of prompts.', Icon: Lightbulb },
  { title: 'Supplement or recover the missed point', result: 'Address it in the moment.', detail: 'Say the ask out loud; SpeakSharp watches for the recovery so the gap becomes a save.', Icon: MessageSquarePlus },
  { title: 'Review covered, partial, missed, and recovered outcomes', result: 'See the whole picture.', detail: 'A plain-language summary shows what you covered, partly covered, missed, and recovered.', Icon: CheckCircle2 },
  { title: 'Rehearse again and prove improvement', result: 'Recovery is the payoff.', detail: 'Run it again and watch missed points turn into covered ones — improvement against your own baseline.', Icon: RotateCcw },
];
const GUIDED_LOOP = ['Rehearse', 'Detect gap', 'One remedy', 'Supplement', 'Prove recovery', 'Rehearse again'];

const DISCLOSURE = 'Your available transcription options and how speech is processed are shown before each session. “Private” here means private preparation — you decide when your work is ready to share.';

function JourneyStep({ step, index, open, onToggle }: { step: Step; index: number; open: boolean; onToggle: () => void }) {
  const id = `pstep-${index}`;
  return (
    <li className={`overflow-hidden rounded-2xl transition-colors ${open ? 'bg-[color:var(--ss-card-soft)] ring-1 ring-[color:var(--ss-card)]' : 'bg-[color:var(--ss-surface)] ring-1 ring-[color:var(--ss-border)]'}`}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="ss-ring flex w-full items-center gap-4 px-4 py-3.5 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--ss-card-soft)', color: 'var(--ss-card-btn)' }}><step.Icon size={19} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: 'var(--ss-card-btn)' }}>{index + 1}</span>
            <span className="text-sm font-semibold text-[color:var(--ss-text)]">{step.title}</span>
          </span>
          <span className="mt-0.5 block pl-7 text-[13px] text-[color:var(--ss-text-secondary)]">{step.result}</span>
        </span>
        <ChevronDown size={16} aria-hidden style={{ color: 'var(--ss-card-btn)' }} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <p id={id} className="ss-fade-up px-4 pb-4 pl-[4.5rem] text-sm text-[color:var(--ss-text-secondary)]">{step.detail}</p> : null}
    </li>
  );
}

function Disclosure() {
  return (
    <p className="mt-6 inline-flex items-start gap-2 text-xs text-[color:var(--ss-neutral)]">
      <Shield size={14} aria-hidden className="mt-0.5 shrink-0" /><span>{DISCLOSURE}</span>
    </p>
  );
}

/** Quick Practice overview (model B): its own view with the 5-step journey; primary → /session. */
function QuickOverview({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  const [open, setOpen] = React.useState<number | null>(null);
  const journeyRef = React.useRef<HTMLDivElement>(null);
  return (
    <div style={QUICK_VARS}>
      <section className="ss-overview-hero">
        <div className="mx-auto max-w-5xl px-5 pb-10 pt-4 sm:px-8">
          <button onClick={onBack} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-[color:var(--ss-text-secondary)] hover:text-[color:var(--ss-card-btn)]"><ArrowLeft size={15} aria-hidden /> Back to practice choices</button>
          <div className="mt-4 grid items-center gap-6 md:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--ss-card-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">No agenda required.</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ss-text)]">Speak freely. See how you’re progressing.</h2>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">Start immediately without preparing an agenda. SpeakSharp captures your words and helps you review focused delivery evidence.</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button onClick={onStart} data-testid="practice-quick-start" className="ss-accent-btn ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm"><Play size={16} aria-hidden /> Start speaking</button>
                <button onClick={() => journeyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="ss-accent-outline ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold">See how it works</button>
              </div>
            </div>
            <div className="ss-card-panel h-40 overflow-hidden rounded-2xl ring-1 ring-[color:var(--ss-border)]"><div className="h-full w-full px-6 py-5"><QuickPracticeArt emphasis /></div></div>
          </div>
          <Disclosure />
        </div>
      </section>
      <div ref={journeyRef} className="mx-auto max-w-3xl px-5 py-9 sm:px-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">How it works</h3>
        <ol className="mt-4 space-y-2.5">
          {QUICK_STEPS.map((s, i) => <JourneyStep key={s.title} step={s} index={i} open={open === i} onToggle={() => setOpen((o) => (o === i ? null : i))} />)}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button onClick={onStart} className="ss-accent-btn ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm"><Play size={16} aria-hidden /> Start speaking</button>
          <button onClick={onBack} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[color:var(--ss-text-secondary)] hover:text-[color:var(--ss-card-btn)]">Back to practice choices</button>
        </div>
      </div>
    </div>
  );
}

/** Guided Rehearsal inline preview — stays on /practice; PREVIEW ONLY, no functional actions. */
function GuidedInlinePreview() {
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div style={GUIDED_VARS} className="ss-fade-up mt-5 overflow-hidden rounded-3xl bg-[color:var(--ss-surface)] shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)]">
      <div className="ss-card-panel border-b border-[color:var(--ss-border)] px-6 py-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--ss-card-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">Preview · coming soon</span>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ss-text)]">Prepare what matters. Rehearse until it lands.</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">Here’s how Guided Rehearsal will work. It isn’t available to start yet — this is a preview of the experience we’re building.</p>
      </div>
      <div className="px-6 py-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">How it will work</h3>
        <ol className="mt-4 space-y-2.5">
          {GUIDED_STEPS.map((s, i) => <JourneyStep key={s.title} step={s} index={i} open={open === i} onToggle={() => setOpen((o) => (o === i ? null : i))} />)}
        </ol>
        <div className="mt-7 rounded-2xl bg-[color:var(--ss-card-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">The correction loop</p>
          <ol className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm font-medium text-[color:var(--ss-text)]">
            {GUIDED_LOOP.map((l, i) => (
              <li key={l} className="flex items-center gap-1.5">
                <span className="rounded-lg bg-[color:var(--ss-surface)] px-2.5 py-1 ring-1 ring-[color:var(--ss-card)]">{l}</span>
                {i < GUIDED_LOOP.length - 1 ? <span aria-hidden style={{ color: 'var(--ss-card-btn)' }}>→</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function ModeCard({ vars, art, title, promise, description, marker, ctaLabel, ctaAria, onClick, selected, testid }: {
  vars: React.CSSProperties; art: React.ReactNode; title: string; promise: string; description: string;
  marker: string; ctaLabel: string; ctaAria: string; onClick: () => void; selected?: boolean; testid: string;
}) {
  // Semantic card: an <article> with a real heading and a single, keyboard-operable CTA <button>. The
  // card is NOT itself a button — an interactive element must not contain headings/paragraphs/blocks
  // (invalid HTML + confusing for assistive tech). The whole product is understandable from the heading,
  // promise, description and marker (text, never color alone); the button carries the action.
  return (
    <article style={vars}
      className={`group ss-mode-card flex flex-col overflow-hidden rounded-3xl bg-[color:var(--ss-surface)] transition-all duration-200 ${selected ? 'shadow-xl shadow-slate-900/[0.12] ring-2 ring-[color:var(--ss-card)] -translate-y-1' : 'shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)] hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/[0.10] hover:ring-2 hover:ring-[color:var(--ss-card)]'}`}>
      <div className="ss-card-panel relative h-20 border-b border-[color:var(--ss-border)]"><div className="absolute inset-0 px-5 py-3">{art}</div></div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold text-[color:var(--ss-text)]">{title}</h3>
        <p className="mt-0.5 text-sm font-semibold text-[color:var(--ss-card-btn)]">{promise}</p>
        <p className="mt-2 text-sm text-[color:var(--ss-text-secondary)]">{description}</p>
        <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-[color:var(--ss-card-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--ss-card-btn)]"><Check size={13} aria-hidden /> {marker}</span>
        <button type="button" onClick={onClick} data-testid={testid} aria-expanded={selected} aria-label={ctaAria}
          className="ss-accent-outline ss-ring mt-4 inline-flex w-fit items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold">
          {ctaLabel} <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}

export default function PracticePage() {
  const navigate = useNavigate();
  const [view, setView] = React.useState<'landing' | 'quick-overview'>('landing');
  const [guidedExpanded, setGuidedExpanded] = React.useState(false);
  const returning = React.useRef(false);

  React.useEffect(() => {
    try {
      returning.current = localStorage.getItem('speaksharp_practice_seen') === '1';
      localStorage.setItem('speaksharp_practice_seen', '1');
    } catch { /* ignore storage errors */ }
    trackPracticeEntryViewed(returning.current);
  }, []);

  const openQuick = () => { trackPracticeModeSelected('quick', 'landing_card'); trackPracticeOverviewExpanded('quick'); setView('quick-overview'); };
  const toggleGuided = () => {
    setGuidedExpanded((e) => {
      const next = !e;
      if (next) { trackPracticeModeSelected('guided', 'landing_card'); trackPracticeOverviewExpanded('guided'); trackGuidedRehearsalPreviewViewed(); }
      return next;
    });
  };
  const startQuick = () => { trackQuickPracticeStarted('quick_overview'); navigate('/session'); };

  return (
    // NOTE: no <main> / #main-content here — App.tsx owns the single page <main id="main-content">
    // landmark. Rendering another would create nested <main> elements and a duplicate id, breaking the
    // skip-link target and assistive-tech landmark navigation. This is a plain content container.
    <div className="practice-root ss-landing-canvas min-h-screen font-sans antialiased" data-testid="practice-root">
      <div className="practice-content">
        {view === 'quick-overview' ? (
          <QuickOverview onStart={startQuick} onBack={() => setView('landing')} />
        ) : (
          <>
            <div className="ss-theme-hero">
              <div className="mx-auto max-w-5xl px-5 pb-12 pt-6 sm:px-8">
                <div className="mt-1 grid items-center gap-6 md:grid-cols-[1fr_18rem]">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight text-[color:var(--ss-text)] sm:text-4xl">Private Practice. Public Impact!</h1>
                    <span aria-hidden className="mt-2 block h-1 w-16 rounded-full" style={{ background: 'var(--ss-amber)' }} />
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">SpeakSharp helps you practice important speaking moments, review focused feedback, and see how you improve over time. Choose the type of practice that matches what you need today.</p>
                    <p className="mt-4 text-sm font-semibold text-[color:var(--ss-text)]">Do you want to speak freely, or practice toward specific outcomes?</p>
                  </div>
                  <div className="hidden h-44 w-72 md:block"><LandingHeroArt /></div>
                </div>
              </div>
            </div>

            <div className="mx-auto -mt-6 max-w-5xl px-5 pb-12 sm:px-8">
              <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2">
                <ModeCard vars={QUICK_VARS} art={<QuickPracticeArt />} title="Quick Practice" promise="Speak freely. See how you’re progressing."
                  description="Start immediately without an agenda. Review your live transcript and delivery evidence during the session, and see progress against your own prior practice."
                  marker="No agenda required." ctaLabel="Explore Quick Practice" ctaAria="Explore Quick Practice" onClick={openQuick} testid="practice-card-quick" />
                <ModeCard vars={GUIDED_VARS} art={<GuidedRehearsalArt />} title="Guided Rehearsal" promise="Prepare what matters. Rehearse until it lands."
                  description="Start with the outcomes you need to cover; rehearse while SpeakSharp tracks coverage and helps you recover missed points."
                  marker="Agenda and outcome guided." ctaLabel={guidedExpanded ? 'Hide preview' : 'See how it works'} ctaAria={`${guidedExpanded ? 'Hide' : 'Show'} the Guided Rehearsal preview`} onClick={toggleGuided} selected={guidedExpanded} testid="practice-card-guided" />
              </div>

              {guidedExpanded ? <GuidedInlinePreview /> : null}

              <p className="mt-5 text-center text-sm text-[color:var(--ss-text-secondary)]">Not sure? Start with <span className="font-semibold text-[color:var(--ss-text)]">Quick Practice</span> — you can use both anytime.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
