// @vitest-environment node
/**
 * #1258 (#1563 closure) — the RWT receipt must prove the outcome telemetry CORRELATES, not merely that it was sent.
 *
 * Practice again: each navigating press is paired with the next arrival carrying its `action_seq` (entering a product
 * mints a new journey, so the pair is by sequence and order). Share Feedback: each attempt resolves to an outcome with the
 * same `submit_seq`. Both oracles read closed enums and integers only.
 */
import { describe, it, expect } from 'vitest';
import { practiceArrivalVerdict, feedbackOutcomeVerdict } from '../live/helpers/rwtOracles';
import { OUTCOME_FIELDS } from '../live/helpers/rwtJourney';

const press = (seq: number, action = 'open_session', intended = 'session', link = 'direct') =>
    ({ event: 'saved_review_practice_action', fields: { action, action_seq: seq, intended_route: intended, link_state: link } });
const arrive = (seq: number, route = 'session') => ({ event: 'saved_review_practice_arrived', fields: { action_seq: seq, route_class: route } });
const linked = (seq: number, outcome: string) => ({ event: 'saved_review_linked_attempt', fields: { outcome, action_seq: seq, intended_route: 'session' } });
const noise = { event: 'journey_step' };
const fb = (outcome: string, seq: number, error_category?: string) =>
    ({ event: 'feedback_submit', fields: { outcome, submit_seq: seq, ...(error_category ? { error_category } : {}) } });

describe('#1258 practiceArrivalVerdict', () => {
    it('PASS: a direct press and a linked press each arrive where intended, with other events between', () => {
        const v = practiceArrivalVerdict([press(1), noise, arrive(1), press(2, 'accept_linked', 'session', 'linked'), linked(2, 'ok'), arrive(2)]);
        expect(v.verdict).toBe('PASS');
        expect(v.evidence).toMatchObject({ presses: 2, arrived: 2, missing: 0, mismatched: 0 });
    });

    it('FAIL: a press that never arrived (the Oct 2 symptom) names the action and link state', () => {
        const v = practiceArrivalVerdict([press(1, 'open_session', 'session', 'direct'), noise]);
        expect(v.verdict).toBe('FAIL');
        expect(v.evidence).toMatchObject({ missing: 1, first: 'seq 1: open_session (direct) never arrived' });
    });

    it('FAIL: an arrival at the wrong route (a redirect) is a mismatch, not a pass', () => {
        const v = practiceArrivalVerdict([press(1), arrive(1, 'other')]);
        expect(v).toMatchObject({ verdict: 'FAIL', evidence: { mismatched: 1, first: 'seq 1: intended session, arrived other' } });
    });

    it('FAIL: a linked press whose attempt failed names the attempt outcome', () => {
        const v = practiceArrivalVerdict([press(1, 'accept_linked', 'session', 'linked'), linked(1, 'server_failed')]);
        expect(v).toMatchObject({ verdict: 'FAIL', evidence: { linkedFailed: 1, first: 'seq 1: linked attempt server_failed' } });
    });

    it('CASUALTY: an arrival with a DIFFERENT sequence, or one sent BEFORE the press, does not count', () => {
        expect(practiceArrivalVerdict([press(1), arrive(2)]).verdict).toBe('FAIL');
        expect(practiceArrivalVerdict([arrive(1), press(1)]).verdict).toBe('FAIL');
    });

    it('CASUALTY: a reused sequence (a remount) pairs each press with its OWN arrival — one arrival cannot serve two presses', () => {
        expect(practiceArrivalVerdict([press(1), arrive(1), press(1), arrive(1)]).verdict).toBe('PASS');
        expect(practiceArrivalVerdict([press(1), press(1), arrive(1)]).evidence).toMatchObject({ arrived: 1, missing: 1 });
    });

    it('non-navigating presses are not counted; none at all is HOLD, never PASS', () => {
        const ignored = { event: 'saved_review_practice_action', fields: { action: 'refetch_progress', action_seq: 1, intended_route: 'none', link_state: 'error' } };
        expect(practiceArrivalVerdict([ignored]).verdict).toBe('HOLD');
        expect(practiceArrivalVerdict([]).verdict).toBe('HOLD');
    });
});

describe('#1258 feedbackOutcomeVerdict', () => {
    it('PASS: the attempt resolved to storage_ok with the same submit_seq', () => {
        expect(feedbackOutcomeVerdict([fb('attempted', 1), noise, fb('storage_ok', 1)])).toMatchObject({ verdict: 'PASS', evidence: { stored: 1 } });
    });

    it('FAIL: a failed store reports its closed category (the boundary), never the message', () => {
        const v = feedbackOutcomeVerdict([fb('attempted', 1), fb('storage_failed', 1, 'privilege_denied')]);
        expect(v).toMatchObject({ verdict: 'FAIL', evidence: { failed: 1, errorCategory: 'privilege_denied' } });
    });

    it('FAIL: an attempt that never resolved; CASUALTY: an outcome for a different submit_seq does not resolve it', () => {
        expect(feedbackOutcomeVerdict([fb('attempted', 1)]).evidence).toMatchObject({ unresolved: 1 });
        expect(feedbackOutcomeVerdict([fb('attempted', 1), fb('storage_ok', 2)]).verdict).toBe('FAIL');
    });

    it('no attempt is HOLD, never PASS', () => {
        expect(feedbackOutcomeVerdict([fb('refused_by_gate', 1)]).verdict).toBe('HOLD');
    });
});

describe('#1258 OUTCOME_FIELDS keeps only closed, governed keys', () => {
    it('captures exactly the keys the oracles read — no ids, routes, text or provider detail', () => {
        const all = Object.values(OUTCOME_FIELDS).flat();
        expect(all.every((k) => /^(action|action_seq|intended_route|link_state|route_class|outcome|submit_seq|error_category)$/.test(k))).toBe(true);
    });
});
