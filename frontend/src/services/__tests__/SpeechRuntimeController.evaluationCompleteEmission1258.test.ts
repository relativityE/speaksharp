// @vitest-environment jsdom
/**
 * #1258 item 5 (PM 6216341052; Sam RETURN 6217644163) — the POSITIVE proof that `evaluation_complete` is produced by the
 * take's successful, owned Focus finalization, observed at the real telemetry boundary: the `stage_latency` rows the
 * analytics buffer actually sends, in EMISSION order, each carrying the envelope's `attempt_id`.
 *
 * `reachedStages()` cannot prove order (it sorts by the constant chain) and a first mark emits no row, so this seeds the
 * take's identity and its preceding stages, defers the objective finalization, and inspects captured rows. A negative
 * control shows the real chain oracle rejects the reversed sequence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { analyticsBuffer } from '../AnalyticsBuffer';
import { markCompletionStage, __resetCompletionStagesForTests } from '../telemetry/completionStages';
import { beginJourney, beginRecordingAttempt, __resetJourneyIdentityForTests } from '../telemetry/journeyIdentity';
import { FOCUS_POINTS_POST_STOP_CHAIN, postStopChainInOrder, type DecodedTelemetryRow } from '../telemetry/completenessGate';
import { deriveFocusCoverage } from '@/utils/focusCoverage';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));
const finalizeObjectiveSessionOnSave = vi.fn();
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: (...a: unknown[]) => finalizeObjectiveSessionOnSave(...a),
}));
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

type Gate = (
    brief: { projectId: string; briefId: string },
    sessionId: string,
    segments: { text: string; startSec: number }[],
    durationSeconds: number,
    runProgressEval: () => void,
    canPublishShared: () => boolean,
) => Promise<{ kind: string; reason?: string }>;

const BRIEF = { projectId: 'proj', briefId: 'brief' };
const SUCCESS = { ok: true, objectiveSessionId: 'obj', evidenceCount: 1, registered: true,
    coverage: [{ briefPointId: 'p1', point: 'Point one', status: 'covered' }] };

/** The stage_latency rows the buffer actually sent, in emission order. Pushing a CRITICAL event flushes the buffer. */
const sentStageRows = (): { stage: string; attempt_id: unknown }[] => {
    analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
    return (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .filter((c) => c[0] === 'stage_latency')
        .map((c) => c[1] as { stage: string; attempt_id: unknown });
};

describe('#1258 item 5 — evaluation_complete emission at the owned Focus finalization (actual rows, order, attempt)', () => {
    let gate: Gate;
    let attemptId: string;

    beforeEach(() => {
        vi.clearAllMocks();
        finalizeObjectiveSessionOnSave.mockReset();
        __resetCompletionStagesForTests();
        __resetJourneyIdentityForTests();
        analyticsBuffer.queue.length = 0;
        analyticsBuffer.ready = true;
        useSessionStore.getState().setObjectiveCoverageResult(null);
        beginJourney();
        attemptId = beginRecordingAttempt(); // the take's identity, stamped on every row by the envelope
        // The take's preceding stages, so evaluation_complete is not a first mark (a first mark emits no row).
        markCompletionStage('stop_intent');
        markCompletionStage('recording_terminated');
        markCompletionStage('final_transcript');
        const controller = SpeechRuntimeController.getInstance();
        gate = (controller as unknown as { finalizeObjectiveAndGateProgress: Gate }).finalizeObjectiveAndGateProgress.bind(controller);
    });

    it('no row before the finalization succeeds; exactly one after; emitted BEFORE session_saved; same attempt; a later settled render adds none', async () => {
        let resolveFinalize: (v: unknown) => void = () => undefined;
        finalizeObjectiveSessionOnSave.mockImplementation(() => new Promise((r) => { resolveFinalize = r; }));
        const pending = gate(BRIEF, 'sess-ok', [], 60, vi.fn(), () => true);
        await vi.waitFor(() => expect(finalizeObjectiveSessionOnSave).toHaveBeenCalled()); // the seam imports, then calls
        expect(sentStageRows().map((r) => r.stage), 'nothing is marked while the evaluation is still pending').not.toContain('evaluation_complete');

        resolveFinalize(SUCCESS);
        await pending;
        markCompletionStage('session_saved'); // what the hook does once Stop resolves — strictly after the seam above
        deriveFocusCoverage(['Point one'], 'point one was covered here', 10, undefined, true); // a later settled render

        const rows = sentStageRows();
        const stages = rows.map((r) => r.stage);
        expect(stages.filter((s) => s === 'evaluation_complete'), 'exactly one evaluation_complete row').toHaveLength(1);
        expect(stages.indexOf('evaluation_complete'), 'emitted before session_saved, in actual emission order')
            .toBeLessThan(stages.indexOf('session_saved'));
        const evalRow = rows.find((r) => r.stage === 'evaluation_complete')!;
        const savedRow = rows.find((r) => r.stage === 'session_saved')!;
        expect(evalRow.attempt_id, 'bound to the take').toBe(attemptId);
        expect(savedRow.attempt_id, 'the same take as session_saved').toBe(attemptId);
    });

    it('ownership LOST while the finalization is pending: no evaluation_complete row for this (or a successor) take', async () => {
        let resolveFinalize: (v: unknown) => void = () => undefined;
        let owns = true;
        finalizeObjectiveSessionOnSave.mockImplementation(() => new Promise((r) => { resolveFinalize = r; }));
        const pending = gate(BRIEF, 'sess-stale', [], 60, vi.fn(), () => owns);
        await vi.waitFor(() => expect(finalizeObjectiveSessionOnSave).toHaveBeenCalled());
        owns = false; // a newer take took the page before this finalization settled
        resolveFinalize(SUCCESS);
        await pending;
        expect(sentStageRows().map((r) => r.stage)).not.toContain('evaluation_complete');
    });

    it('NEGATIVE ORACLE: the real chain gate rejects session_saved before evaluation_complete, and a missing marker, for the same attempt', () => {
        const row = (stage: string, t: number): DecodedTelemetryRow =>
            ({ event: 'stage_latency', properties: { stage, duration_ms: 1, attempt_id: 'a1' }, timestamp: t });
        const saved = { event: 'session_saved', properties: { attempt_id: 'a1' }, timestamp: 50 } as DecodedTelemetryRow;
        const tail = [row('practice_loop_ready', 60), row('review_rendered', 70)];
        const head = [row('recording_terminated', 10), row('final_transcript', 20)];
        const check = postStopChainInOrder(FOCUS_POINTS_POST_STOP_CHAIN);
        const inOrder = [...head, row('evaluation_complete', 30), row('session_saved', 40), ...tail, saved];
        const reversed = [...head, row('session_saved', 30), row('evaluation_complete', 40), ...tail, saved];
        const missing = [...head, row('session_saved', 30), ...tail, saved];
        expect(check(inOrder), 'control: the correct order passes').toBeNull();
        expect(check(reversed), 'a reversal is rejected').not.toBeNull();
        expect(check(missing), 'a missing marker is rejected').not.toBeNull();
    });
});
