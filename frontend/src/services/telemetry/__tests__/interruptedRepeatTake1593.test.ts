/**
 * #1593 (Sam's consolidated disposition, case-1 test contract; gate return 16:44:51) — the declared repeat take A is
 * deliberately interrupted by the next take B (rapid-repeat stress). The stage needs a PROVEN causal chain A → the
 * review's own Repeat press → R → B, reads R's outcome from R's own observed `ended` row (never from a missing one), and
 * fails only on a PROVEN stale application of R into B. Rows are decoded readback rows (governed properties only,
 * producer time `$ts` as `producer_ts`), exactly as the readback hands them to the stage.
 */
import { describe, expect, it } from 'vitest';
import {
    QUALIFICATION_STAGES, classifyInterruptedRepeat, evaluateQualificationStage, interruptedRepeatTake, isObservedFailureReason,
    readbackVerdict, type DecodedTelemetryRow,
} from '../completenessGate';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const R = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const BOOT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** The run's declaration for this binding (`QUALIFICATION_ATTEMPT_IDS`): the repeat take A. */
const DECLARED = { expectedAttemptIds: [A] };
const row = (event: string, at: number, properties: Record<string, unknown>): DecodedTelemetryRow =>
    ({ event, timestamp: new Date(1_800_000_000_000 + at).toISOString(), journeyId: 'j', bootId: BOOT,
        properties: { producer_ts: 1_800_000_000_000 + at, ...properties } } as unknown as DecodedTelemetryRow);
const stage = (name: string, at: number, attempt = A) => row('stage_latency', at, { stage: name, attempt_id: attempt });
/** R's lifecycle row; its envelope attempt is A unless a test places it under another take. */
const lc = (stageName: string, at: number, extra: Record<string, unknown> = {}) =>
    row('ai_coaching_lifecycle', at, { stage: stageName, diagnostic_request_id: R, origin_attempt_id: A, origin_boot_id: BOOT, attempt_id: A, ...extra });
const press = (at: number, option = 'practice_next', attempt: string | null = A) =>
    row('journey_step', at, { step: 'option_selected', option_selected: option, attempt_id: attempt });
const start = (at: number, outcome = 'accepted', attempt: string | null = B) =>
    row('recording_intent', at, { intent_kind: 'start', intent_outcome: outcome, attempt_id: attempt });
const savedTake = (attempt: string, at: number) => [
    stage('recording_terminated', at - 2, attempt), stage('final_transcript', at - 1, attempt),
    row('session_saved', at, { attempt_id: attempt }), stage('session_saved', at, attempt),
];

/** A saved at t=3; R requested at t=4; the review's Repeat pressed at t=9; its Start accepted at t=10; B records at 12, starts at 13. */
const transition = (): DecodedTelemetryRow[] => [
    ...savedTake(A, 3),
    lc('requested', 4),
    press(9), start(10),
    row('recording_state', 12, { to_state: 'RECORDING', attempt_id: B }),
    row('session_started', 13, { attempt_id: B }),
];
/** R still open at the invalidation: its own lifecycle reports `superseded_session` at the session change (t=11). */
const openAtInvalidation = () => [...transition(), lc('ended', 11, { end_reason: 'superseded_session' })];
/** R completed — rendered and ended `completed` in the same tick — BEFORE the repeat Start. */
const completedBeforeRepeat = () => [...transition(), lc('response_received', 5), lc('persisted', 6), lc('ready', 7), lc('rendered', 8), lc('ended', 8, { end_reason: 'completed' })];
const without = (rows: DecodedTelemetryRow[], pred: (r: DecodedTelemetryRow) => boolean) => rows.filter((r) => !pred(r));
const replace = (rows: DecodedTelemetryRow[], pred: (r: DecodedTelemetryRow) => boolean, next: DecodedTelemetryRow) => rows.map((r) => (pred(r) ? next : r));
const isEnd = (r: DecodedTelemetryRow) => r.event === 'ai_coaching_lifecycle' && r.properties?.stage === 'ended';
const check = (rows: DecodedTelemetryRow[]) => interruptedRepeatTake(rows, DECLARED);

describe('interrupted repeat take — R\'s observed state at the invalidation, never inferred (#1593, Sam gap 1)', () => {
    it('BRANCH open_at_invalidation qualifies: R\'s own superseded end at the session change', () => {
        expect(classifyInterruptedRepeat(openAtInvalidation(), DECLARED))
            .toMatchObject({ ok: true, branch: 'open_at_invalidation', requestId: R, takeAttempt: A, successorAttempt: B });
    });

    it('BRANCH completed_before_repeat qualifies — a valid pre-repeat ready/render is never misclassified as a failure', () => {
        expect(classifyInterruptedRepeat(completedBeforeRepeat(), DECLARED)).toMatchObject({ ok: true, branch: 'completed_before_repeat' });
    });

    it('NEGATIVE: no observed end HOLDs — even when nothing else is wrong, neither branch is inferred from absence', () => {
        expect(check(without(openAtInvalidation(), isEnd))).toMatch(/no observed end — neither branch is inferred from absence/);
        // A request id that never reports its own end is the same missing state.
        expect(check(replace(openAtInvalidation(), isEnd, lc('ended', 11, { end_reason: 'superseded_session', diagnostic_request_id: R2 }))))
            .toMatch(/no observed end/);
    });

    it('NEGATIVE (lost pre-repeat completion): R rendered before the repeat but its end reads superseded — ambiguous, HOLD', () => {
        // The product ends `completed` in the render's own tick, so a render followed by a superseded end means the
        // completion row was lost — R's state at the invalidation is not proven.
        const rows = [...transition(), lc('ready', 7), lc('rendered', 8), lc('ended', 11, { end_reason: 'superseded_session' })];
        expect(check(rows)).toMatch(/rendered yet ended superseded — a completion was lost/);
        // A render between the press and the superseded report is not certified from silence either.
        expect(check([...transition(), lc('rendered', 9.5), lc('ended', 11, { end_reason: 'superseded_session' })])).toMatch(/completion was lost/);
        // And a render before the repeat with no end at all is no branch either.
        expect(check([...transition(), lc('ready', 7), lc('rendered', 8)])).toMatch(/no observed end/);
    });

    it('a completion must carry its own single render and precede the repeat Start; otherwise its target is ambiguous', () => {
        expect(check([...transition(), lc('ready', 7), lc('ended', 8, { end_reason: 'completed' })])).toMatch(/without exactly one render of its own/);
        // `ended` is the report, not the instant: a completion after the press — even before the accepted Start — is not certified.
        for (const at of [9.5, 10.5]) {
            const late = [...transition(), lc('ready', 7), lc('rendered', at), lc('ended', at, { end_reason: 'completed' })];
            expect(check(late)).toMatch(/completed only after the Repeat press, so its target is ambiguous/);
        }
    });

    it('a supersession before the review\'s Repeat press, or any other end, is neither branch', () => {
        expect(check([...transition(), lc('ended', 8.5, { end_reason: 'superseded_request' })])).toMatch(/superseded before the Repeat press/);
        for (const end_reason of ['unmounted', 'timeout', 'failed', 'invalid_response']) {
            expect(check([...transition(), lc('ended', 11, { end_reason })])).toMatch(new RegExp(`ended ${end_reason}, neither completed`));
        }
    });

    it('NEGATIVE: a terminal before its request, or more than one terminal, HOLDs; late transport facts are separate', () => {
        const early = [...without(transition(), (r) => r.properties?.stage === 'requested'), lc('requested', 9.6), lc('ended', 9.5, { end_reason: 'superseded_session' })];
        expect(check(early)).toMatch(/terminal precedes the request/);
        expect(check([...openAtInvalidation(), lc('ended', 21, { end_reason: 'completed' })])).toMatch(/more than one UI terminal/);
        const late = [...openAtInvalidation(), lc('response_received', 20), lc('response_parsed', 20.1, { parse_valid: true }), lc('persisted', 20.2)];
        expect(classifyInterruptedRepeat(late, DECLARED)).toMatchObject({ ok: true, branch: 'open_at_invalidation' });
    });
});

describe('interrupted repeat take — the declared take and the review\'s own Repeat action (#1593, Sam gap 2)', () => {
    it('Focus Points\' review Repeat (`retry_points`) is the same action', () => {
        const focus = replace(openAtInvalidation(), (r) => r.event === 'journey_step', press(9, 'retry_points'));
        expect(classifyInterruptedRepeat(focus, DECLARED)).toMatchObject({ ok: true, branch: 'open_at_invalidation' });
    });

    it('NEGATIVE (generic unrelated Start): an accepted Start with no review Repeat press proves no repeat', () => {
        expect(check(without(openAtInvalidation(), (r) => r.event === 'journey_step'))).toMatch(/no review Repeat press follows the saved take/);
        // Another option the review offered (e.g. view analytics) is not the Repeat action.
        expect(check(replace(openAtInvalidation(), (r) => r.event === 'journey_step', press(9, 'view_analytics')))).toMatch(/no review Repeat press/);
    });

    it('NEGATIVE: an accepted Start before the press, a suppressed first Start, or no Start at all, binds no repeat', () => {
        expect(check([...openAtInvalidation(), start(8, 'accepted', C)])).toMatch(/accepted Start preceded the review's Repeat press/);
        const suppressed = [...replace(openAtInvalidation(), (r) => r.event === 'recording_intent', start(9.5, 'suppressed_in_flight', null)), start(10)];
        expect(check(suppressed)).toMatch(/Repeat press's Start was not accepted \(suppressed_in_flight\)/);
        expect(check(without(openAtInvalidation(), (r) => r.event === 'recording_intent'))).toMatch(/no Start follows the review's Repeat press/);
    });

    it('NEGATIVE: the press is bound to the declared take A and this boot — never another take, no take, or another boot', () => {
        expect(check(replace(openAtInvalidation(), (r) => r.event === 'journey_step', press(9, 'practice_next', OTHER)))).toMatch(/press was made under another take/);
        expect(check(replace(openAtInvalidation(), (r) => r.event === 'journey_step', press(9, 'practice_next', null))))
            .toMatch(/Repeat press names no take, so it cannot be bound to the declared take/);
        const otherBoot = { ...press(9), bootId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } as DecodedTelemetryRow;
        expect(check(replace(openAtInvalidation(), (r) => r.event === 'journey_step', otherBoot))).toMatch(/not made in the coaching request's boot/);
    });

    it('NEGATIVE: A is the DECLARED take — undeclared, unsaved, or ambiguous declarations HOLD; a later next-Start take never binds', () => {
        expect(interruptedRepeatTake(openAtInvalidation())).toMatch(/not declared by the run/);
        expect(interruptedRepeatTake(openAtInvalidation(), { expectedAttemptIds: [OTHER] })).toMatch(/declared interrupted take has no session_saved/);
        const laterTake = [...openAtInvalidation(), ...savedTake(C, 30)];
        expect(interruptedRepeatTake(laterTake, { expectedAttemptIds: [A, C] })).toMatch(/more than one declared take saved/);
        // With A declared, the later saved take C is never chosen in its place.
        expect(classifyInterruptedRepeat(laterTake, DECLARED)).toMatchObject({ ok: true, takeAttempt: A, successorAttempt: B });
    });

    it('NEGATIVE: B is the FIRST recording after the accepted Start, a new take, named by that Start, with its own session_started', () => {
        expect(check(without(openAtInvalidation(), (r) => r.event === 'recording_state'))).toMatch(/no recording follows the accepted repeat Start/);
        const self = replace(openAtInvalidation(), (r) => r.event === 'recording_state', row('recording_state', 12, { to_state: 'RECORDING', attempt_id: A }));
        expect(check(self)).toMatch(/not a new take/);
        const mismatch = replace(openAtInvalidation(), (r) => r.event === 'recording_intent', start(10, 'accepted', C));
        expect(check(mismatch)).toMatch(/names a different take than the recording/);
        const unrelated = replace(openAtInvalidation(), (r) => r.event === 'session_started', row('session_started', 13, { attempt_id: OTHER }));
        expect(check(unrelated)).toMatch(/successor take's recording has no session_started of its own/);
    });

    it('NEGATIVE (wrong-attempt substitution): R is requested under origin A, in this boot, before the repeat Start', () => {
        const otherOrigin = replace(openAtInvalidation(), (r) => r.properties?.stage === 'requested', lc('requested', 4, { origin_attempt_id: B }));
        expect(check(otherOrigin)).toMatch(/no coaching request under its own origin attempt/);
        const otherBoot = replace(openAtInvalidation(), (r) => r.properties?.stage === 'requested', lc('requested', 4, { origin_boot_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));
        expect(check(otherBoot)).toMatch(/did not start in this boot/);
        const endOtherOrigin = replace(openAtInvalidation(), isEnd, lc('ended', 11, { end_reason: 'superseded_session', origin_attempt_id: B }));
        expect(check(endOtherOrigin)).toMatch(/conflicting origin take or boot across its lifecycle/);
        const afterRepeat = replace(openAtInvalidation(), (r) => r.properties?.stage === 'requested', lc('requested', 10.5));
        expect(check(afterRepeat)).toMatch(/did not start before the repeat Start/);
    });

    it('the saved take\'s own post-Stop chain through save is required, in order, under its attempt', () => {
        const wrong = replace(openAtInvalidation(), (r) => r.properties?.stage === 'final_transcript', stage('final_transcript', 2, B));
        expect(check(wrong)).toMatch(/no final_transcript stage for its own attempt/);
    });
});

describe('interrupted repeat take — FAIL only on proven stale application into B (#1593, Sam gap 3)', () => {
    it('R rendered under B\'s attempt is an OBSERVED FAIL, in either branch and even with R\'s end missing', () => {
        for (const rows of [
            [...openAtInvalidation(), lc('rendered', 15, { attempt_id: B })],
            [...completedBeforeRepeat(), lc('rendered', 15, { attempt_id: B })],
            [...without(openAtInvalidation(), isEnd), lc('rendered', 15, { attempt_id: B })],
        ]) {
            const reason = String(check(rows));
            expect(reason).toMatch(/observed stale application into B/);
            expect(isObservedFailureReason(reason)).toBe(true);
            expect(readbackVerdict([`session_interrupted_repeat: ${reason}`], 'QUALIFIED', 'QUALIFIED')).toBe('FAIL');
        }
    });

    it('readiness alone, a render before the invalidation, or a labelled revisit is NOT that failure', () => {
        // POSITIVE CONTROL (Sam): below the fold, R parsed, persisted and ready (never rendered) before the press, then
        // superseded — still open at the invalidation.
        const belowFold = [...transition(), lc('response_received', 5), lc('response_parsed', 5.5, { parse_valid: true }), lc('persisted', 6), lc('ready', 7),
            lc('ended', 11, { end_reason: 'superseded_session' })];
        expect(classifyInterruptedRepeat(belowFold, DECLARED)).toMatchObject({ ok: true, branch: 'open_at_invalidation' });
        // Ready after the press but before the invalidation, still on A's screen.
        expect(classifyInterruptedRepeat([...transition(), lc('ready', 9.5), lc('ended', 11, { end_reason: 'superseded_session' })], DECLARED))
            .toMatchObject({ ok: true });
        // A labelled saved-review revisit is its own family, never R's lifecycle; A's own stage rows after the press are not R.
        const revisit = [...openAtInvalidation(), row('saved_review_revisited', 30, {}), stage('review_rendered', 30, A), stage('practice_loop_ready', 29, A)];
        expect(classifyInterruptedRepeat(revisit, DECLARED)).toMatchObject({ ok: true, branch: 'open_at_invalidation' });
        // Readiness under B is not a render into B.
        const readyInB = String(check([...openAtInvalidation(), lc('ready', 14, { attempt_id: B })]));
        expect(isObservedFailureReason(readyInB)).toBe(false);
        expect(readyInB).toMatch(/ready or rendered after its invalidation with no proven render into the next take — ambiguous target/);
    });

    it('a late or unattributable ready/render for R is ambiguous — HOLD, never FAIL', () => {
        for (const extra of [lc('rendered', 15), lc('rendered', 15, { attempt_id: null }), lc('ready', 14)]) {
            const reason = String(check([...openAtInvalidation(), extra]));
            expect(reason).toMatch(/ambiguous target/);
            expect(isObservedFailureReason(reason)).toBe(false);
        }
        const shownAgain = String(check([...completedBeforeRepeat(), lc('ready', 14, { attempt_id: null })]));
        expect(shownAgain).toMatch(/without exactly one readiness report/);
        expect(isObservedFailureReason(shownAgain)).toBe(false);
        expect(check([...openAtInvalidation(), lc('ready', 0, { producer_ts: null })]))
            .toMatch(/ready\/rendered row for the request has no producer time/);
    });
});

describe('the declared stage', () => {
    it('requires the transition, Repeat-press and lifecycle families, and never the review-render chain', () => {
        const declared = QUALIFICATION_STAGES.find((s) => s.stage === 'session_interrupted_repeat')!;
        for (const family of ['ai_coaching_lifecycle', 'recording_intent', 'recording_state', 'session_started', 'journey_step']) {
            expect(declared.requiredFamilies).toContain(family);
        }
        expect(declared.requiredFamilies).not.toContain('practice_loop');
        expect(declared.invariants.map((i) => i.name)).toEqual(['saved_take_has_one_verified_attribution_receipt', 'open_mic_interrupted_repeat_take']);
        expect(evaluateQualificationStage(declared, without(openAtInvalidation(), (r) => r.event === 'ai_coaching_lifecycle'), DECLARED))
            .toContain('session_interrupted_repeat: missing required family ai_coaching_lifecycle');
        // The stage reads the run's declaration through the evaluator, not a guess from the rows.
        expect(evaluateQualificationStage(declared, openAtInvalidation()).join(' | ')).toMatch(/not declared by the run/);
    });
});

describe('Sam source RETURN on bbc58543 — four false-qualification probes, now HOLD (#1593)', () => {
    it('(1) the post-Stop chain is ordered by PRODUCER time: a terminate reported after save HOLDs even if received first', () => {
        // Received in order (the flush's capture time), but the producer says recording_terminated happened after the save.
        const late = { ...stage('recording_terminated', 1), properties: { stage: 'recording_terminated', attempt_id: A, producer_ts: 1_800_000_000_000 + 3.5 } } as DecodedTelemetryRow;
        expect(check(replace(openAtInvalidation(), (r) => r.properties?.stage === 'recording_terminated', late))).toMatch(/post-Stop chain is out of order at final_transcript/);
        const untimed = { ...stage('final_transcript', 2), properties: { stage: 'final_transcript', attempt_id: A, producer_ts: null } } as DecodedTelemetryRow;
        expect(check(replace(openAtInvalidation(), (r) => r.properties?.stage === 'final_transcript', untimed))).toMatch(/final_transcript stage row has no producer time/);
    });

    it('(2) completed branch: request ≤ ready/render ≤ completed < Repeat press — a render before the request HOLDs', () => {
        // Ready and rendered reported before R's own request; its completion after it.
        const renderedBeforeRequest = [...transition(), lc('ready', 3.6), lc('rendered', 3.7), lc('ended', 5, { end_reason: 'completed' })];
        expect(check(renderedBeforeRequest)).toMatch(/ready or rendered before it was requested/);
        expect(check([...transition(), lc('rendered', 8), lc('ended', 8, { end_reason: 'completed' })])).toMatch(/without exactly one readiness report/);
        expect(check([...transition(), lc('ready', 7), lc('ready', 7.5), lc('rendered', 8), lc('ended', 8, { end_reason: 'completed' })]))
            .toMatch(/without exactly one readiness report/);
        expect(check([...transition(), lc('rendered', 8), lc('ended', 8, { end_reason: 'completed' }), lc('ready', 9.2)]))
            .toMatch(/readiness was reported only after the Repeat press/);
        // POSITIVE: a synchronous render publishes rendered+completed in the effect declared FIRST, so ready legitimately
        // follows completed in the same commit — not a second render, and not a failure.
        const readyAfterCompletion = [...transition(), lc('rendered', 8), lc('ended', 8, { end_reason: 'completed' }), lc('ready', 8.001)];
        expect(classifyInterruptedRepeat(readyAfterCompletion, DECLARED)).toMatchObject({ ok: true, branch: 'completed_before_repeat' });
        // Readiness before the request is not legitimate in the open branch either.
        expect(check([...transition(), lc('ready', 3.5), lc('ended', 11, { end_reason: 'superseded_session' })])).toMatch(/before it was requested/);
    });

    it('(3) the same R with a conflicting origin boot or take anywhere in its lifecycle HOLDs', () => {
        const otherBoot = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        expect(check(replace(openAtInvalidation(), isEnd, lc('ended', 11, { end_reason: 'superseded_session', origin_boot_id: otherBoot }))))
            .toMatch(/conflicting origin take or boot/);
        expect(check([...openAtInvalidation(), lc('response_received', 20, { origin_boot_id: otherBoot })])).toMatch(/conflicting origin take or boot/);
        expect(check([...completedBeforeRepeat().filter((r) => r.properties?.stage !== 'rendered'), lc('rendered', 8, { origin_attempt_id: C })]))
            .toMatch(/conflicting origin take or boot/);
    });

    it('(4) an accepted repeat Start naming no take is not a wildcard for the next recording', () => {
        expect(check(replace(openAtInvalidation(), (r) => r.event === 'recording_intent', start(10, 'accepted', null))))
            .toMatch(/accepted repeat Start names no take/);
    });
});

describe('Codex review on 580bd93e (#1593)', () => {
    it('P1 r4308033814: a completed render shown while ANOTHER take was current is unattributable — HOLD', () => {
        const underC = [...completedBeforeRepeat().filter((r) => r.properties?.stage !== 'rendered'), lc('rendered', 8, { attempt_id: C })];
        expect(check(underC)).toMatch(/rendered while another take was current — unattributable/);
        // POSITIVE (Sam): no ambient attempt reported, beside every positive binding, qualifies; under A itself is the default.
        const noAmbient = [...completedBeforeRepeat().filter((r) => r.properties?.stage !== 'rendered'), lc('rendered', 8, { attempt_id: null })];
        expect(classifyInterruptedRepeat(noAmbient, DECLARED)).toMatchObject({ ok: true, branch: 'completed_before_repeat' });
        expect(classifyInterruptedRepeat(completedBeforeRepeat(), DECLARED)).toMatchObject({ ok: true });
        // PAIRED CONTROLS (Sam): no ambient attempt is not a wildcard — a missing or conflicting R origin still HOLDs.
        const noAmbientNoOrigin = [...completedBeforeRepeat().filter((r) => r.properties?.stage !== 'rendered'),
            lc('rendered', 8, { attempt_id: null, origin_attempt_id: null })];
        expect(check(noAmbientNoOrigin)).toMatch(/conflicting origin take or boot/);
        const noAmbientOtherBoot = [...completedBeforeRepeat().filter((r) => r.properties?.stage !== 'rendered'),
            lc('rendered', 8, { attempt_id: null, origin_boot_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })];
        expect(check(noAmbientOtherBoot)).toMatch(/conflicting origin take or boot/);
    });

    it('P2 r4308033817: a proven stale render into B is FAIL even when A\'s post-Stop chain is incomplete', () => {
        const noFinal = without(openAtInvalidation(), (r) => r.properties?.stage === 'final_transcript');
        const reason = String(check([...noFinal, lc('rendered', 15, { attempt_id: B })]));
        expect(reason).toMatch(/observed stale application into B/);
        expect(isObservedFailureReason(reason)).toBe(true);
        // Without that proof, the incomplete chain is still the HOLD it was.
        expect(check(noFinal)).toMatch(/no final_transcript stage for its own attempt/);
    });
});
