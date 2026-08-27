/* @vitest-environment jsdom */
// #1354 subtask B — the recorder is gated on TERMINAL Progress evidence, at the real Start entry.
//
// THE DEFECT. `completeProgressForRecording` was `void`-dispatched, so the recorder returned to a
// startable state while the evaluation was still in flight. On a rapid three-session journey the third
// completion reached retention while the oldest outgoing session still lacked terminal evidence, and
// the server correctly refused to retain the new transcript under strict newest-two (attempt 9,
// envelope: transcript_outcome=retention_failed, retention_status=pending).
//
// The gate is enforced HERE, in the controller, before any model or recording lifecycle begins. A
// disabled button is a visible cue, not a gate.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

// Structural, not an intersection with the class: intersecting with SpeechRuntimeController collapses
// to `never` because the private members are nominally incompatible with a hand-built object.
interface Ctl {
    startRecording: () => Promise<void>;
    ensureReady: ReturnType<typeof vi.fn>;
    applyProgressGate: (sessionId: string, outcome: { kind: string; reason?: string }) => unknown;
}

function makeController(): Ctl {
    const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl;
    // Start is blocked before any lifecycle work, so nothing else needs constructing.
    (c as unknown as Record<string, unknown>).pendingAttributionRetry = null;
    (c as unknown as Record<string, unknown>).pendingFullSaveRetry = null;
    (c as unknown as Record<string, unknown>).recordingStartedUnresolved = false;
    c.ensureReady = vi.fn().mockResolvedValue(undefined);
    return c;
}

beforeEach(() => {
    useSessionStore.setState({ progressGate: null, sttStatus: { type: 'idle', message: '' } } as never);
});

describe('the Start entry enforces the gate', () => {
    it('POSITIVE CONTROL: with no gate, Start is NOT blocked by the gate', async () => {
        // Proven by what the guard would have done: it returns early AND sets its own message. With no
        // gate, execution continues past it (and then fails on this bare instance's uninitialised
        // internals, which is fine — the assertion is about the GATE, not about completing a start).
        const c = makeController();
        await c.startRecording().catch(() => undefined);
        const msg = useSessionStore.getState().sttStatus.message ?? '';
        expect(msg).not.toMatch(/couldn.t confirm|retry automatically/i);
    });

    it.each([
        ['queued', /retry/i],
        ['unresolved', /couldn.t confirm .*progress was saved/i],
    ])('a %s gate blocks Start and surfaces an actionable message', async (state, msgRe) => {
        useSessionStore.setState({ progressGate: { sessionId: 's-prev', ownerId: null, state } } as never);
        const c = makeController();
        await c.startRecording();
        const status = useSessionStore.getState().sttStatus;
        expect(status.type).toBe('error');
        expect(status.message).toMatch(msgRe);
        // The model/recording lifecycle must not have been entered at all.
        expect(c.ensureReady).not.toHaveBeenCalled();
    });

    it('the blocking message carries no transcript or customer content', async () => {
        useSessionStore.setState({ progressGate: { sessionId: 's-prev', ownerId: null, state: 'unresolved' } } as never);
        const c = makeController();
        await c.startRecording();
        const msg = useSessionStore.getState().sttStatus.message;
        expect(msg).not.toContain('s-prev');
        expect(msg.length).toBeLessThan(200);
    });
});

describe('applyProgressGate publishes the gate from the outcome', () => {
    it.each([
        [{ kind: 'recorded' }, null],
        [{ kind: 'not_applicable', reason: 'not_completed' }, null],
        [{ kind: 'queued' }, 'queued'],
        [{ kind: 'unresolved', reason: 'queue_unavailable' }, 'unresolved'],
        [{ kind: 'unresolved', reason: 'attribution_not_terminal' }, 'unresolved'],
    ])('%o -> gate %s', (outcome, expected) => {
        const c = makeController();
        c.applyProgressGate('s1', outcome as { kind: string });
        const gate = useSessionStore.getState().progressGate;
        expect(gate ? gate.state : null).toBe(expected);
    });

    it('clears only the gate belonging to THIS session', () => {
        useSessionStore.setState({ progressGate: { sessionId: 'other', ownerId: null, state: 'queued' } } as never);
        const c = makeController();
        c.applyProgressGate('s1', { kind: 'recorded' });
        // Another session's pending debt must survive — clearing it would unlock on the wrong evidence.
        expect(useSessionStore.getState().progressGate).toEqual({ sessionId: 'other', ownerId: null, state: 'queued' });
    });

    it('a FORMER account\'s result cannot clear the current owner\'s gate', () => {
        // Switching accounts must invalidate an in-flight result from the previous owner.
        useSessionStore.setState({ progressGate: { sessionId: 's1', ownerId: 'user-A', state: 'queued' } } as never);
        const c = makeController();
        (c as unknown as Record<string, unknown>).capturedUserId = 'user-B';
        c.applyProgressGate('s1', { kind: 'recorded' });
        expect(useSessionStore.getState().progressGate).toEqual({ sessionId: 's1', ownerId: 'user-A', state: 'queued' });
    });

    it('clears the matching gate on a durable terminal result', () => {
        useSessionStore.setState({ progressGate: { sessionId: 's1', ownerId: null, state: 'queued' } } as never);
        const c = makeController();
        c.applyProgressGate('s1', { kind: 'recorded' });
        expect(useSessionStore.getState().progressGate).toBeNull();
    });
});
