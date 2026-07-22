/**
 * Phase 2 SANDBOX — Rehearse screen (calm, passive cockpit) with the full recording-state system:
 * Ready → Listening → Paused (and Finish → Processing → Complete, handled by the controller).
 *
 * The agenda is the quiet focal point. As the (simulated) speech arrives, items move gray → yellow →
 * green passively. NO score, percentage, WPM, filler count, or formula appears while speaking. The
 * user may ask for help on one incomplete point → one concise remedy → supplement → evidence-backed
 * recovery. Nothing interrupts automatically.
 */

import React from 'react';
import { HelpCircle, Mic, Pause, Play } from 'lucide-react';
import { mapTalkingPointCoverage, type TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';
import { type AgendaVisualState } from '../theme';
import { AgendaDot, PrimaryButton, SecondaryButton, GhostButton, RecordingIndicator, type RecordStatus } from '../components/ui';
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
  const [status, setStatus] = React.useState<RecordStatus>('ready');
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [supplementApplied, setSupplementApplied] = React.useState(false);
  const [recovered, setRecovered] = React.useState<Set<number>>(new Set());
  const [helpFor, setHelpFor] = React.useState<number | null>(null);

  // One interval; advances the clock only while listening (so Pause genuinely holds the timeline).
  const statusRef = React.useRef(status);
  statusRef.current = status;
  React.useEffect(() => {
    const id = window.setInterval(() => { if (statusRef.current === 'listening') setElapsedMs((e) => e + 200); }, 200);
    return () => window.clearInterval(id);
  }, []);

  const activeSegments: TranscriptSegment[] = [
    ...SAMPLE_TIMELINE.filter((s) => s.atMs <= elapsedMs).map((s) => ({ startSec: s.startSec, text: s.text })),
    ...(supplementApplied ? [SAMPLE_REMEDY.supplement] : []),
  ];
  const coverage = mapTalkingPointCoverage(points, activeSegments);
  const stateOf = (i: number): AgendaVisualState => {
    if (recovered.has(i)) return 'recovered';
    const s = coverage[i].status;
    return s === 'missing' ? 'not_addressed' : s;
  };

  const begin = () => { setStatus('listening'); trace('rehearsal_started', { mode: 'rehearsal', visibleItemCount: points.length }); };
  const requestHelp = (i: number) => { setHelpFor(i); trace('help_requested', { mode: 'rehearsal' }); trace('remedy_shown', { mode: 'rehearsal' }); };

  const markAddressed = (i: number) => {
    if (i === SAMPLE_REMEDY.pointIndex) {
      const re = mapTalkingPointCoverage(points, [...activeSegments, SAMPLE_REMEDY.supplement]);
      if (re[i].status === 'covered' && re[i].evidence && re[i].evidence.timestampSec >= SAMPLE_REMEDY.supplement.startSec) {
        setSupplementApplied(true);
        setRecovered((prev) => new Set(prev).add(i));
        trace('point_recovered', { mode: 'rehearsal', agendaState: 'recovered' });
      }
    }
    setHelpFor(null);
  };

  const finish = () => {
    const cov = mapTalkingPointCoverage(points, activeSegments);
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

  const seconds = Math.floor(elapsedMs / 1000);
  const speaking = status === 'listening' || status === 'paused';

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-900 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        {/* Recording state + controls */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <RecordingIndicator status={status} seconds={speaking ? seconds : undefined} />
          <div className="flex items-center gap-2">
            {status === 'ready' ? (
              <PrimaryButton className="px-4 py-2 text-sm" onClick={begin}><Mic size={16} aria-hidden /> Begin speaking</PrimaryButton>
            ) : status === 'listening' ? (
              <SecondaryButton className="border-slate-500 bg-slate-700 text-white hover:bg-slate-600" onClick={() => setStatus('paused')}><Pause size={15} aria-hidden /> Pause</SecondaryButton>
            ) : (
              <PrimaryButton className="px-4 py-2 text-sm" onClick={() => setStatus('listening')}><Play size={15} aria-hidden /> Resume</PrimaryButton>
            )}
          </div>
        </div>

        <p className="mb-1 text-sm text-slate-400">Rehearsing for {SAMPLE_BRIEF.audience.toLowerCase()}</p>
        <h2 className="mb-8 text-xl font-semibold text-white">
          {status === 'ready' ? 'Ready when you are — press Begin and speak.' : status === 'paused' ? 'Paused — resume when you’re ready.' : 'Speak naturally — your agenda tracks itself.'}
        </h2>

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

                {speaking && incomplete && !helping ? (
                  <GhostButton className="mt-2 text-indigo-300 hover:bg-slate-700/60" onClick={() => requestHelp(i)}>
                    <HelpCircle size={14} aria-hidden /> Help me with this point
                  </GhostButton>
                ) : null}

                {helping ? (
                  <div className="ss-fade-up mt-3 rounded-xl bg-slate-900/70 p-3 ring-1 ring-slate-700">
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
          <PrimaryButton onClick={finish} disabled={status === 'ready'}>Finish rehearsal</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
