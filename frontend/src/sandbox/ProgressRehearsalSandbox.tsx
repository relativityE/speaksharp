/**
 * Phase 2 SANDBOX — journey controller (the DEFAULT product experience).
 *
 * Landing (activity launcher) → Prepare → Rehearse → (Help → Recover) → Processing → Summary, with a
 * ready-made sample so review needs no setup. The analytical states (the 8 fixtures) live in a
 * separate, collapsed "Review all states (QA)" panel so a first-time reviewer sees a product, not a
 * test harness. After a first rehearsal the landing collapses into a compact returning-user view.
 *
 * LOCALHOST ONLY. Standalone Vite entry; no app provider/store/service, no network, no production data.
 */

import React from 'react';
import { FlaskConical } from 'lucide-react';
import { T } from './theme';
import { JourneySteps } from './components/ui';
import { LandingScreen, type LandingTheme } from './journey/LandingScreen';
import { CompareBoard } from './journey/CompareBoard';
import { PrepareScreen } from './journey/PrepareScreen';
import { RehearseScreen, type RehearsalResult } from './journey/RehearseScreen';
import { ProcessingScreen } from './journey/ProcessingScreen';
import { FinishScreen } from './journey/FinishScreen';
import { HandoffScreen } from './journey/HandoffScreen';
import { ReviewPanel } from './components/ReviewPanel';
import { PaletteSheet } from './components/PaletteSheet';
import { trace } from './trace';

type Phase = 'landing' | 'handoff' | 'prepare' | 'rehearse' | 'processing' | 'finish';
type FinishData = { kind: 'rehearsal'; result: RehearsalResult } | { kind: 'general'; which: 'baseline' | 'improved' };

// QA/reviewer controls are kept OUT of the product frame — available only via ?qa=1.
const qaEnabled = () => {
  try { return new URLSearchParams(window.location.search).get('qa') === '1'; } catch { return false; }
};

// Landing theme-comparison gate (localhost review). ?compare=1 shows all three side-by-side; ?theme=
// selects which candidate landing theme this instance renders (default 'a', the recommended theme —
// a default preview only, NOT a selection). No theme is propagated to downstream screens.
const compareEnabled = () => {
  try { return new URLSearchParams(window.location.search).get('compare') === '1'; } catch { return false; }
};
const readTheme = (): LandingTheme => {
  try {
    const t = new URLSearchParams(window.location.search).get('theme');
    return t === 'b' || t === 'c' ? t : 'a';
  } catch { return 'a'; }
};

export function ProgressRehearsalSandbox() {
  const [phase, setPhase] = React.useState<Phase>('landing');
  const [finish, setFinish] = React.useState<FinishData | null>(null);
  const [hasRehearsed, setHasRehearsed] = React.useState(false);
  const [lastMode, setLastMode] = React.useState<'session' | 'exec' | undefined>(undefined);

  React.useEffect(() => { trace('sandbox_loaded', {}); }, []);

  const toLanding = () => { setFinish(null); setPhase('landing'); };
  const landingActions = {
    startRehearsal: () => { setLastMode('exec'); setPhase('rehearse'); },
    createRehearsal: () => { setLastMode('exec'); setPhase('prepare'); },
    startSession: () => { setLastMode('session'); setPhase('handoff'); }, // doorway to existing /session
    reviewProgress: () => { setFinish({ kind: 'general', which: 'improved' }); setPhase('finish'); },
  };

  const onRehearsalFinish = (result: RehearsalResult) => { setHasRehearsed(true); setFinish({ kind: 'rehearsal', result }); setPhase('processing'); };
  const toggleGeneralKind = () =>
    setFinish((f) => (f && f.kind === 'general' ? { kind: 'general', which: f.which === 'improved' ? 'baseline' : 'improved' } : f));

  // Theme-comparison board (localhost review) — full-page, no product app bar, no theme selected.
  if (compareEnabled()) return <CompareBoard />;

  const isLanding = phase === 'landing';

  // Theme A ("Vibrant Confidence") is the selected sandbox direction and the default for the WHOLE
  // journey — data-ss-theme on the app root flows the theme through every downstream screen, so no old
  // navy/ivory palette remains. readTheme() still honours ?theme=b|c (used only by the compare board's
  // per-theme iframes); with no query it resolves to 'a'.
  const theme = readTheme();

  return (
    <div data-ss-theme={theme} className={`min-h-screen ${isLanding ? '' : T.canvas} font-sans antialiased`}>
      {/* App bar — light Theme A surface (NOT on the landing, which carries its own integrated hero) */}
      {!isLanding ? (
        <header className="border-b border-[color:var(--ss-border)] bg-[color:var(--ss-surface)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-3">
            <FlaskConical style={{ color: 'var(--ss-primary)' }} size={20} aria-hidden />
            <span className="mr-auto font-semibold text-[color:var(--ss-text)]">SpeakSharp</span>
            {phase !== 'handoff' ? <div className="hidden sm:block"><JourneySteps current={phase === 'processing' ? 'rehearse' : phase === 'prepare' ? 'prepare' : phase === 'rehearse' ? 'rehearse' : 'finish'} /></div> : null}
            <span className="rounded-full border border-[color:var(--ss-border)] bg-[color:var(--ss-canvas)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">Sandbox</span>
          </div>
        </header>
      ) : null}

      <main id="main-content">
        {phase === 'landing' ? (
          <LandingScreen actions={landingActions} returning={hasRehearsed} lastMode={lastMode} theme={theme} />
        ) : phase === 'handoff' ? (
          <HandoffScreen onBack={toLanding} />
        ) : phase === 'prepare' ? (
          <PrepareScreen onStart={landingActions.startRehearsal} onStartGeneral={landingActions.startSession} />
        ) : phase === 'rehearse' ? (
          <RehearseScreen onFinish={onRehearsalFinish} onBack={toLanding} />
        ) : phase === 'processing' ? (
          <ProcessingScreen onDone={() => setPhase('finish')} />
        ) : finish?.kind === 'rehearsal' ? (
          <FinishScreen rehearsal={finish.result} onAgain={toLanding} />
        ) : finish?.kind === 'general' ? (
          <FinishScreen generalKind={finish.which} onAgain={toLanding} onToggleKind={toggleGeneralKind} />
        ) : null}
      </main>

      {/* Review/QA tooling is NOT part of the product frame — only via ?qa=1 (separate review mode). */}
      {qaEnabled() ? (
        <div className="mx-auto max-w-5xl space-y-4 px-5 pb-10">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ss-neutral)]">Sandbox review mode (?qa=1) — not product UI</p>
          <ReviewPanel />
          <details className="rounded-2xl bg-white ring-1 ring-[color:var(--ss-border)]">
            <summary className="ss-ring cursor-pointer list-none px-5 py-3 text-sm font-semibold text-[color:var(--ss-text)]">Design tokens &amp; palette (QA)</summary>
            <div className="px-4 pb-4"><PaletteSheet /></div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
