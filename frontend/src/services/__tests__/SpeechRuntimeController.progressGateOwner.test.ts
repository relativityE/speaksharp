/* @vitest-environment jsdom */
// #1476 casualty (consolidated #1450). The Start gate is evaluated at the real Start entry, but it was scoped to
// `capturedUserId` — the owner of the PREVIOUS recording, which is only re-resolved later inside the start
// pipeline. After a fresh reload that owner is still null; after an account switch it is still the previous account.
// The gate therefore ignored the signed-in viewer's own Progress debt (a Start that should be refused was allowed),
// and could hold the new account on the previous account's debt.
//
// The app-global reconciliation hook publishes the signed-in owner synchronously as `progressGateResolvedFor`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { enqueueProgressReconcile } from '@/services/progress/progressReconcileQueue';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

interface Ctl {
    startRecording: () => Promise<void>;
    ensureReady: ReturnType<typeof vi.fn>;
}

function makeController(capturedUserId: string | null): Ctl {
    const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl;
    const raw = c as unknown as Record<string, unknown>;
    raw.pendingAttributionRetry = null;
    raw.pendingFullSaveRetry = null;
    raw.recordingStartedUnresolved = false;
    raw.capturedUserId = capturedUserId;
    c.ensureReady = vi.fn().mockResolvedValue(undefined);
    return c;
}

const GATE_MESSAGE = /retry|couldn.t confirm|progress/i;

beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.setState({ progressGate: null, progressGateResolvedFor: null, sttStatus: { type: 'idle', message: '' } } as never);
});

describe('#1476 / #1450 — the Start gate is scoped to the signed-in owner, not the previous recording', () => {
    it('CASUALTY: fresh reload (no captured owner yet) — the signed-in user\'s queued gate still refuses Start', async () => {
        useSessionStore.setState({
            progressGateResolvedFor: 'user-B',
            progressGate: { sessionId: 's-owed', ownerId: 'user-B', state: 'queued' },
        } as never);
        const c = makeController(null);
        await c.startRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        expect(useSessionStore.getState().sttStatus.message).toMatch(GATE_MESSAGE);
        expect(c.ensureReady).not.toHaveBeenCalled();
    });

    it('CASUALTY: fresh reload — DURABLE debt queued for the signed-in user (no in-memory gate) still refuses Start', async () => {
        expect(enqueueProgressReconcile('s-durable', 'user-B', new Date().toISOString()).ok).toBe(true);
        useSessionStore.setState({ progressGateResolvedFor: 'user-B', progressGate: null } as never);
        const c = makeController(null);
        await c.startRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        expect(c.ensureReady).not.toHaveBeenCalled();
    });

    it('CASUALTY: account switch A → B — B\'s own queued gate refuses Start even though A recorded last', async () => {
        useSessionStore.setState({
            progressGateResolvedFor: 'user-B',
            progressGate: { sessionId: 's-owed-by-B', ownerId: 'user-B', state: 'unresolved' },
        } as never);
        const c = makeController('user-A');
        await c.startRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        expect(c.ensureReady).not.toHaveBeenCalled();
    });

    it('CASUALTY: account switch A → B — A\'s leftover gate never blocks B', async () => {
        useSessionStore.setState({
            progressGateResolvedFor: 'user-B',
            progressGate: { sessionId: 's-owed-by-A', ownerId: 'user-A', state: 'queued' },
        } as never);
        const c = makeController('user-A');
        await c.startRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus.message ?? '').not.toMatch(GATE_MESSAGE);
    });

    it('CONTROL: a signed-out visitor (resolved as \'\') is not blocked by a gate that belongs to an account', async () => {
        useSessionStore.setState({
            progressGateResolvedFor: '',
            progressGate: { sessionId: 's-owed', ownerId: 'user-B', state: 'queued' },
        } as never);
        const c = makeController(null);
        await c.startRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus.message ?? '').not.toMatch(GATE_MESSAGE);
    });

    it('CONTROL: before the owner is determined (null), the captured owner still scopes the gate as before', async () => {
        useSessionStore.setState({
            progressGateResolvedFor: null,
            progressGate: { sessionId: 's-owed', ownerId: 'user-A', state: 'queued' },
        } as never);
        const c = makeController('user-A');
        await c.startRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        expect(c.ensureReady).not.toHaveBeenCalled();
    });
});
