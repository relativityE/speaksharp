/**
 * #1593 (Sam's consolidated disposition, case-1 test contract) — the Practice-again repeat take A is deliberately interrupted
 * by the next take B (rapid-repeat stress). The stage needs a PROVEN A → accepted repeat Start → actual recording B
 * transition bound to A's coaching request R, and accepts the two truthful outcomes for R (completed before the repeat, or
 * pending at it and superseded) — never inferred from a missing event. Rows are decoded readback rows (governed properties
 * only, producer time `$ts` as `producer_ts`), exactly as the readback hands them to the stage.
 */
import { describe, expect, it } from 'vitest';
import {
    QUALIFICATION_STAGES, classifyInterruptedRepeat, evaluateQualificationStage, interruptedRepeatTake, isObservedFailureReason,
    readbackVerdict, type DecodedTelemetryRow,
} from '../completenessGate';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const R = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const BOOT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const row = (event: string, at: number, properties: Record<string, unknown>): DecodedTelemetryRow =>
    ({ event, timestamp: new Date(1_800_000_000_000 + at).toISOString(), journeyId: 'j', bootId: BOOT,
        properties: { producer_ts: 1_800_000_000_000 + at, ...properties } } as unknown as DecodedTelemetryRow);
const stage = (name: string, at: number, attempt = A) => row('stage_latency', at, { stage: name, attempt_id: attempt });
const lc = (stageName: string, at: number, extra: Record<string, unknown> = {}) =>
    row('ai_coaching_lifecycle', at, { stage: stageName, diagnostic_request_id: R, origin_attempt_id: A, origin_boot_id: BOOT, ...extra });

/** A saved at t=3; R requested at t=4; repeat accepted at t=10; B records at t=12 and starts at t=13. */
const transition = (): DecodedTelemetryRow[] => [
    stage('recording_terminated', 1), stage('final_transcript', 2), row('session_saved', 3, { attempt_id: A }), stage('session_saved', 3),
    lc('requested', 4),
    row('recording_intent', 10, { intent_kind: 'start', intent_outcome: 'accepted' }),
    row('recording_state', 12, { to_state: 'RECORDING', attempt_id: B }),
    row('session_started', 13, { attempt_id: B }),
];
/** Branch 2 — R still pending at the repeat; its single end is superseded at the repeat. */
const pendingAtRepeat = () => [...transition(), lc('ended', 11, { end_reason: 'superseded_session' })];
/** Branch 1 — R completed and was shown BEFORE the repeat. */
const completedBeforeRepeat = () => [...transition(), lc('response_received', 5), lc('persisted', 6), lc('ready', 7), lc('rendered', 8), lc('ended', 8.5, { end_reason: 'completed' })];
const without = (rows: DecodedTelemetryRow[], pred: (r: DecodedTelemetryRow) => boolean) => rows.filter((r) => !pred(r));
const replace = (rows: DecodedTelemetryRow[], pred: (r: DecodedTelemetryRow) => boolean, next: DecodedTelemetryRow) => rows.map((r) => (pred(r) ? next : r));
const isEnd = (r: DecodedTelemetryRow) => r.event === 'ai_coaching_lifecycle' && r.properties?.stage === 'ended';

describe('interrupted repeat take — two truthful branches, a proven transition (#1593)', () => {
    it('BRANCH pending_at_repeat qualifies: R pending at the accepted repeat, superseded, never rendered', () => {
        expect(classifyInterruptedRepeat(pendingAtRepeat())).toMatchObject({ ok: true, branch: 'pending_at_repeat', requestId: R, takeAttempt: A, successorAttempt: B });
    });

    it('BRANCH completed_before_repeat qualifies — NEGATIVE (Sam): a valid pre-repeat ready/render is never misclassified as a failure', () => {
        const result = classifyInterruptedRepeat(completedBeforeRepeat());
        expect(result).toMatchObject({ ok: true, branch: 'completed_before_repeat' });
    });

    it('NEGATIVE (Sam): same-session replacement with NO repeat — superseded_request alone is insufficient', () => {
        const rows = [...without(transition(), (r) => ['recording_intent', 'recording_state', 'session_started'].includes(r.event)),
            lc('ended', 11, { end_reason: 'superseded_request' })];
        expect(interruptedRepeatTake(rows)).toMatch(/no accepted repeat Start follows the saved take/);
    });

    it('NEGATIVE (Sam): a repeat click with a SUPPRESSED Start, or no RECORDING, proves no transition', () => {
        const suppressed = replace(pendingAtRepeat(), (r) => r.event === 'recording_intent', row('recording_intent', 10, { intent_kind: 'start', intent_outcome: 'suppressed_in_flight' }));
        expect(interruptedRepeatTake(suppressed)).toMatch(/no accepted repeat Start/);
        expect(interruptedRepeatTake(without(pendingAtRepeat(), (r) => r.event === 'recording_state'))).toMatch(/no recording under a new take/);
    });

    it('NEGATIVE (Sam): an unrelated take substituted as the successor (B recording without B\'s own session_started) HOLDs', () => {
        const rows = replace(pendingAtRepeat(), (r) => r.event === 'session_started', row('session_started', 13, { attempt_id: OTHER }));
        expect(interruptedRepeatTake(rows)).toMatch(/successor take's recording has no session_started of its own/);
        // A recording under A itself is not a successor.
        const self = replace(pendingAtRepeat(), (r) => r.event === 'recording_state', row('recording_state', 12, { to_state: 'RECORDING', attempt_id: A }));
        expect(interruptedRepeatTake(self)).toMatch(/no recording under a new take/);
    });

    it('NEGATIVE (Sam): wrong request / origin / boot — none satisfies the take', () => {
        const otherOrigin = replace(pendingAtRepeat(), (r) => r.properties?.stage === 'requested', lc('requested', 4, { origin_attempt_id: B }));
        expect(interruptedRepeatTake(otherOrigin)).toMatch(/no coaching request under its own origin attempt/);
        const otherBoot = replace(pendingAtRepeat(), (r) => r.properties?.stage === 'requested', lc('requested', 4, { origin_boot_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));
        expect(interruptedRepeatTake(otherBoot)).toMatch(/did not start in this boot/);
        const otherRequestEnd = replace(pendingAtRepeat(), isEnd, lc('ended', 11, { end_reason: 'superseded_session', diagnostic_request_id: R2 }));
        expect(interruptedRepeatTake(otherRequestEnd)).toMatch(/no observed end/);
        const endOtherOrigin = replace(pendingAtRepeat(), isEnd, lc('ended', 11, { end_reason: 'superseded_session', origin_attempt_id: B }));
        expect(interruptedRepeatTake(endOtherOrigin)).toMatch(/end names another origin attempt/);
    });

    it('NEGATIVE (Sam): a terminal before its request HOLDs', () => {
        const rows = [...without(transition(), (r) => r.properties?.stage === 'requested'), lc('requested', 11.5), lc('ended', 11, { end_reason: 'superseded_session' })];
        expect(interruptedRepeatTake(rows)).toMatch(/terminal precedes the request/);
    });

    it('NEGATIVE (Sam): a LATE response after the end is a separate transport fact, never a second UI terminal', () => {
        const rows = [...pendingAtRepeat(), lc('response_received', 20), lc('response_parsed', 20.1, { parse_valid: true })];
        expect(classifyInterruptedRepeat(rows)).toMatchObject({ ok: true, branch: 'pending_at_repeat' });
        expect(interruptedRepeatTake([...pendingAtRepeat(), lc('ended', 21, { end_reason: 'completed' })])).toMatch(/more than one UI terminal/);
    });

    it('NEGATIVE (Sam): stale A rendered in B — ready or rendered after the repeat is an OBSERVED FAIL', () => {
        for (const extra of [lc('ready', 14), lc('rendered', 15), stage('review_rendered', 15, A), stage('practice_loop_ready', 14, A)]) {
            const reason = String(interruptedRepeatTake([...pendingAtRepeat(), extra]));
            expect(reason).toMatch(/observed stale render into the next take/);
            expect(isObservedFailureReason(reason)).toBe(true);
            expect(readbackVerdict([`session_interrupted_repeat: ${reason}`], 'QUALIFIED', 'QUALIFIED')).toBe('FAIL');
        }
    });

    it('NEGATIVE (Sam): missing readback is never treated as absence — no end for R HOLDs, and no lifecycle family HOLDs', () => {
        expect(interruptedRepeatTake(without(pendingAtRepeat(), isEnd))).toMatch(/no observed end — neither branch is inferred from absence/);
        const declared = QUALIFICATION_STAGES.find((s) => s.stage === 'session_interrupted_repeat')!;
        expect(evaluateQualificationStage(declared, without(pendingAtRepeat(), (r) => r.event === 'ai_coaching_lifecycle')))
            .toContain('session_interrupted_repeat: missing required family ai_coaching_lifecycle');
    });

    it('a completion whose chain is not wholly before the repeat, or a supersession before any repeat, is not either branch', () => {
        const lateCompletion = [...transition(), lc('ready', 7), lc('rendered', 8), lc('ended', 10.5, { end_reason: 'completed' })];
        expect(interruptedRepeatTake(lateCompletion)).toMatch(/ready\/rendered chain is not wholly before the repeat/);
        expect(interruptedRepeatTake([...transition(), lc('ended', 9, { end_reason: 'superseded_request' })])).toMatch(/superseded before any repeat/);
        for (const end_reason of ['unmounted', 'timeout', 'failed', 'invalid_response']) {
            expect(interruptedRepeatTake([...transition(), lc('ended', 11, { end_reason })])).toMatch(new RegExp(`ended ${end_reason}, neither completed`));
        }
    });

    it('the saved take\'s own post-Stop chain through save is required, in order, under its attempt', () => {
        const wrong = replace(pendingAtRepeat(), (r) => r.properties?.stage === 'final_transcript', stage('final_transcript', 2, B));
        expect(interruptedRepeatTake(wrong)).toMatch(/no final_transcript stage for its own attempt/);
        expect(interruptedRepeatTake(without(pendingAtRepeat(), (r) => r.event === 'session_saved'))).toMatch(/no session_saved row/);
    });

    it('the declared stage requires the transition and lifecycle families, and never the review-render chain', () => {
        const declared = QUALIFICATION_STAGES.find((s) => s.stage === 'session_interrupted_repeat')!;
        for (const family of ['ai_coaching_lifecycle', 'recording_intent', 'recording_state', 'session_started']) expect(declared.requiredFamilies).toContain(family);
        expect(declared.requiredFamilies).not.toContain('practice_loop');
        expect(declared.invariants.map((i) => i.name)).toEqual(['saved_take_has_one_verified_attribution_receipt', 'open_mic_interrupted_repeat_take']);
    });
});
