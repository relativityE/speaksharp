import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectEventProps } from '../telemetryAllowlist';

const push = vi.fn();
vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: (...args: unknown[]) => push(...args) } }));

const {
    trackSessionPdfDownloaded, trackSavedReviewRevisited, trackSavedReviewPracticeSelected, trackProductsMenuOpened,
} = await import('../reviewSurfaceTelemetry');

beforeEach(() => push.mockReset());

/** #1258 (PM 2026-09-25) — runbook controls that had no event. Content-free, and a revisit is never a generation. */
describe('review-surface telemetry', () => {
    it('each producer emits its governed event with closed, content-free fields that survive projection', () => {
        trackSessionPdfDownloaded('session_detail');
        trackSavedReviewRevisited('focus_points', 'review', true);
        trackSavedReviewPracticeSelected('open_mic', false);
        trackProductsMenuOpened('mobile');
        const emitted = push.mock.calls.map(([event, props]) => [event, props] as const);
        expect(emitted.map(([event]) => event)).toEqual([
            'session_pdf_downloaded', 'saved_review_revisited', 'saved_review_practice_selected', 'products_menu_opened',
        ]);
        for (const [event, props] of emitted) {
            const { props: kept, dropped } = projectEventProps(event as never, props as Record<string, unknown>);
            expect(dropped, `${event} drops nothing it sends`).toEqual([]);
            expect(kept).toEqual(props);
        }
    });

    it('a REVISIT is its own event — never a practice_loop_review_* generation event', () => {
        trackSavedReviewRevisited('open_mic', 'review', false);
        expect(push).toHaveBeenCalledTimes(1);
        expect(String(push.mock.calls[0][0])).not.toMatch(/^practice_loop/);
    });

    it('CASUALTY: content smuggled onto these events is dropped at projection', () => {
        const { props, dropped } = projectEventProps('saved_review_revisited', {
            product: 'open_mic', review_state: 'review', evidence_present: true,
            what_to_try_next: 'Pause instead of saying um.', session_id: 'sess-1',
        });
        expect(dropped.sort()).toEqual(['session_id', 'what_to_try_next']);
        expect(props).toEqual({ product: 'open_mic', review_state: 'review', evidence_present: true });
        expect(projectEventProps('session_pdf_downloaded', { surface: 'somewhere_else' }).props).toEqual({});
    });
});
