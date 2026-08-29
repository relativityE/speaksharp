/**
 * #1304 — where a matrix run retains its measurement.
 *
 * Extracted as a pure function because the defect it prevents was invisible: the write sat behind
 * `if (outPath)`, so a run invoked without `--out` completed successfully, printed its numbers, and kept
 * nothing. That is how the 459-word preflight was lost — not to a crash, but to a silent success.
 *
 * The rule: retain by default, discard only on an explicit request, and never discard a selection run.
 */
export interface RetentionRequest {
    /** `--out=` if given. */
    explicitOut: string;
    /** `--no-retain` present. */
    noRetain: boolean;
    /** True for a `--only=` debugging subset, which is not a matrix run. */
    subsetRun: boolean;
    setName: string;
    evidenceClass: string;
    /** Short HEAD sha, or 'unknown' outside a git checkout. */
    sha: string;
}

export type RetentionDecision =
    | { kind: 'retain'; path: string; derived: boolean }
    | { kind: 'discard'; reason: 'no-retain' | 'subset' }
    | { kind: 'refuse'; reason: string };

export function resolveRetention(req: RetentionRequest): RetentionDecision {
    if (req.noRetain && req.evidenceClass === 'selection') {
        return {
            kind: 'refuse',
            reason: 'a down-select cannot rest on a run that kept nothing',
        };
    }
    if (req.explicitOut) return { kind: 'retain', path: req.explicitOut, derived: false };
    if (req.noRetain) return { kind: 'discard', reason: 'no-retain' };
    // A subset run is a debugging slice; it cannot produce a complete artifact, so it does not pretend to.
    if (req.subsetRun) return { kind: 'discard', reason: 'subset' };
    return { kind: 'retain', path: `evidence-runs/${req.setName}-${req.sha}.json`, derived: true };
}
