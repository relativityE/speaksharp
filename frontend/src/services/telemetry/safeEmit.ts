/**
 * #1259 — TELEMETRY MUST NEVER BREAK THE PRODUCT.
 *
 * `practiceSurfaceReporting.integration.test.tsx` mocks `analyticsBuffer.push` to THROW, precisely to
 * prove that a report still persists when the analytics transport is down. Adding unguarded emit calls
 * to the Report Issue dialog broke that guarantee immediately: a throwing transport stopped the dialog
 * rendering its own fields, so a telemetry change would have taken feedback submission down with it.
 *
 * That test caught it. The lesson generalises, so every producer added under #1259 goes through here
 * rather than relying on each call site to remember: the whole point of this work is to observe the
 * product, and an observer that can break what it observes is worse than no observer.
 *
 * The failure is swallowed deliberately and completely. There is nowhere useful to report it — the
 * reporting channel is the thing that just failed — and re-throwing would be the defect.
 */
import { analyticsBuffer, type AnalyticsEventName, type AnalyticsPriority } from '../AnalyticsBuffer';

export function safeEmit(
    event: AnalyticsEventName,
    props: Record<string, unknown>,
    priority: AnalyticsPriority = 'LOW',
): void {
    try {
        analyticsBuffer.push(event, props, priority);
    } catch {
        /* an observer that can break the product is worse than no observer */
    }
}
