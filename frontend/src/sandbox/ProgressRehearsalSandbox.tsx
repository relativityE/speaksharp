/**
 * Phase 2 SANDBOX — journey controller (the DEFAULT product experience).
 *
 * Prepare → Rehearse → (Help → Recover) → Summary, with a ready-made sample so review needs no setup.
 * The analytical states (the 8 fixtures) live in a separate, collapsed "Review all states (QA)" panel
 * so a first-time reviewer sees a product, not a test harness.
 *
 * LOCALHOST ONLY. Standalone Vite entry; no app provider/store/service, no network, no production data.
 */

import React from 'react';
import { FlaskConical } from 'lucide-react';
import { T } from './theme';
import { JourneySteps } from './components/ui';
import { PrepareScreen } from './journey/PrepareScreen';
import { RehearseScreen, type RehearsalResult } from './journey/RehearseScreen';
import { FinishScreen } from './journey/FinishScreen';
import { ReviewPanel } from './components/ReviewPanel';
import { trace } from './trace';

type Phase = 'prepare' | 'rehearse' | 'finish';
type FinishData = { kind: 'rehearsal'; result: RehearsalResult } | { kind: 'general'; which: 'baseline' | 'improved' };

export function ProgressRehearsalSandbox() {
  const [phase, setPhase] = React.useState<Phase>('prepare');
  const [finish, setFinish] = React.useState<FinishData | null>(null);

  React.useEffect(() => { trace('sandbox_loaded', {}); }, []);

  const toPrepare = () => { setFinish(null); setPhase('prepare'); };
  const startRehearsal = () => setPhase('rehearse');
  const startGeneral = () => { setFinish({ kind: 'general', which: 'improved' }); setPhase('finish'); };
  const onRehearsalFinish = (result: RehearsalResult) => { setFinish({ kind: 'rehearsal', result }); setPhase('finish'); };
  const toggleGeneralKind = () =>
    setFinish((f) => (f && f.kind === 'general' ? { kind: 'general', which: f.which === 'improved' ? 'baseline' : 'improved' } : f));

  return (
    <div className={`min-h-screen ${T.frame} font-sans antialiased`}>
      {/* App bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-3">
          <FlaskConical className="text-indigo-400" size={20} aria-hidden />
          <span className="mr-auto font-semibold text-white">SpeakSharp · Executive Rehearsal</span>
          <div className="hidden sm:block"><JourneySteps current={phase} /></div>
          <span className="rounded-full border border-amber-500/40 bg-amber-400/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-300">Sandbox</span>
        </div>
      </header>

      <main id="main-content">
        {phase === 'prepare' ? (
          <PrepareScreen onStart={startRehearsal} onStartGeneral={startGeneral} />
        ) : phase === 'rehearse' ? (
          <RehearseScreen onFinish={onRehearsalFinish} onBack={toPrepare} />
        ) : finish?.kind === 'rehearsal' ? (
          <FinishScreen rehearsal={finish.result} onAgain={toPrepare} />
        ) : finish?.kind === 'general' ? (
          <FinishScreen generalKind={finish.which} onAgain={toPrepare} onToggleKind={toggleGeneralKind} />
        ) : null}
      </main>

      {/* Secondary: QA states, collapsed and clearly separated (below the product experience) */}
      <div className="px-5 pb-10">
        <ReviewPanel />
      </div>
    </div>
  );
}
