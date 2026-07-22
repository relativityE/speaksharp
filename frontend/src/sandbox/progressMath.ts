/**
 * Phase 2 SANDBOX-LOCAL progress math (UX proving only — NOT the shipped domain).
 *
 * These are small, pure, side-effect-free functions that implement the approved Personal Progress
 * calculation contract (see product_release/SPEAKSHARP_SESSION_PROGRESS.operational.md Part A) purely
 * so the localhost sandbox can render an honest, explainable UX. The production "directional
 * comparison domain" is Inchstone 1 and will be authored separately from fresh main; nothing here is
 * imported by the shipped application (the sandbox has its own standalone Vite entry).
 *
 * No I/O, no persistence, no telemetry, no network.
 */

/** The three defensible target shapes. Every eligible metric declares one. */
export type TargetShape =
  | { kind: 'lowerThreshold'; threshold: number } // lower is better (e.g. fillers/min ≤ T)
  | { kind: 'upperThreshold'; threshold: number } // higher is better (distance shape only)
  | { kind: 'range'; lo: number; hi: number }; // inside [lo,hi] is full success (e.g. pace WPM)

/** distance(measured, target): 0 once the target is met; otherwise the gap to the target. */
export function distance(measured: number, target: TargetShape): number {
  switch (target.kind) {
    case 'lowerThreshold':
      return Math.max(0, measured - target.threshold);
    case 'upperThreshold':
      return Math.max(0, target.threshold - measured);
    case 'range':
      if (measured < target.lo) return target.lo - measured;
      if (measured > target.hi) return measured - target.hi;
      return 0;
  }
}

export interface CumulativeProgress {
  /** distance(fixedBaseline, target) — FIXED across the target version. */
  baselineGap: number;
  /** distance(current, target). */
  currentGap: number;
  /**
   * ((baselineGap - currentGap) / baselineGap) * 100, capped at 100; negative when regressed.
   * `null` when baselineGap === 0 (already at target at baseline — "Target maintained").
   */
  cumulativePct: number | null;
  /** current reached the target (currentGap === 0). */
  atTarget: boolean;
  /** baseline was already at target (baselineGap === 0) — show "Target maintained", never divide by zero. */
  maintained: boolean;
  /** moved away from target vs the fixed baseline (currentGap > baselineGap). */
  regressed: boolean;
}

/**
 * Cumulative target progress vs the FIXED personal baseline. The baseline does not move to the
 * previous session, so the 0–100% scale is stable across sessions.
 */
export function cumulativeProgress(
  fixedBaseline: number,
  current: number,
  target: TargetShape,
): CumulativeProgress {
  const baselineGap = distance(fixedBaseline, target);
  const currentGap = distance(current, target);
  const maintained = baselineGap === 0;
  const atTarget = currentGap === 0;
  const regressed = currentGap > baselineGap;

  let cumulativePct: number | null = null;
  if (!maintained) {
    const raw = ((baselineGap - currentGap) / baselineGap) * 100;
    cumulativePct = Math.min(100, raw); // cap completion at 100; allow negative direction on regression
  }
  return { baselineGap, currentGap, cumulativePct, atTarget, maintained, regressed };
}

/** Round a percentage for display; internal math stays precise. */
export function roundPct(pct: number): number {
  return Math.round(pct);
}

/**
 * Previous-session movement: the change in cumulative progress since the previous comparable session,
 * in PERCENTAGE POINTS. Computed from the rounded displayed values so the UI is internally consistent
 * (e.g. shows 50% now, 33% previously, +17 pp).
 */
export function sessionMovementPp(currentPct: number, previousPct: number): number {
  return roundPct(currentPct) - roundPct(previousPct);
}

/** Median of a set of comparable cumulative-progress values (rolling 3–5-session trend). */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Human-readable target description for the "every % is explainable" requirement. */
export function describeTarget(target: TargetShape, unit: string): string {
  switch (target.kind) {
    case 'lowerThreshold':
      return `${target.threshold}${unit} or fewer`;
    case 'upperThreshold':
      return `${target.threshold}${unit} or more`;
    case 'range':
      return `${target.lo}–${target.hi}${unit}`;
  }
}
