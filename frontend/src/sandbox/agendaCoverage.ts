/**
 * Phase 2 SANDBOX agenda-coverage adapter.
 *
 * Wraps the already-merged, purely-local outcomeScorecard foundation (keyword-overlap, evidence-backed,
 * no network) and adds the sandbox-level "recovered after guidance" state. "Recovered" is only assigned
 * when a point that was NOT covered on the first pass becomes covered via a supplement, AND the
 * supporting evidence comes from that post-guidance supplement (attributable evidence — never inferred).
 */

import {
  mapTalkingPointCoverage,
  summarizeCoverage,
  type TalkingPointCoverage,
  type TranscriptSegment,
} from '@/services/rehearsal/outcomeScorecard';
import type { RehearsalFixture } from './fixtures';

export type AgendaState = 'not_addressed' | 'partial' | 'covered' | 'recovered';

export interface AgendaPointResult {
  point: string;
  state: AgendaState;
  /** Attributable transcript evidence (quote + timestamp). Absent for not_addressed. */
  evidence?: { quote: string; timestampSec: number };
  /** True when this point is the one the user requested help on. */
  wasRemedyTarget: boolean;
}

export interface AgendaCoverage {
  points: AgendaPointResult[];
  summary: { covered: number; partial: number; notAddressed: number; recovered: number; total: number };
}

function toState(status: TalkingPointCoverage['status']): AgendaState {
  return status === 'missing' ? 'not_addressed' : status;
}

/**
 * Compute passive agenda coverage for a rehearsal fixture. When the fixture has a post-guidance
 * supplement, the remedy-target point is re-evaluated over {segments + supplement}; if it improves to
 * covered with evidence drawn from the supplement, it is marked 'recovered'.
 */
export function computeAgendaCoverage(fixture: RehearsalFixture, applySupplement = true): AgendaCoverage {
  const points = fixture.brief.talkingPoints;

  const firstPass = mapTalkingPointCoverage(points, fixture.segments);

  let finalPass: TalkingPointCoverage[] = firstPass;
  if (fixture.supplement && applySupplement) {
    const withSupplement: TranscriptSegment[] = [...fixture.segments, fixture.supplement.segment];
    finalPass = mapTalkingPointCoverage(points, withSupplement);
  }
  const supplementActive = Boolean(fixture.supplement) && applySupplement;

  const results: AgendaPointResult[] = points.map((point, i) => {
    const before = firstPass[i];
    const after = finalPass[i];
    const wasRemedyTarget = fixture.supplement?.remedyPointIndex === i;

    // Recovered: not covered before, covered now, and the evidence is from the post-guidance supplement.
    const supplementStart = fixture.supplement?.segment.startSec ?? Infinity;
    const recovered =
      supplementActive &&
      before.status !== 'covered' &&
      after.status === 'covered' &&
      after.evidence !== undefined &&
      after.evidence.timestampSec >= supplementStart;

    const state: AgendaState = recovered ? 'recovered' : toState(after.status);
    return {
      point,
      state,
      evidence: after.evidence ? { quote: after.evidence.quote, timestampSec: after.evidence.timestampSec } : undefined,
      wasRemedyTarget,
    };
  });

  const base = summarizeCoverage(finalPass);
  const recoveredCount = results.filter((r) => r.state === 'recovered').length;
  return {
    points: results,
    summary: {
      covered: results.filter((r) => r.state === 'covered').length,
      partial: base.partial,
      notAddressed: results.filter((r) => r.state === 'not_addressed').length,
      recovered: recoveredCount,
      total: base.total,
    },
  };
}
