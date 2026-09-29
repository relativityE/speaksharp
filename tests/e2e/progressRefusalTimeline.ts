/**
 * The refused-Start visibility timeline (PO 2026-09-29, PM 5889581027) for start-during-progress-settle.
 *
 * The earlier check sampled the rendered reason immediately after the Start click and failed twice at ≈+221 ms, then
 * passed on retry, so it could not tell a test that sampled before the UI committed from a real silent interval. The
 * browser now records one monotonic (`performance.now()`) timeline of labels only, never account data or message text:
 *
 *   start_click → refusal_decision (the controller's own "blocked on Progress evidence" log) → store_refusal (the store
 *   publishes the refusal) → reason_visible / reason_hidden (rendered-visibility transitions) → sample (each test sample)
 *   → sampling_end (immediately before the held evaluation is released, so the window spans the whole refusal).
 *
 * The verdict is pure so its failure modes are unit-tested: the reason must be visible within FIRST_VISIBLE_DEADLINE_MS
 * of the click, must never be hidden before the window closes, and the decision and store-publish marks must each be
 * observed exactly once inside the window (otherwise the timeline cannot say which transition was late).
 */
export const FIRST_VISIBLE_DEADLINE_MS = 500;

export type RefusalLabel =
    | 'baseline' | 'start_click' | 'refusal_decision' | 'store_refusal' | 'reason_visible' | 'reason_hidden' | 'sample' | 'sampling_end';
export interface RefusalEvent { t: number; label: RefusalLabel; visible?: number }

const first = (events: readonly RefusalEvent[], label: RefusalLabel) => events.find((e) => e.label === label);

/** Milliseconds from the click for each first occurrence; the attached evidence, content-free. */
export function refusalTimelineSummary(events: readonly RefusalEvent[]): Record<string, number | null> {
    const click = first(events, 'start_click');
    const rel = (label: RefusalLabel) => {
        const e = first(events, label);
        return click && e ? Math.round(e.t - click.t) : null;
    };
    return {
        refusalDecisionMs: rel('refusal_decision'),
        storeRefusalMs: rel('store_refusal'),
        firstVisibleMs: rel('reason_visible'),
        hiddenAfterVisible: events.filter((e) => e.label === 'reason_hidden').length,
        samples: events.filter((e) => e.label === 'sample').length,
    };
}

/** Failures, content-free. Empty means the refused Start was never silent past the deadline and never went silent after. */
export function judgeRefusalTimeline(events: readonly RefusalEvent[], deadlineMs = FIRST_VISIBLE_DEADLINE_MS): string[] {
    const failures: string[] = [];
    const click = first(events, 'start_click');
    if (!click) return ['the Start click was not recorded, so the deadline cannot be judged'];
    const visible = events.find((e) => e.label === 'reason_visible' && e.t >= click.t);
    if (!visible) {
        failures.push('the refusal reason never became visible after the Start click');
    } else if (visible.t - click.t > deadlineMs) {
        failures.push(`the refusal reason first became visible ${Math.round(visible.t - click.t)} ms after the Start click (deadline ${deadlineMs} ms)`);
    }
    const end = first(events, 'sampling_end');
    if (!end) failures.push('the refusal sampling window was not closed, so continuity cannot be judged');
    // PM 5890479395: the summary claims to separate decision, publish and render, so each of those observations must
    // exist exactly once inside the click-to-end window; otherwise the timeline cannot diagnose a late transition.
    for (const label of ['refusal_decision', 'store_refusal'] as const) {
        const marks = events.filter((e) => e.label === label);
        if (marks.some((e) => e.t < click.t)) failures.push(`instrumentation: ${label} was recorded before the Start click`);
        const inWindow = end ? marks.filter((e) => e.t >= click.t && e.t <= end.t).length : 0;
        if (end && inWindow !== 1) failures.push(`instrumentation: expected exactly one ${label} inside the refusal window, observed ${inWindow}`);
    }
    if (visible && end) {
        const gaps = events.filter((e) => e.label === 'reason_hidden' && e.t > visible.t && e.t <= end.t);
        if (gaps.length > 0) failures.push(`the refusal reason was hidden ${gaps.length} time(s) while Start was still refused`);
        const silentSamples = events.filter((e) => e.label === 'sample' && e.t >= visible.t && e.t <= end.t && (e.visible ?? 0) === 0);
        if (silentSamples.length > 0) failures.push(`${silentSamples.length} sample(s) found no visible reason while Start was still refused`);
    }
    if (events.filter((e) => e.label === 'sample').length === 0) failures.push('no visibility sample was taken while Start was refused');
    return failures;
}
