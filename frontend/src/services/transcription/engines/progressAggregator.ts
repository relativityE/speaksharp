/**
 * Model-load progress aggregator (MAXDEPTH FIX Part 4).
 *
 * whisper-base.en is a SPLIT model: separate encoder + decoder ONNX files.
 * transformers.js fires its `progress_callback` PER FILE, each ramping 0→100
 * independently (and re-reporting already-cached files on a warm re-init). If the
 * raw per-file `progress` is forwarded to the UI store, the emitted stream is
 * NON-MONOTONIC and oscillates — observed in a real trace as:
 *
 *     0 → 100 → 25 → 28 → 100 → 77 → 95 → 99 → 100 → 9 → 10 …
 *
 * That A→B→A churn drives a React render loop ("Maximum update depth exceeded").
 * A consecutive-duplicate dedupe downstream cannot fix it because each value
 * differs from the one before.
 *
 * This aggregator collapses the per-file events into ONE monotonic non-decreasing
 * overall percent by summing bytes across files (keyed by filename, so cache-warm
 * re-reports of a completed file stay at its total). A monotonic guard additionally
 * absorbs the transient dip that occurs when a newly-initiated file's `total` first
 * joins the denominator. The return value is the percent to emit, or `null` to skip.
 */

export interface ProgressEvent {
    status?: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
}

export type ProgressAggregator = (data: ProgressEvent) => number | null;

export function createProgressAggregator(): ProgressAggregator {
    const fileBytes = new Map<string, { loaded: number; total: number }>();
    let lastOverall = -1;

    return (data: ProgressEvent): number | null => {
        let overall: number;

        if (data.file && typeof data.total === 'number' && data.total > 0) {
            const prev = fileBytes.get(data.file);
            const reportedLoaded =
                typeof data.loaded === 'number'
                    ? data.loaded
                    : data.status === 'done'
                      ? data.total
                      : prev?.loaded ?? 0;
            // A file's loaded byte count must never regress (defensive: out-of-order events).
            fileBytes.set(data.file, { loaded: Math.max(reportedLoaded, prev?.loaded ?? 0), total: data.total });

            let sumLoaded = 0;
            let sumTotal = 0;
            for (const f of fileBytes.values()) {
                sumLoaded += f.loaded;
                sumTotal += f.total;
            }
            overall = sumTotal > 0 ? (sumLoaded / sumTotal) * 100 : 0;
        } else if (data.progress !== undefined) {
            overall = data.progress; // No byte info on this event: fall back to the raw value.
        } else {
            return null;
        }

        overall = Math.max(0, Math.min(100, overall));
        // Monotonic guard: emit forward movement only. When a new file's `total`
        // joins the denominator the aggregate can dip — hold instead of regressing
        // so the downstream store never sees a backward write (the render-loop trigger).
        if (overall <= lastOverall) return null;
        lastOverall = overall;
        return overall;
    };
}
