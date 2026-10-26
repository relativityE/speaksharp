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
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

    it('HOLD (not FAIL): a press with no observed arrival is missing evidence; it still names the action and link state', () => {
        const v = practiceArrivalVerdict([press(1, 'open_session', 'session', 'direct'), noise]);
        expect(v.verdict).toBe('HOLD');
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
        expect(practiceArrivalVerdict([press(1), arrive(2)]).verdict).not.toBe('PASS');
        expect(practiceArrivalVerdict([arrive(1), press(1)]).verdict).not.toBe('PASS');
        expect(practiceArrivalVerdict([press(1), arrive(2)]).verdict).toBe('HOLD');
    });

    it('CASUALTY: a reused sequence (a remount) pairs each press with its OWN arrival — one arrival cannot serve two presses', () => {
        expect(practiceArrivalVerdict([press(1), arrive(1), press(1), arrive(1)]).verdict).toBe('PASS');
        expect(practiceArrivalVerdict([press(1), press(1), arrive(1)]).evidence).toMatchObject({ arrived: 1, missing: 1 });
    });

    it('CASUALTY: a same-number arrival from ANOTHER boot (after a reload) never pairs; a cross-JOURNEY same-boot arrival does', () => {
        const inBoot = <T extends object>(e: T, bootId: string) => ({ ...e, bootId });
        expect(practiceArrivalVerdict([inBoot(press(1), 'b1'), inBoot(arrive(1), 'b2')]).verdict).toBe('HOLD');
        // Entering /session mints a new journey; the arrival is still THIS press's (same boot), so it must pass.
        expect(practiceArrivalVerdict([{ ...inBoot(press(1), 'b1'), journeyId: 'j1' }, { ...inBoot(arrive(1), 'b1'), journeyId: 'j2' }]).verdict).toBe('PASS');
        expect(practiceArrivalVerdict([inBoot(press(1, 'accept_linked', 'session', 'linked'), 'b1'), inBoot(linked(1, 'server_failed'), 'b2'), inBoot(arrive(1), 'b2')]).evidence)
            .toMatchObject({ missing: 1, linkedFailed: 0, arrived: 0 });
    });

    it('an OBSERVED failure wins over missing evidence: one wrong route plus one missing arrival is FAIL, not HOLD', () => {
        expect(practiceArrivalVerdict([press(1), arrive(1, 'other'), press(2)]).verdict).toBe('FAIL');
        expect(feedbackOutcomeVerdict([fb('attempted', 1), fb('storage_failed', 1, 'network'), fb('attempted', 2)]).verdict).toBe('FAIL');
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

    it('HOLD (not FAIL): an attempt with no observed outcome; CASUALTY: an outcome for a different submit_seq does not resolve it', () => {
        expect(feedbackOutcomeVerdict([fb('attempted', 1)])).toMatchObject({ verdict: 'HOLD', evidence: { unresolved: 1 } });
        expect(feedbackOutcomeVerdict([fb('attempted', 1), fb('storage_ok', 2)]).verdict).toBe('HOLD');
    });

    it('CASUALTY: submit_seq is dialog-local — an outcome from another boot, or one sent BEFORE the attempt, never resolves it', () => {
        const inBoot = <T extends object>(e: T, bootId: string) => ({ ...e, bootId });
        expect(feedbackOutcomeVerdict([inBoot(fb('attempted', 1), 'b1'), inBoot(fb('storage_ok', 1), 'b2')]).evidence).toMatchObject({ unresolved: 1, stored: 0 });
        expect(feedbackOutcomeVerdict([fb('storage_ok', 1), fb('attempted', 1)]).evidence).toMatchObject({ unresolved: 1, stored: 0 });
        expect(feedbackOutcomeVerdict([inBoot(fb('attempted', 1), 'b1'), inBoot(fb('storage_ok', 1), 'b1')]).verdict).toBe('PASS');
    });

    it('Codex r4196394199: a reopened dialog reusing submit_seq — two attempted(1), ONE later storage_ok — HOLDs the first, never PASSes both', () => {
        const v = feedbackOutcomeVerdict([fb('attempted', 1), fb('attempted', 1), fb('storage_ok', 1)]);
        expect(v.verdict).toBe('HOLD');
        expect(v.evidence).toMatchObject({ attempts: 2, stored: 1, unresolved: 1 });
        // and one outcome per attempt resolves both
        expect(feedbackOutcomeVerdict([fb('attempted', 1), fb('storage_ok', 1), fb('attempted', 1), fb('storage_ok', 1)]).verdict).toBe('PASS');
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

/**
 * #1258 (#1563, Codex r4197420116) — the correlation proof belongs to EVERY RWT journey that exercises the action, not to
 * Open Mic alone: a journey that presses Practice again must require the sent press→arrival row and declare the received
 * `practice_again` binding; a journey that shares feedback must require the sent feedback-outcome row.
 */
describe('every RWT journey that presses Practice again proves its correlation (Codex r4197420116)', () => {
    const PRESS_ROW = 'Practice again press → arrival (sent)';
    const FEEDBACK_ROW = 'feedback outcome (sent)';
    const product = (suite: string) => requiredAutomatedRows(suite)?.product ?? [];

    it('the acceptance inventory requires the press→arrival row of Open Mic and both Focus fixtures', () => {
        for (const suite of ['open-mic-first-session', 'focus-points-session', 'focus-points-partial']) {
            expect({ suite, requires: product(suite).includes(PRESS_ROW) }).toEqual({ suite, requires: true });
        }
    });
    it('the feedback-outcome row is required exactly where Share Feedback runs (Open Mic, full Focus), never of the partial probe', () => {
        expect(product('open-mic-first-session')).toContain(FEEDBACK_ROW);
        expect(product('focus-points-session')).toContain(FEEDBACK_ROW);
        expect(product('focus-points-partial')).not.toContain(FEEDBACK_ROW);
    });
    it('SOURCE CONTRACT: each live journey that calls practiceAgainEvidence declares practiceAgain: true and writes the row', () => {
        const live = resolve(__dirname, '../live');
        const files = [...readdirSync(live).map((f) => join(live, f)), ...readdirSync(join(live, 'helpers')).map((f) => join(live, 'helpers', f))]
            .filter((f) => f.endsWith('.ts') && !f.endsWith('rwtJourney.ts'));
        const pressing = files.filter((f) => /practiceAgainEvidence\(/.test(readFileSync(f, 'utf8')));
        expect(pressing.length).toBeGreaterThanOrEqual(2);
        for (const f of pressing) {
            const src = readFileSync(f, 'utf8');
            expect({ file: f, bindsPracticeAgain: /bindReadbackJourneys\([\s\S]*?practiceAgain:\s*true/.test(src), writesRow: src.includes(`'${PRESS_ROW}'`) })
                .toEqual({ file: f, bindsPracticeAgain: true, writesRow: true });
        }
    });
});
