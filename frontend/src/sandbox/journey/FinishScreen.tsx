/**
 * Phase 2 SANDBOX — Finish screen (the payoff).
 *
 * Leads with a plain-language outcome; recovery is the positive moment. Raw human-readable movement
 * comes before any percentage, and the percentage / baseline / target / formula / transcript evidence
 * all live behind "How SpeakSharp determined this". Agenda coverage and delivery progress stay
 * separate. Exactly one recommended next focus, and one obvious next action: Rehearse again.
 */

import React from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { T } from '../theme';
import { Panel, PrimaryButton, GhostButton, StatusChip, Disclosure } from '../components/ui';
import { cumulativeProgress, roundPct, describeTarget, type TargetShape } from '../progressMath';
import { SAMPLE_BRIEF, GENERAL_IMPROVED, GENERAL_BASELINE, type DeliverySample } from '../sample';
import type { RehearsalResult } from './RehearseScreen';
import { trace } from '../trace';

// Returns a clause that reads naturally after "You " (e.g. "You used 3 fewer filler words…").
function rawMovement(m: DeliverySample['metrics'][number]): string {
  const delta = Math.round((m.fixedBaseline - m.current) * 10) / 10;
  if (m.key === 'fillers') return delta > 0 ? `used ${delta} fewer filler words per minute than your baseline` : `used ${Math.abs(delta)} more filler words per minute than your baseline`;
  if (m.key === 'pace') {
    const t = m.target as TargetShape;
    if (t.kind === 'range' && m.current >= t.lo && m.current <= t.hi) return `brought your pace into your ${t.lo}–${t.hi} WPM range`;
    return `changed your pace from ${m.fixedBaseline} to ${m.current} WPM`;
  }
  return `moved ${m.label.toLowerCase()} from ${m.fixedBaseline} to ${m.current}`;
}

function DeliveryDetails({ sample }: { sample: DeliverySample }) {
  return (
    <ul className="space-y-2 tabular-nums">
      {sample.metrics.map((m) => {
        if (!m.eligible) return <li key={m.key}>{m.label}: {m.fixedBaseline}{m.unit} → {m.current}{m.unit} <span className="text-[color:var(--ss-neutral)]">(raw direction only — {m.ineligibleReason})</span></li>;
        const cur = cumulativeProgress(m.fixedBaseline, m.current, m.target as TargetShape);
        return (
          <li key={m.key}>
            {m.label}: baseline {m.fixedBaseline}{m.unit}{m.previous !== undefined ? ` → ${m.previous}${m.unit} previous` : ''} → {m.current}{m.unit}; goal {describeTarget(m.target as TargetShape, m.unit)};{' '}
            {cur.maintained ? 'target maintained' : cur.cumulativePct !== null ? `${roundPct(cur.cumulativePct)}% of the original gap closed` : '—'}
          </li>
        );
      })}
    </ul>
  );
}

function GeneralFinish({ sample, onAgain, onToggleKind }: { sample: DeliverySample; onAgain: () => void; onToggleKind?: () => void }) {
  const eligible = sample.metrics.filter((m) => m.eligible);
  const toggleLabel = sample.firstSession ? 'See a returning-session example →' : 'See a first-session (baseline) example →';
  if (sample.firstSession) {
    return (
      <Panel>
        <p className="text-sm font-medium text-[color:var(--ss-primary)]">General practice</p>
        <h2 className={`mt-1 text-2xl font-semibold ${T.ink}`}>Personal baseline set.</h2>
        <p className={`mt-3 text-[15px] ${T.body}`}>This session is your starting point — not a grade. Practice again and you'll see how you're moving relative to your own baseline.</p>
        <ul className="mt-4 space-y-1 text-[15px] text-[color:var(--ss-text-secondary)] tabular-nums">
          {sample.metrics.map((m) => <li key={m.key}>{m.label}: {m.current}{m.unit}</li>)}
        </ul>
        <Disclosure summary="How SpeakSharp determined this" onOpen={() => trace('details_opened', { mode: 'general' })}>
          <DeliveryDetails sample={sample} />
        </Disclosure>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={onAgain}><RotateCcw size={18} aria-hidden /> Practice again</PrimaryButton>
          {onToggleKind ? <GhostButton onClick={onToggleKind}>{toggleLabel}</GhostButton> : null}
        </div>
      </Panel>
    );
  }
  return (
    <Panel>
      <p className="text-sm font-medium text-[color:var(--ss-primary)]">General practice</p>
      <h2 className={`mt-1 text-2xl font-semibold ${T.ink}`}>You improved on your last comparable session.</h2>
      <ul className="mt-4 space-y-2 text-[17px] font-medium text-[color:var(--ss-text)]">
        {eligible.map((m) => <li key={m.key} className="flex items-start gap-2"><span aria-hidden className="mt-1 text-[color:var(--ss-success)]">✓</span>You {rawMovement(m)}.</li>)}
      </ul>
      <p className={`mt-3 text-sm ${T.subtle}`}>
        Halfway from your baseline to your filler target; pace is now inside your range. <span className="text-[color:var(--ss-neutral)]">(progress percentages are in the details)</span>
      </p>
      <Disclosure summary="How SpeakSharp determined this" onOpen={() => trace('details_opened', { mode: 'general' })}>
        <DeliveryDetails sample={sample} />
      </Disclosure>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={onAgain}><RotateCcw size={18} aria-hidden /> Practice again</PrimaryButton>
        {onToggleKind ? <GhostButton onClick={onToggleKind}>{toggleLabel}</GhostButton> : null}
      </div>
    </Panel>
  );
}

export function FinishScreen({
  rehearsal,
  generalKind,
  onAgain,
  onToggleKind,
}: {
  rehearsal?: RehearsalResult;
  generalKind?: 'baseline' | 'improved';
  onAgain: () => void;
  onToggleKind?: () => void;
}) {
  const wrap = (child: React.ReactNode) => <div className={`min-h-[calc(100vh-3.5rem)] px-5 py-10 sm:px-8`}><div className="mx-auto max-w-2xl">{child}</div></div>;

  if (generalKind) return wrap(<GeneralFinish sample={generalKind === 'baseline' ? GENERAL_BASELINE : GENERAL_IMPROVED} onAgain={onAgain} onToggleKind={onToggleKind} />);
  if (!rehearsal) return wrap(<Panel>No result.</Panel>);

  const s = rehearsal.summary;
  const addressed = s.covered + s.recovered;
  const recoveredPoint = rehearsal.points.find((p) => p.state === 'recovered');
  const nextFocus = SAMPLE_BRIEF.talkingPoints[rehearsal.nextFocusIndex];

  return wrap(
    <Panel>
      <p className="text-sm font-medium text-[color:var(--ss-primary)]">Rehearsal summary</p>

      {recoveredPoint ? (
        <div className="mt-2 flex items-start gap-2">
          <Sparkles className="mt-1 shrink-0 text-[color:var(--ss-listening)]" size={22} aria-hidden />
          <h2 className={`text-2xl font-semibold ${T.ink}`}>You recovered the approval request after asking for help.</h2>
        </div>
      ) : (
        <h2 className={`mt-2 text-2xl font-semibold ${T.ink}`}>Here's how your rehearsal went.</h2>
      )}

      <p className={`mt-3 text-[17px] ${T.body}`}>
        You addressed <strong>{addressed} of your {s.total}</strong> intended points{s.partial ? `, partly covered ${s.partial}` : ''}, and have{' '}
        <strong>{s.notAddressed}</strong> to revisit.
      </p>

      <ul aria-label="Agenda outcome" className="mt-5 space-y-2">
        {rehearsal.points.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--ss-border)] bg-white px-3.5 py-2.5">
            <span className="text-[15px] text-[color:var(--ss-text)]">{p.point}</span>
            <StatusChip state={p.state} />
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-2xl bg-[color:var(--ss-primary-soft)] px-4 py-3">
        <p className="text-sm font-semibold text-[color:var(--ss-primary-soft-text)]">Next run</p>
        <p className="text-[15px] text-[color:var(--ss-primary-soft-text)]">Make the {nextFocus.replace(/^Outline the /, '').toLowerCase()} explicit.</p>
      </div>

      <Disclosure summary="How SpeakSharp determined this" onOpen={() => trace('details_opened', { mode: 'rehearsal' })}>
        <p className="mb-2 font-medium text-[color:var(--ss-text-secondary)]">Agenda coverage — from your transcript (kept separate from delivery):</p>
        <ul className="mb-3 space-y-1">
          {rehearsal.points.map((p, i) => (
            <li key={i}>{p.point}: <strong>{p.state.replace('_', ' ')}</strong>{p.evidence ? ` — "${p.evidence.quote}" (@ ${p.evidence.timestampSec}s)` : ''}</li>
          ))}
        </ul>
        <p className="mb-2 font-medium text-[color:var(--ss-text-secondary)]">Delivery movement this session (supporting evidence, not a grade):</p>
        <DeliveryDetails sample={GENERAL_IMPROVED} />
      </Disclosure>

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton onClick={() => { trace('rehearse_again', { mode: 'rehearsal' }); onAgain(); }}><RotateCcw size={18} aria-hidden /> Rehearse again</PrimaryButton>
      </div>
    </Panel>,
  );
}
