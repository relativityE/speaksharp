/**
 * Phase 2 SANDBOX — Executive Rehearsal view (optional agenda, passive-first).
 *
 * A passive agenda rail (not addressed / partly / covered / recovered) with color NEVER the only
 * signal (icon + text label always present), evidence-backed coverage, and the intervention order:
 * passive tracking → user requests help → one remedy → evidence-backed recovery. Agenda coverage is
 * kept strictly separate from delivery progress.
 */

import React from 'react';
import { Circle, CircleDashed, CheckCircle2, Sparkles, Quote } from 'lucide-react';
import { Card, CardHeader, CardBody, StatePill, Disclosure, type Tone } from './primitives';
import type { RehearsalFixture } from '../fixtures';
import { computeAgendaCoverage, type AgendaState } from '../agendaCoverage';
import { trace } from '../trace';

const STATE_META: Record<AgendaState, { tone: Tone; label: string; icon: React.ReactNode }> = {
  not_addressed: { tone: 'neutral', label: 'Not yet addressed', icon: <CircleDashed size={14} /> },
  partial: { tone: 'warn', label: 'Partly addressed', icon: <Circle size={14} /> },
  covered: { tone: 'good', label: 'Covered', icon: <CheckCircle2 size={14} /> },
  recovered: { tone: 'good', label: 'Recovered after guidance', icon: <Sparkles size={14} /> },
};

export function AgendaRailView({ fixture }: { fixture: RehearsalFixture }) {
  const [remedyApplied, setRemedyApplied] = React.useState(false);

  // Reset the remedy interaction whenever the fixture changes.
  React.useEffect(() => setRemedyApplied(false), [fixture]);

  const coverage = computeAgendaCoverage(fixture, remedyApplied);
  const s = coverage.summary;
  const remedyIndex = fixture.supplement?.remedyPointIndex;

  React.useEffect(() => {
    if (remedyApplied) trace('recovery_state_viewed', { fixtureId: fixture.id, mode: 'rehearsal', agendaState: 'recovered' });
  }, [remedyApplied, fixture.id]);

  return (
    <Card>
      <CardHeader
        title="Executive Rehearsal — agenda coverage (passive)"
        subtitle="Optional agenda tracked passively. Coverage is evidence-backed and kept separate from delivery progress."
      />
      <CardBody>
        <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Live view stays <strong className="text-foreground">passive</strong> — no interruptions, no automatic cueing, no continuously-changing score. This is a post-session outcome review; agenda coverage is <strong className="text-foreground">never</strong> mixed into delivery progress.
        </div>

        <p className="mb-3 text-sm font-medium">
          Coverage: {s.covered} covered · {s.partial} partly · {s.notAddressed} not addressed{s.recovered ? ` · ${s.recovered} recovered` : ''} — of {s.total} agenda points.
        </p>

        <ol aria-label="Agenda coverage" className="space-y-3">
          {coverage.points.map((p, i) => {
            const meta = STATE_META[p.state];
            const canRequestHelp = !remedyApplied && remedyIndex === i && p.state === 'not_addressed';
            return (
              <li key={i} className="rounded-xl border border-border bg-background/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="max-w-[36ch] text-sm font-medium">{p.point}</span>
                  <StatePill tone={meta.tone} icon={meta.icon}>{meta.label}</StatePill>
                </div>

                {p.evidence ? (
                  <Disclosure
                    summary="Show transcript evidence"
                    onOpen={() => trace('agenda_state_inspected', { fixtureId: fixture.id, mode: 'rehearsal', agendaState: p.state })}
                  >
                    <p className="flex items-start gap-2">
                      <Quote size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <span>"{p.evidence.quote}" <span className="tabular-nums text-xs">(@ {p.evidence.timestampSec}s)</span></span>
                    </p>
                    {p.state === 'recovered' ? (
                      <p className="mt-2 text-xs">Marked <strong>recovered</strong> only because this covering evidence came from the post-guidance supplement — never inferred.</p>
                    ) : null}
                  </Disclosure>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">No attributable transcript evidence yet — not addressed.</p>
                )}

                {canRequestHelp ? (
                  <div className="mt-3 rounded-lg border border-dashed border-border p-3">
                    <button
                      type="button"
                      onClick={() => { trace('remedy_requested', { fixtureId: fixture.id, mode: 'rehearsal' }); setRemedyApplied(true); }}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Request help with this point
                    </button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      One concise remedy (illustration): "State the ask explicitly — name the decision you need." You supplement or retry; recovery is proven only by attributable post-guidance evidence.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
