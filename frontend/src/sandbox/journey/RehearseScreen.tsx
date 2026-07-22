/**
 * Phase 2 SANDBOX — Rehearse screen (the calm, passive cockpit).
 *
 * The agenda is the quiet focal point. As the (scripted) speech arrives, items move gray → yellow →
 * green passively. NO score, percentage, WPM, filler count, or formula appears while speaking. The
 * user may ask for help on one incomplete point → one concise remedy → supplement → evidence-backed
 * recovery. Nothing interrupts automatically.
 */

import React from 'react';
import { HelpCircle, Clock } from 'lucide-react';
import { mapTalkingPointCoverage, type TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';
import { T, type AgendaVisualState } from '../theme';
import { AgendaDot, PrimaryButton, SecondaryButton, GhostButton, ListeningPulse } from '../components/ui';
import { SAMPLE_BRIEF, SAMPLE_TIMELINE, SAMPLE_REMEDY, SAMPLE_NEXT_FOCUS_INDEX } from '../sample';
import { trace } from '../trace';

export interface RehearsalResult {
  points: { point: string; state: AgendaVisualState; evidence?: { quote: string; timestampSec: number } }[];
  summary: { covered: number; partial: number; notAddressed: number; recovered: number; total: number };
  nextFocusIndex: number;
}

const REMEDIES: Record<number, string> = {
  1: 'Name the specific accounts at risk and the one action you want the board to take.',
  2: SAMPLE_REMEDY.text,
  3: 'Give the board the dates — design in October, rollout in November.',
};

export function RehearseScreen({ onFinish, onBack }: { onFinish: (r: RehearsalResult) => void; onBack: () => void }) {
  const points = SAMPLE_BRIEF.talkingPoints;
  const [segments, setSegments] = React.useState<TranscriptSegment[]>([]);
  const [elapsed, setElapsed] = React.useState(0);
  const [recovered, setRecovered] = React.useState<Set<number>>(new Set());
  const [helpFor, setHelpFor] = React.useState<number | null>(null);

  // Timer + scripted speech playback (the sandbox stands in for a live mic).
  React.useEffect(() => {
    trace('rehearsal_started', { mode: 'rehearsal', visibleItemCount: points.length });
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    const timers = SAMPLE_TIMELINE.map((s) =>
      window.setTimeout(() => setSegments((prev) => [...prev, { startSec: s.startSec, text: s.text }]), s.atMs),
    );
    return () => { window.clearInterval(tick); timers.forEach((t) => window.clearTimeout(t)); };
  }, [points.length]);

  const coverage = mapTalkingPointCoverage(points, segments);
  const stateOf = (i: number): AgendaVisualState => {
    if (recovered.has(i)) return 'recovered';
    const s = coverage[i].status;
    return s === 'missing' ? 'not_addressed' : s;
  };

  const requestHelp = (i: number) => { setHelpFor(i); trace('help_requested', { mode: 'rehearsal' }); trace('remedy_shown', { mode: 'rehearsal' }); };

  const markAddressed = (i: number) => {
    if (i === SAMPLE_REMEDY.pointIndex) {
      const withSupp = [...segments, SAMPLE_REMEDY.supplement];
      const re = mapTalkingPointCoverage(points, withSupp);
      if (re[i].status === 'covered' && re[i].evidence && re[i].evidence.timestampSec >= SAMPLE_REMEDY.supplement.startSec) {
        setSegments(withSupp);
        setRecovered((prev) => new Set(prev).add(i));
        trace('point_recovered', { mode: 'rehearsal', agendaState: 'recovered' });
      }
    }
    setHelpFor(null);
  };

  const finish = () => {
    // `segments` already includes the supplement once a point is recovered.
    const cov = mapTalkingPointCoverage(points, segments);
    const result: RehearsalResult = {
      points: points.map((p, i) => ({
        point: p,
        state: stateOf(i),
        evidence: cov[i].evidence ? { quote: cov[i].evidence.quote, timestampSec: cov[i].evidence.timestampSec } : undefined,
      })),
      summary: {
        covered: points.filter((_, i) => stateOf(i) === 'covered').length,
        partial: points.filter((_, i) => stateOf(i) === 'partial').length,
        notAddressed: points.filter((_, i) => stateOf(i) === 'not_addressed').length,
        recovered: recovered.size,
        total: points.length,
      },
      nextFocusIndex: SAMPLE_NEXT_FOCUS_INDEX,
    };
    trace('rehearsal_finished', { mode: 'rehearsal' });
    onFinish(result);
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className={`min-h-[calc(100vh-4rem)] ${T.frame} px-5 py-8 sm:px-8`}>
      <div className="mx-auto max-w-2xl">
        {/* Speaking state — calm, no metrics */}
        <div className="mb-8 flex items-center justify-between">
          <ListeningPulse />
          <span className="inline-flex items-center gap-1.5 text-sm font-medium tabular-nums text-slate-300">
            <Clock size={14} aria-hidden /> {mm}:{ss}
          </span>
        </div>

        <p className={`mb-1 text-sm ${T.frameSubtle}`}>Rehearsing for {SAMPLE_BRIEF.audience.toLowerCase()}</p>
        <h2 className="mb-8 text-xl font-semibold text-white">Speak naturally — your agenda tracks itself.</h2>

        {/* The agenda rail — the quiet focal point */}
        <ol aria-label="Agenda" className="space-y-3">
          {points.map((p, i) => {
            const state = stateOf(i);
            const incomplete = state === 'not_addressed' || state === 'partial';
            const helping = helpFor === i;
            return (
              <li key={i} className="rounded-2xl bg-slate-800/60 p-4 ring-1 ring-slate-700/60">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-start gap-3">
                    <AgendaDot state={state} className="mt-0.5" />
                    <span className="text-[15px] text-slate-100">{p}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-slate-400">
                    {state === 'covered' ? 'Covered' : state === 'partial' ? 'Partly' : state === 'recovered' ? 'Recovered' : '—'}
                  </span>
                </div>

                {incomplete && !helping ? (
                  <GhostButton className="mt-2 text-indigo-300 hover:bg-slate-700/60" onClick={() => requestHelp(i)}>
                    <HelpCircle size={14} aria-hidden /> Help me with this point
                  </GhostButton>
                ) : null}

                {helping ? (
                  <div className="mt-3 rounded-xl bg-slate-900/70 p-3 ring-1 ring-slate-700">
                    <p className="text-sm text-slate-200"><span className="font-semibold text-indigo-300">One suggestion:</span> {REMEDIES[i]}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <PrimaryButton className="px-4 py-2 text-sm" onClick={() => markAddressed(i)}>I addressed it just now</PrimaryButton>
                      <SecondaryButton className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" onClick={() => setHelpFor(null)}>Keep going</SecondaryButton>
                    </div>
                    {i !== SAMPLE_REMEDY.pointIndex ? (
                      <p className="mt-2 text-xs text-slate-400">It only turns green with actual transcript evidence — say it explicitly and it will update.</p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-8 flex items-center justify-between">
          <button onClick={onBack} className="text-sm font-medium text-slate-400 hover:text-slate-200">← Back</button>
          <PrimaryButton onClick={finish}>Finish rehearsal</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
