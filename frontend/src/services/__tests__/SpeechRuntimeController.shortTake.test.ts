// @vitest-environment jsdom
/**
 * G5 (#1861, live AHT-03 run 43585559387) — a take stopped under the minimum duration is DISCARDED, never completed.
 *
 * The page measures the take on the live clock, finds it under the minimum and tells the user it is too short. It
 * then stopped the take with the ordinary Stop, and the real controller, whose only save guard was "no meaningful
 * words", completed the session (`completeSession({ status: 'completed', duration: 3 })`). The page now passes its
 * verdict; these tests drive the REAL controller (engine and storage boundaries mocked) and assert at the
 * persistence boundary that such a take is resolved by discard, with the runtime fully settled afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession, saveSession } from '../../lib/storage';
import { getUnsettledDiscardRecordForUser } from '../unsettledDiscardRecord';

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/services/telemetry/fillerMeasurement', () => ({ emitFillerMeasurement: vi.fn() }));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) } })),
}));

// Synthetic fixture text: meaningful words, so the existing no-speech guard does NOT apply.
const BEFORE_STOP = 'So um I want to make um three points um about the rollout plan';
const DECODED_DURING_FINALIZING = 'and um that is why we should start next week';

type Priv = {
    state: string; initialized: boolean; isEngineReady: boolean; isEmissionsSafe: boolean; sessionId: string | null; service: unknown;
    pendingDiscardSettlement: unknown; recordingStartedUnresolved: boolean;
    pendingAttributionRetry?: unknown; pendingFullSaveRetry?: unknown; capturedUserId?: string | null; rehydratedFor?: string | null;
};

describe('G5 — a take under the minimum duration is discarded by the real controller', () => {
    let controller: SpeechRuntimeController;
    const priv = () => controller as unknown as Priv;

    /** A batch engine started `secondsAgo` before Stop; `trailing` is decoded during finalizing, after Stop. */
    const engine = (secondsAgo: number, trailing: string | null = null) => {
        const svc = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - secondsAgo * 1000),
            stopTranscription: vi.fn(async () => {
                if (trailing !== null) {
                    (controller as unknown as { handleTranscriptUpdate: (u: unknown) => void })
                        .handleTranscriptUpdate({ transcript: { final: trailing, partial: '' } });
                }
                return { transcript: '', stats: { accuracy: 0.95, total_words: 20, filler_words: {} } };
            }),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        };
        priv().service = svc as unknown as ITranscriptionService;
        return svc;
    };
    const completions = (status: string) => vi.mocked(completeSession).mock.calls.filter((call) => call[1]?.status === status);

    beforeEach(() => {
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        Object.assign(priv(), {
            state: 'RECORDING', initialized: true, isEngineReady: true, isEmissionsSafe: true, sessionId: 'test-sess',
            pendingDiscardSettlement: null, recordingStartedUnresolved: false, capturedUserId: null, rehydratedFor: null,
        });
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript(BEFORE_STOP, '');
        vi.clearAllMocks();
    });
    afterEach(() => { priv().service = null; });

    it('a 3 s meaningful take stopped as too short is marked failed, never completed, and the runtime settles', async () => {
        const svc = engine(3);
        const result = await controller.stopRecording({ belowMinimumDuration: true });

        expect(completions('completed'), 'no completed session for a take the user was told is too short').toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
        expect(vi.mocked(completeSession).mock.calls[0][0]).toBe('test-sess');
        expect(String(completions('failed')[0]?.[1]?.reason)).toMatch(/minimum duration/i);
        expect(String(useSessionStore.getState().sttStatus.message ?? ''), 'the page owns the too-short message').not.toMatch(/enough speech/i);
        expect(result, 'the stop reports no saved result').toBeNull();
        // Terminal cleanup: the engine is released and the take is resolved, not left finalizing or locked.
        expect(svc.destroy).toHaveBeenCalled();
        expect(controller.getState()).toBe('READY');
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
        expect(useSessionStore.getState().sessionSaved).toBe(false);
    });

    it('words decoded during finalization do not turn a too-short take into a saved one', async () => {
        engine(3, DECODED_DURING_FINALIZING);
        await controller.stopRecording({ belowMinimumDuration: true });

        expect(completions('completed')).toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
    });

    it('a too-short take with no row yet gets its row at Stop only to mark it failed (settling the lease obligation)', async () => {
        priv().sessionId = null;
        engine(3);
        const result = await controller.stopRecording({ belowMinimumDuration: true });

        // The late create binds the take's lease; marking that row failed is what settles the save obligation.
        expect(vi.mocked(saveSession)).toHaveBeenCalledTimes(1);
        expect(completions('completed')).toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
        expect(vi.mocked(completeSession).mock.calls[0]?.[0]).toBe('test-sess');
        expect(result).toBeNull();
        expect(controller.getState()).toBe('READY');
        expect(useSessionStore.getState().sessionSaved).toBe(false);
    });

    // Sam on 3a91a20: storage reports `{ success: false }` on an RPC error or an invalid response. The `failed` mark,
    // and with it the lease's save obligation, is then NOT settled, so the take must not be reported discarded.
    it.each([
        ['returns { success: false }', () => vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never)],
        ['throws', () => vi.mocked(completeSession).mockRejectedValueOnce(new Error('network'))],
    ])('when marking the too-short take failed %s, the take stays unresolved with Try again, never reported discarded', async (_label, failOnce) => {
        engine(3);
        failOnce();
        const result = await controller.stopRecording({ belowMinimumDuration: true });

        expect(completions('completed')).toHaveLength(0);
        expect(result).toBeNull();
        expect(controller.getState()).toBe('READY');
        expect(controller.pendingResolutionKind(), 'an unconfirmed discard is an explicit unsettled outcome').toBe('discard');
        expect(controller.isEngineSelectionLocked(), 'the take stays unresolved until its row is settled').toBe(true);
        expect(useSessionStore.getState().pendingResolutionKind).toBe('discard');
        expect(useSessionStore.getState().sessionSaved).toBe(false);

        // Try again re-runs exactly the failed op: the same row, marked failed, never completed.
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await expect(controller.retryRecordingSave(), 'a second failure stays retryable').resolves.toBe(false);
        expect(controller.pendingResolutionKind()).toBe('discard');

        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        const failed = completions('failed');
        expect(failed).toHaveLength(3);
        expect(failed.every((call) => call[0] === 'test-sess')).toBe(true);
        expect(String(failed[2]?.[1]?.reason)).toMatch(/minimum duration/i);
        expect(completions('completed')).toHaveLength(0);
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect(useSessionStore.getState().pendingResolutionKind).toBeNull();
    });

    it('a confirmed Discard also settles an unconfirmed discard on the same row', async () => {
        engine(3);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await controller.stopRecording({ belowMinimumDuration: true });
        expect(controller.pendingResolutionKind()).toBe('discard');

        await expect(controller.discardUnresolvedRecording()).resolves.toEqual({ outcome: 'discarded', sessionId: 'test-sess' });
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect(completions('completed')).toHaveLength(0);
    });

    it('an unsettled discard survives a post-start failure check and a hard reset clears it', async () => {
        engine(3);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await controller.stopRecording({ belowMinimumDuration: true });
        expect(controller.hasUnsettledDiscard()).toBe(true);

        // A later failure path must not resolve (unlock) a take whose row is still unsettled.
        priv().recordingStartedUnresolved = true;
        (controller as unknown as { ensurePostStartFailureIsActionable: () => void }).ensurePostStartFailureIsActionable();
        expect(priv().recordingStartedUnresolved, 'Try again still owns this take').toBe(true);
        expect(controller.pendingResolutionKind()).toBe('discard');

        // A hard reset (sign-out, account switch) retires it like every other recovery slot.
        controller.reset('account_switch');
        expect(controller.hasUnsettledDiscard()).toBe(false);
        expect(controller.pendingResolutionKind()).toBeNull();
    });

    it('a hard reset during the pending failed mark does not re-arm Try again for the successor', async () => {
        engine(3);
        let finishMark!: (v: unknown) => void;
        vi.mocked(completeSession).mockImplementationOnce(() => new Promise((resolve) => { finishMark = resolve; }) as never);
        const stopping = controller.stopRecording({ belowMinimumDuration: true }).catch(() => null);
        await vi.waitFor(() => expect(finishMark).toBeTypeOf('function'));

        controller.reset('account_switch');
        finishMark({ success: false });
        await stopping;

        expect(controller.hasUnsettledDiscard(), 'the superseded stop arms nothing').toBe(false);
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(completions('completed')).toHaveLength(0);
    });

    it('positive control: the same take stopped without the verdict is completed (the harness can see a save)', async () => {
        engine(5);
        await controller.stopRecording();

        const completed = completions('completed');
        expect(completed).toHaveLength(1);
        expect(completed[0]?.[1]?.duration).toBe(5);
        expect(completions('failed')).toHaveLength(0);
    });

    // Codex P2 on a58a348: the no-speech discard shares the branch. A confirmed Try again must retire its own
    // "couldn't finish clearing it" warning, and only that one.
    it('a no-speech discard settled by Try again replaces its own warning, and leaves a later status alone', async () => {
        // The positive control above completes a take whose attribution write is unmocked; clear what it left armed.
        Object.assign(priv(), { pendingAttributionRetry: null, pendingFullSaveRetry: null });
        useSessionStore.getState().updateTranscript('', '');
        engine(8);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await controller.stopRecording();
        expect(controller.pendingResolutionKind()).toBe('discard');
        expect(useSessionStore.getState().sttStatus.message).toMatch(/couldn't finish clearing it/i);

        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(useSessionStore.getState().sttStatus).toEqual({
            type: 'warning',
            message: "We didn't detect enough speech to save this session.",
            detail: 'Try recording again and speak for at least a few seconds.',
        });
        expect(completions('completed')).toHaveLength(0);

        // A second unsettled no-speech discard, then another status before Try again: that status stays.
        Object.assign(priv(), { state: 'RECORDING', sessionId: 'test-sess-2' });
        useSessionStore.getState().setRuntimeState('RECORDING');
        engine(8);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await controller.stopRecording();
        expect(controller.pendingResolutionKind()).toBe('discard');
        const later = { type: 'error' as const, message: 'Microphone disconnected.' };
        useSessionStore.getState().setSTTStatus(later);
        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(useSessionStore.getState().sttStatus).toBe(later);
    });

    // Review on b41b52b: the page registers its warning only for the take its own Stop armed.
    it('a below-minimum stop names the take it armed, and a warning for another take is not registered', async () => {
        engine(3);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        const armed: string[] = [];
        await controller.stopRecording({ belowMinimumDuration: true, onUnsettledDiscard: (id) => armed.push(id) });
        expect(armed).toEqual(['test-sess']);

        const shown = { type: 'warning' as const, message: 'page warning for another take' };
        useSessionStore.getState().setSTTStatus(shown);
        controller.noteUnsettledDiscardWarning({ type: 'info', message: 'settled text' }, 'some-other-take');
        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(useSessionStore.getState().sttStatus).toBe(shown);

        // A confirmed mark arms nothing, so the stop names no take.
        Object.assign(priv(), { state: 'RECORDING', sessionId: 'test-sess-3' });
        useSessionStore.getState().setRuntimeState('RECORDING');
        engine(3);
        const none: string[] = [];
        await controller.stopRecording({ belowMinimumDuration: true, onUnsettledDiscard: (id) => none.push(id) });
        expect(none).toEqual([]);
    });


    // Sam on a58a348: the slot is memory only. A reload, hard reset or sign-out must not lose the only way to settle the
    // row's save obligation; the owner's return re-arms Try again for the same row, and no one else's does.
    describe('an unsettled discard outlives a reload for its owner', () => {
        const OWNER = 'owner-a';
        const failOnce = () => vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);

        it('the owner returning after a hard reset re-arms Try again, which settles the same row; another account does not', async () => {
            priv().capturedUserId = OWNER;
            engine(3);
            failOnce();
            await controller.stopRecording({ belowMinimumDuration: true });
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('test-sess');

            controller.reset('account_switch'); // the in-memory slot is gone, as after a reload
            expect(controller.hasUnsettledDiscard()).toBe(false);

            expect(controller.rehydrateUnresolvedRecording('owner-b'), 'never another account').toBe(false);
            expect(controller.pendingResolutionKind()).toBeNull();

            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);
            expect(controller.pendingResolutionKind()).toBe('discard');
            expect(controller.isEngineSelectionLocked(), 'Start stays refused until the row is settled').toBe(true);
            expect(useSessionStore.getState().pendingResolutionKind).toBe('discard');

            await expect(controller.retryRecordingSave()).resolves.toBe(true);
            expect(completions('failed').map((call) => call[0]), 'the same row, marked failed twice').toEqual(['test-sess', 'test-sess']);
            expect(completions('completed')).toHaveLength(0);
            expect(getUnsettledDiscardRecordForUser(OWNER), 'settled, so nothing is left to recover').toBeNull();
            expect(controller.pendingResolutionKind()).toBeNull();
            expect(controller.isEngineSelectionLocked()).toBe(false);
        });

        it('a stop superseded during the pending mark arms nothing here but still records the row for its owner', async () => {
            priv().capturedUserId = OWNER;
            engine(3);
            let finishMark!: (v: unknown) => void;
            vi.mocked(completeSession).mockImplementationOnce(() => new Promise((resolve) => { finishMark = resolve; }) as never);
            const stopping = controller.stopRecording({ belowMinimumDuration: true }).catch(() => null);
            await vi.waitFor(() => expect(finishMark).toBeTypeOf('function'));
            controller.reset('account_switch');
            finishMark({ success: false });
            await stopping;

            expect(controller.hasUnsettledDiscard()).toBe(false);
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('test-sess');
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);
            expect(controller.pendingResolutionKind()).toBe('discard');
        });

        it('a confirmed mark records nothing; a confirmed Discard clears the record; an ownerless take records nothing', async () => {
            priv().capturedUserId = OWNER;
            engine(3);
            await controller.stopRecording({ belowMinimumDuration: true });
            expect(getUnsettledDiscardRecordForUser(OWNER)).toBeNull();

            Object.assign(priv(), { state: 'RECORDING', sessionId: 'test-sess-2' });
            useSessionStore.getState().setRuntimeState('RECORDING');
            engine(3);
            failOnce();
            await controller.stopRecording({ belowMinimumDuration: true });
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('test-sess-2');
            await expect(controller.discardUnresolvedRecording()).resolves.toEqual({ outcome: 'discarded', sessionId: 'test-sess-2' });
            expect(getUnsettledDiscardRecordForUser(OWNER)).toBeNull();

            Object.assign(priv(), { state: 'RECORDING', sessionId: 'test-sess-3', capturedUserId: null });
            useSessionStore.getState().setRuntimeState('RECORDING');
            engine(3);
            failOnce();
            await controller.stopRecording({ belowMinimumDuration: true });
            expect(controller.hasUnsettledDiscard(), 'still offered on this page').toBe(true);
            expect(localStorage.getItem('speaksharp_unsettled_discard'), 'nothing durable without an owner').toBeNull();
        });

        it('an account change retires the departing owner\'s rehydrated discard and keeps their record', async () => {
            priv().capturedUserId = OWNER;
            engine(3);
            failOnce();
            await controller.stopRecording({ belowMinimumDuration: true });
            controller.reset('account_switch');
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);

            controller.retireRehydratedRecoveryFor(OWNER);
            expect(controller.hasUnsettledDiscard()).toBe(false);
            expect(controller.isEngineSelectionLocked(), 'the next account is not locked behind it').toBe(false);
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('test-sess');
        });

        // Review on a95ca10: the owner is the take's own, from stop entry. A successor account that starts during the
        // stop's awaits must never be recorded as this row's owner, or it is locked behind a row it cannot settle.
        it('a successor account that starts while the stop is finalizing is never recorded as the row\'s owner', async () => {
            priv().capturedUserId = OWNER;
            const svc = engine(3);
            let finishStop!: () => void;
            svc.stopTranscription = vi.fn(() => new Promise((resolve) => {
                finishStop = () => resolve({ transcript: '', stats: { accuracy: 0.95, total_words: 20, filler_words: {} } });
            })) as never;
            failOnce();
            const stopping = controller.stopRecording({ belowMinimumDuration: true }).catch(() => null);
            await vi.waitFor(() => expect(finishStop).toBeTypeOf('function'));
            controller.reset('account_switch');
            priv().capturedUserId = 'owner-b'; // the successor's Start
            finishStop();
            await stopping;

            expect(getUnsettledDiscardRecordForUser('owner-b')).toBeNull();
            expect(controller.rehydrateUnresolvedRecording('owner-b')).toBe(false);
            expect(completions('failed').map((call) => call[0])).toEqual(['test-sess']);
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId, 'recorded for its own owner').toBe('test-sess');
        });

        it('a failed Try again keeps the record; a rehydrate is refused while recording or over a held slot', async () => {
            priv().capturedUserId = OWNER;
            engine(3);
            failOnce();
            await controller.stopRecording({ belowMinimumDuration: true });
            controller.reset('account_switch');
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);
            failOnce();
            await expect(controller.retryRecordingSave()).resolves.toBe(false);
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId, 'still unsettled, so still recoverable').toBe('test-sess');

            controller.reset('account_switch');
            Object.assign(priv(), { state: 'RECORDING' });
            expect(controller.rehydrateUnresolvedRecording(OWNER), 'never over a live take').toBe(false);
            Object.assign(priv(), { state: 'READY', pendingAttributionRetry: { sessionId: 'other' } });
            expect(controller.rehydrateUnresolvedRecording(OWNER), 'never over a held slot').toBe(false);
            expect(controller.hasUnsettledDiscard()).toBe(false);
            Object.assign(priv(), { pendingAttributionRetry: null });
        });

        // Review on a95ca10: a sign-out remounts the page without a reload, so the departing owner's LIVE slot was never
        // retired and locked the next account. It is released when that owner's record keeps the row recoverable.
        it('the next account is not locked behind another owner\'s live slot, which stays recoverable for that owner', async () => {
            priv().capturedUserId = OWNER;
            engine(3);
            failOnce();
            await controller.stopRecording({ belowMinimumDuration: true });
            expect(controller.hasUnsettledDiscard()).toBe(true);

            controller.rehydrateUnresolvedRecording('owner-b');
            expect(controller.hasUnsettledDiscard()).toBe(false);
            expect(controller.isEngineSelectionLocked()).toBe(false);
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('test-sess');
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);

            // Without that owner's record the slot is the only way back, so it is kept.
            localStorage.clear();
            controller.rehydrateUnresolvedRecording('owner-b');
            expect(controller.hasUnsettledDiscard()).toBe(true);
        });
    });

});
