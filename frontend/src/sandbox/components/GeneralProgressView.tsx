/**
 * Phase 2 SANDBOX — General Practice view (no agenda required).
 *
 * Renders per-target Personal Progress: cumulative progress vs the FIXED baseline, previous-session
 * movement in percentage points, and the raw change — every percentage exposes baseline, previous,
 * current, target, and the calculation itself. Clarity is shown raw-only (ineligible for a %).
 */

import React from 'react';
import { CheckCircle2, Info, MinusCircle, TrendingDown, TrendingUp, Flag } from 'lucide-react';
import { Card, CardHeader, CardBody, ProgressBar, StatePill, Disclosure } from './primitives';
import type { DeliveryMetricFixture, GeneralFixture } from '../fixtures';
import { cumulativeProgress, describeTarget, roundPct, sessionMovementPp, type TargetShape } from '../progressMath';
import { trace } from '../trace';

function TargetEditor({
  target,
  unit,
  onChange,
}: {
  target: TargetShape;
  unit: string;
  onChange: (t: TargetShape) => void;
}) {
  const cls =
    'w-16 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (target.kind === 'range') {
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <input aria-label="Target lower bound" type="number" className={cls} value={target.lo}
          onChange={(e) => onChange({ ...target, lo: Number(e.target.value) })} />
        <span aria-hidden>–</span>
        <input aria-label="Target upper bound" type="number" className={cls} value={target.hi}
          onChange={(e) => onChange({ ...target, hi: Number(e.target.value) })} />
        <span className="text-muted-foreground">{unit}</span>
      </span>
    );
  }
  const verb = target.kind === 'lowerThreshold' ? '≤' : '≥';
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span aria-hidden>{verb}</span>
      <input aria-label="Target threshold" type="number" className={cls} value={target.threshold}
        onChange={(e) => onChange({ ...target, threshold: Number(e.target.value) })} />
      <span className="text-muted-foreground">{unit}</span>
    </span>
  );
}

function MetricRow({
  metric,
  showComparison,
  fixtureId,
  target,
  onTargetChange,
}: {
  metric: DeliveryMetricFixture;
  showComparison: boolean;
  fixtureId: string;
  target: TargetShape | undefined;
  onTargetChange: (t: TargetShape) => void;
}) {
  const fmt = (n: number) => `${n}${metric.unit}`;

  // Ineligible (e.g. clarity): raw direction only, with the reason.
  if (!metric.eligibleForPercentage || !target) {
    return (
      <div className="py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{metric.label}</span>
          <StatePill tone="neutral" icon={<Info size={14} />}>Not eligible for target progress</StatePill>
        </div>
        <p className="mt-1 text-sm tabular-nums text-foreground">
          {metric.previous !== undefined ? `${fmt(metric.previous)} → ` : ''}{fmt(metric.current)} <span className="text-muted-foreground">(raw direction only)</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{metric.ineligibleReason}</p>
      </div>
    );
  }

  const cur = cumulativeProgress(metric.fixedBaseline, metric.current, target);
  const prev = metric.previous !== undefined ? cumulativeProgress(metric.fixedBaseline, metric.previous, target) : null;

  const canShowPct = showComparison && !cur.maintained;
  const movementPp =
    canShowPct && prev && !prev.maintained && cur.cumulativePct !== null && prev.cumulativePct !== null
      ? sessionMovementPp(cur.cumulativePct, prev.cumulativePct)
      : null;

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{metric.label}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Target</span>
          <TargetEditor target={target} unit={metric.unit} onChange={onTargetChange} />
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{metric.targetNote}</p>

      {cur.maintained ? (
        <div className="mt-2">
          <StatePill tone="good" icon={<CheckCircle2 size={14} />}>Target maintained</StatePill>
          <p className="mt-2 text-sm tabular-nums">Baseline {fmt(metric.fixedBaseline)} was already within {describeTarget(target, metric.unit)}.</p>
        </div>
      ) : cur.atTarget ? (
        <div className="mt-2">
          <StatePill tone="good" icon={<CheckCircle2 size={14} />}>Target reached</StatePill>
          <p className="mt-2 text-sm tabular-nums">100% of your original gap closed — now at {fmt(metric.current)}.</p>
        </div>
      ) : cur.regressed ? (
        <div className="mt-2">
          <StatePill tone="bad" icon={<TrendingDown size={14} />}>Moved away from target</StatePill>
          <p className="mt-2 text-sm tabular-nums">
            {metric.previous !== undefined ? `${fmt(metric.previous)} → ` : ''}{fmt(metric.current)} · goal {describeTarget(target, metric.unit)}.
            You moved away from this target this session — worth a focused next attempt.
          </p>
        </div>
      ) : canShowPct && cur.cumulativePct !== null ? (
        <div className="mt-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xl font-semibold tabular-nums">{roundPct(cur.cumulativePct)}%</span>
            <span className="text-sm text-muted-foreground">of your original gap closed</span>
          </div>
          <div className="mt-2"><ProgressBar pct={cur.cumulativePct} ariaLabel={`${metric.label} cumulative progress`} /></div>
          <p className="mt-2 text-sm tabular-nums">
            {fmt(metric.fixedBaseline)} baseline{metric.previous !== undefined ? ` → ${fmt(metric.previous)} previous` : ''} → {fmt(metric.current)} now → goal {describeTarget(target, metric.unit)}
          </p>
          {movementPp !== null ? (
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium">
              {movementPp >= 0 ? <TrendingUp size={14} className="text-emerald-600" /> : <TrendingDown size={14} className="text-amber-600" />}
              <span>{movementPp >= 0 ? '+' : ''}{movementPp} pp</span>
              <span className="text-muted-foreground">vs previous comparable session</span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm tabular-nums">
          {fmt(metric.current)} <span className="text-muted-foreground">— raw value only (no comparison available)</span>
        </p>
      )}

      <Disclosure
        summary="Show calculation"
        onOpen={() => trace('target_details_opened', { fixtureId, mode: 'general', targetType: target.kind })}
      >
        <ul className="space-y-1 tabular-nums">
          <li>Fixed baseline: <strong>{fmt(metric.fixedBaseline)}</strong> (does not move across sessions)</li>
          {metric.previous !== undefined ? <li>Previous comparable: <strong>{fmt(metric.previous)}</strong></li> : null}
          <li>Current: <strong>{fmt(metric.current)}</strong></li>
          <li>Target: <strong>{describeTarget(target, metric.unit)}</strong></li>
          <li>baseline_gap = <strong>{cur.baselineGap}</strong>; current_gap = <strong>{cur.currentGap}</strong></li>
          <li>cumulative = ((baseline_gap − current_gap) / baseline_gap) × 100 = <strong>{cur.cumulativePct === null ? 'n/a (already at target)' : `${roundPct(cur.cumulativePct)}%`}</strong></li>
          {movementPp !== null ? <li>movement = current% − previous% = <strong>{movementPp >= 0 ? '+' : ''}{movementPp} pp</strong></li> : null}
        </ul>
      </Disclosure>
    </div>
  );
}

export function GeneralProgressView({ fixture }: { fixture: GeneralFixture }) {
  const c = fixture.comparison;
  const [targets, setTargets] = React.useState<Record<string, TargetShape | undefined>>(
    () => Object.fromEntries(fixture.metrics.map((m) => [m.key, m.target])),
  );

  // Reset editable targets when the fixture changes.
  React.useEffect(() => {
    setTargets(Object.fromEntries(fixture.metrics.map((m) => [m.key, m.target])));
  }, [fixture]);

  const showComparison = !c.isFirstSession && c.comparable && c.confidenceOk;

  // "Improved in X of Y focus areas" — eligible targeted metrics that moved toward target vs previous.
  const eligible = fixture.metrics.filter((m) => m.eligibleForPercentage && (targets[m.key] ?? m.target));
  const improvedCount = showComparison
    ? eligible.filter((m) => {
        const t = targets[m.key] ?? m.target!;
        if (m.previous === undefined) return false;
        const cur = cumulativeProgress(m.fixedBaseline, m.current, t);
        const prev = cumulativeProgress(m.fixedBaseline, m.previous, t);
        return cur.currentGap < prev.currentGap;
      }).length
    : 0;

  const nextFocus = fixture.metrics.find((m) => m.key === fixture.nextFocusKey);

  return (
    <Card>
      <CardHeader
        title="General practice — personal progress"
        subtitle={`Comparing ${c.currentSessionName} (${c.currentDate}) against your own baseline. No agenda required.`}
      />
      <CardBody>
        {c.isFirstSession ? (
          <div className="mb-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm dark:border-sky-800 dark:bg-sky-950">
            <StatePill tone="info" icon={<Flag size={14} />}>Personal baseline established</StatePill>
            <p className="mt-2 text-muted-foreground">This is your first eligible session. It sets your baseline (0% progress from baseline — not a grade). Raw measurements are shown; progress percentages appear once you have a comparable session.</p>
          </div>
        ) : !c.comparable ? (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950">
            <StatePill tone="warn" icon={<Info size={14} />}>No comparison — session excluded</StatePill>
            <p className="mt-2 text-muted-foreground">{c.exclusionReason} Raw values only; no percentage.</p>
          </div>
        ) : !c.confidenceOk ? (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950">
            <StatePill tone="warn" icon={<MinusCircle size={14} />}>Not enough comparable evidence</StatePill>
            <p className="mt-2 text-muted-foreground">{c.lowConfidenceReason}</p>
          </div>
        ) : (
          <p className="mb-1 text-sm font-medium">
            Improved in {improvedCount} of {eligible.length} selected focus areas.
          </p>
        )}

        <div className="divide-y divide-border">
          {fixture.metrics.map((m) => (
            <MetricRow
              key={m.key}
              metric={m}
              showComparison={showComparison}
              fixtureId={fixture.id}
              target={targets[m.key] ?? m.target}
              onTargetChange={(t) => {
                setTargets((prev) => ({ ...prev, [m.key]: t }));
                trace('illustrative_target_edited', { fixtureId: fixture.id, mode: 'general', targetType: t.kind });
              }}
            />
          ))}
        </div>

        {nextFocus ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-semibold">One next focus:</span> {nextFocus.label.toLowerCase()} — the single area to try improving next.
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
