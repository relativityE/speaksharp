/* @vitest-environment jsdom */
// #1354 ACCEPTANCE CASE 5 (terminal ineligibility) + CASE 6 (entry-point parity).
//
// CASE 5. Only PROVEN durable terminal exclusion may unlock. `registered: false` has two origins: a
// definitive registration refusal (the server answered) and a throw before registration, where the
// state is UNKNOWN. Relabelling the second `not_completed` unlocks the recorder on an assumption.
//
// CASE 6. Open Mic and Focus Points must reach the SAME controller-level gate, and the fail-closed
// early returns must PUBLISH it — they previously returned before the gate was ever begun, so the
// most fail-closed paths in the seam were the only ones that left Start open.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeechRuntimeController } from '../../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

const rpc = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: () => ({}) }) }));
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));
const finalizeObjectiveSessionOnSave = vi.fn();
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({ finalizeObjectiveSessionOnSave }));

const OWNER = 'user-parity';
const SESSION = 'sess-parity';
const BRIEF = { projectId: 'proj-1', briefId: 'brief-1' };

type Ctx =
    | { mode: 'open_mic' }
    | { mode: 'unknown' }
    | { mode: 'focus_points'; brief: typeof BRIEF; segments: { text: string; startSec: number }[]; durationSeconds: number };
interface Ctl {
    startRecording: () => Promise<void>;
    ensureReady: ReturnType<typeof vi.fn>;
    completeProgressForRecording: (
        ctx: Ctx, sessionId: string, attributionStatus: string | undefined, metricsPersisted: boolean,
    ) => Promise<{ kind: string; reason?: string }>;
}
function makeController(): Ctl {
    const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl;
    const raw = c as unknown as Record<string, unknown>;
    raw.capturedUserId = OWNER;
    raw.pendingAttributionRetry = null;
    raw.pendingFullSaveRetry = null;
    raw.recordingStartedUnresolved = false;
    c.ensureReady = vi.fn().mockResolvedValue(undefined);
    return c;
}
const focusCtx = (): Ctx => ({ mode: 'focus_points', brief: BRIEF, segments: [], durationSeconds: 10 });
const gate = () => useSessionStore.getState().progressGate;

beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'eval-1', error: null });
    finalizeObjectiveSessionOnSave.mockReset();
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setSTTStatus({ type: 'idle', message: '' });
});

describe('CASE 5 — only proven durable terminal exclusion unlocks', () => {
    it('a DEFINITIVE registration refusal is terminal and unlocks', async () => {
        // The server answered: nothing was written, nothing is owed, no evaluation will ever arrive.
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'register', reason: 'denied', registered: false });
        const outcome = await makeController().completeProgressForRecording(focusCtx(), SESSION, 'verified', true);
        expect(outcome).toMatchObject({ kind: 'not_applicable', reason: 'not_completed' });
        expect(gate(), 'a proven exclusion must not leave the user blocked').toBeNull();
    });

    it('an UNCONFIRMED registration must NOT be relabelled not_completed', async () => {
        // A throw before registration also reports registered:false, and the type's own contract notes
        // that a throw LOSES the stage. The write may have reached the server, so this is unknown.
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, reason: 'error', registered: false });
        const outcome = await makeController().completeProgressForRecording(focusCtx(), SESSION, 'verified', true);
        expect(outcome.kind, 'unknown is not an accepted terminal exclusion').toBe('unresolved');
        expect(gate()).toMatchObject({ sessionId: SESSION, ownerId: OWNER, state: 'unresolved' });
    });

    it('an ambiguous THROW during finalization stays blocked', async () => {
        finalizeObjectiveSessionOnSave.mockRejectedValue(new Error('network'));
        const outcome = await makeController().completeProgressForRecording(focusCtx(), SESSION, 'verified', true);
        expect(outcome.kind).toBe('unresolved');
        expect(gate()).toMatchObject({ sessionId: SESSION, state: 'unresolved' });
    });

    it('a non-terminal attribution stays blocked rather than evaluating', async () => {
        const outcome = await makeController().completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'pending', true);
        expect(outcome).toMatchObject({ kind: 'unresolved', reason: 'attribution_not_terminal' });
        expect(gate()).toMatchObject({ sessionId: SESSION, state: 'unresolved' });
    });
});

describe('CASE 6 — fail-closed early returns publish the gate, and both entry points share it', () => {
    it.each([
        // metricsPersisted=false is what makes the first case exercise the metrics guard AT ALL. It was
        // inverted here at first: the case passed while never reaching the branch it names, and the
        // mutation that removes the gate publication survived. The mutant is the only reason that
        // showed up — a green test proves nothing until it has been made to fail.
        ['missing durable metrics', { mode: 'open_mic' } as Ctx, false],
        ['an unknown/legacy retry context', { mode: 'unknown' } as Ctx, true],
    ])('%s blocks Start instead of silently returning', async (_label, ctx, metricsPersisted) => {
        // THE DEFECT. Both returned BEFORE `beginProgressGate`, so they reported `unresolved` while
        // leaving the recorder startable — the opposite of failing closed.
        const controller = makeController();
        const outcome = await controller.completeProgressForRecording(ctx, SESSION, 'verified', metricsPersisted);

        expect(outcome.kind).toBe('unresolved');
        expect(gate(), 'the fail-closed verdict must be VISIBLE').toMatchObject({
            sessionId: SESSION, ownerId: OWNER, state: 'unresolved',
        });

        await controller.startRecording();
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        expect(controller.ensureReady).not.toHaveBeenCalled();
    });

    it('Open Mic and Focus Points publish the SAME gate shape for the same failure', async () => {
        // Parity is structural, not two copies kept in step by hand.
        const openMic = makeController();
        await openMic.completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'pending', true);
        const openMicGate = gate();

        useSessionStore.getState().setProgressGate(null);
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: true, registered: true, coverage: null });
        const focus = makeController();
        await focus.completeProgressForRecording(focusCtx(), SESSION, 'pending', true);

        expect(gate()).toEqual(openMicGate);
    });

    it('a stale FOREIGN gate does not block or contaminate this owner\'s completion', async () => {
        // One tab has one current user, so a gate left by a previous account is stale: it must not
        // block this owner, and the gate this completion publishes must carry THIS owner and THIS
        // session rather than inheriting the foreign identity.
        //
        // The protected direction is the opposite one — a foreign RESULT must never CLEAR a live gate —
        // and that is proven separately by the acceptance-1 closure test.
        useSessionStore.getState().setProgressGate({ sessionId: 'other-sess', ownerId: 'someone-else', state: 'queued' });
        const outcome = await makeController().completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'pending', true);

        expect(outcome.kind).toBe('unresolved');
        expect(gate()).toMatchObject({ sessionId: SESSION, ownerId: OWNER, state: 'unresolved' });
        expect(gate()?.ownerId, 'no foreign identity may leak in').not.toBe('someone-else');
    });
});
