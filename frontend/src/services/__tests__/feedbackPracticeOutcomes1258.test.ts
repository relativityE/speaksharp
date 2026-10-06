/**
 * #1258 — Share Feedback and Practice-again outcomes are named, content-free and linked to their attempt.
 *
 * RWT run 36955422629 recorded two FAILs nothing could explain: Share Feedback ("no acknowledgement, stored 0") and the
 * saved review's Practice again ("enabled, did not open the session page"). These events say which branch ran. Every
 * value is a closed enum, a boolean or a bounded integer, and survives the governed projection unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectEventProps } from '../telemetryAllowlist';

const pushed: Array<[string, Record<string, unknown>]> = [];
vi.mock('@/services/AnalyticsBuffer', () => ({
    analyticsBuffer: { push: (event: string, props: Record<string, unknown>) => { pushed.push([event, props]); } },
}));

const { classifyFeedbackStorageError, emitFeedbackSubmit, FEEDBACK_ERROR_CATEGORIES } = await import('../telemetry/feedbackTelemetry');
const { trackSavedReviewPracticeAction, trackSavedReviewLinkedAttempt, trackSavedReviewPracticeState } = await import('../reviewSurfaceTelemetry');

beforeEach(() => { pushed.length = 0; });

const survivesProjection = (event: string, props: Record<string, unknown>) => {
    const { props: kept, dropped } = projectEventProps(event as never, props);
    expect(dropped, `${event} drops nothing it sends`).toEqual([]);
    expect(kept).toEqual(props);
};

describe('#1258 Share Feedback storage outcome', () => {
    it.each([
        [{ code: '42501', message: 'new row violates row-level security policy for table "user_issue_reports"' }, 'rls_denied'],
        // Codex r4191751378: 42501 is Postgres' general insufficient_privilege. A missing grant (the original Share
        // Feedback ON CONFLICT cause) is NOT an RLS refusal and must not send the RWT to the wrong boundary.
        [{ code: '42501', message: 'permission denied for table user_issue_reports' }, 'privilege_denied'],
        [{ code: '42501', message: '' }, 'privilege_denied'],
        [{ code: 'PGRST301', message: 'JWT expired' }, 'auth_missing'],
        [{ code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }, 'conflict_target'],
        [{ code: '23514', message: 'violates check constraint "user_issue_reports_title_length"' }, 'constraint_violation'],
        [{ code: '23503', message: 'violates foreign key constraint' }, 'constraint_violation'],
        [{ code: 'PGRST204', message: "Could not find the 'idempotency_key' column" }, 'schema_mismatch'],
        [{ code: '', message: 'TypeError: Failed to fetch' }, 'network'],
        [Object.assign(new TypeError('Load failed'), {}), 'network'],
        [Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), 'timeout'],
        [{ code: 'XX000', message: 'internal error' }, 'server_error'],
        [{ code: 'P0001', message: 'raise' }, 'unknown'],
        [null, 'unknown'],
        ['a bare string', 'unknown'],
    ])('%o → %s', (err, category) => {
        expect(classifyFeedbackStorageError(err)).toBe(category);
    });

    it('the category set is exactly the governed enum, and no error text reaches the event', () => {
        emitFeedbackSubmit({
            outcome: 'storage_failed', acknowledgementVisible: true,
            errorCategory: classifyFeedbackStorageError({ code: '42501', message: 'new row violates row-level security policy for table "user_issue_reports" (secret detail)' }),
            submitSeq: 1, elapsedMs: 412.6,
        });
        const [event, props] = pushed[0];
        expect(event).toBe('feedback_submit');
        expect(props).toEqual({
            outcome: 'storage_failed', submit_blockers: null, acknowledgement_visible: true,
            error_category: 'rls_denied', elapsed_ms: 413, submit_seq: 1,
        });
        expect(JSON.stringify(props)).not.toMatch(/policy|secret|user_issue_reports/);
        survivesProjection(event, props);
        for (const category of FEEDBACK_ERROR_CATEGORIES) {
            expect(projectEventProps('feedback_submit', { outcome: 'storage_failed', error_category: category }).dropped).toEqual([]);
        }
    });

    it('attempted and its outcome share the submit_seq; elapsed is clamped to the governed range', () => {
        emitFeedbackSubmit({ outcome: 'attempted', submitSeq: 2 });
        emitFeedbackSubmit({ outcome: 'storage_ok', acknowledgementVisible: true, hasSession: true, submitSeq: 2, elapsedMs: 10_000_000 });
        expect(pushed.map(([, p]) => p.submit_seq)).toEqual([2, 2]);
        expect(pushed[1][1].elapsed_ms).toBe(600_000);
        for (const [event, props] of pushed) survivesProjection(event, props);
    });
});

describe('#1258 Practice again: every press and its linked attempt', () => {
    it('a press records what the page knew and the branch it took', () => {
        trackSavedReviewPracticeAction({
            product: 'open_mic', linkState: 'error', reviewState: 'loaded', progressStatus: 'unavailable',
            action: 'refetch_progress', actionSeq: 1, intendedRoute: 'none',
        });
        expect(pushed[0]).toEqual(['saved_review_practice_action', {
            product: 'open_mic', link_state: 'error', review_state: 'loaded', progress_status: 'unavailable',
            action: 'refetch_progress', action_seq: 1, intended_route: 'none',
        }]);
        survivesProjection(...pushed[0]);
    });

    it('every action, link state, review state and progress status is governed', () => {
        const actions = ['ignored', 'reread_review', 'refetch_progress', 'accept_linked', 'open_session', 'open_focus_setup', 'open_practice'] as const;
        const links = ['pending', 'error', 'blocked', 'linked', 'direct'] as const;
        const reviews = ['loading', 'loaded', 'read_failed', 'focus_read_failed'] as const;
        const statuses = ['loading', 'read_error', 'insufficient', 'ineligible', 'unavailable', 'error', 'eligible', 'unknown'] as const;
        for (const action of actions) for (const linkState of links) {
            trackSavedReviewPracticeAction({ product: 'focus_points', linkState, reviewState: reviews[0], progressStatus: statuses[0], action, actionSeq: 3, intendedRoute: 'session' });
        }
        for (const reviewState of reviews) for (const progressStatus of statuses) {
            trackSavedReviewPracticeAction({ product: 'unknown', linkState: 'direct', reviewState, progressStatus, action: 'ignored', actionSeq: 1, intendedRoute: 'none' });
        }
        expect(pushed).toHaveLength(actions.length * links.length + reviews.length * statuses.length);
        for (const [event, props] of pushed) survivesProjection(event, props);
    });

    it('the linked attempt reports its outcome, elapsed time and the press it answers', () => {
        const outcomes = ['ok', 'not_started', 'readback_blocked', 'server_failed', 'handoff_failed_abandoned', 'handoff_failed_unclosed', 'threw'] as const;
        outcomes.forEach((outcome, i) => trackSavedReviewLinkedAttempt(outcome, 250.4, i + 1, 'session'));
        expect(pushed[0]).toEqual(['saved_review_linked_attempt', { outcome: 'ok', elapsed_ms: 250, action_seq: 1, intended_route: 'session' }]);
        for (const [event, props] of pushed) survivesProjection(event, props);
    });

    it('CASUALTY: content smuggled onto the press event is dropped at projection', () => {
        const { dropped } = projectEventProps('saved_review_practice_action', {
            product: 'open_mic', link_state: 'direct', review_state: 'loaded', progress_status: 'insufficient',
            action: 'open_session', action_seq: 1, intended_route: 'session', session_id: 'sess-1', to_route: '/analytics/sess-1',
        });
        expect(dropped.sort()).toEqual(['session_id', 'to_route']);
    });

    it('a disabled or blocked action is observable: every blocked reason is governed, with enabled=false', () => {
        const reasons = ['review_loading', 'progress_pending', 'previous_attempt_pending', 'linking', 'retry_blocked', 'progress_refetching'] as const;
        for (const blockedReason of reasons) {
            trackSavedReviewPracticeState({ product: 'open_mic', linkState: 'pending', reviewState: 'loading', enabled: false, blockedReason });
        }
        trackSavedReviewPracticeState({ product: 'open_mic', linkState: 'direct', reviewState: 'loaded', enabled: true, blockedReason: 'none' });
        expect(pushed.map(([e]) => e)).toEqual(Array(7).fill('saved_review_practice_state'));
        for (const [event, props] of pushed) survivesProjection(event, props);
    });
});
