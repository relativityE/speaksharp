// @vitest-environment jsdom
/**
 * G5 / #1880 — the Short Stop recovery cases #1880 left open for release review (Sam, 17 Nov):
 *   1. sign-out while a discard is unsettled,
 *   2. the same owner on another device,
 *   3. Try again after the record's 24 h bound,
 *   4. the page is left while the discard's `failed` mark is still in flight.
 *
 * Each drives the REAL controller (engine and storage mocked) to the state #1880 calls "unsettled discard": the user
 * stopped a take under five seconds, the `failed` mark was not confirmed, so the row and its lease save obligation stay
 * open and Try again is the only client path that settles them.
 *
 * Case 4 is fixed in the recovery successor to #1880: the record is now written before the mark is sent, so its test
 * asserts the rule (it failed before the fix). Cases 1 to 3 are REPRODUCTIONS, not fixes: each asserts what the
 * product does TODAY (marked GAP), because closing them needs a product decision (a server-side source for "this owner
 * has an unsettled discard", or keeping the record through sign-out's storage clear). A fix flips the marked
 * assertion, and the test must then be rewritten to the new rule, not deleted.
 *
 * Settled elsewhere (mapped, not repeated here): an expired, unpaid owner who deletes the account has every unsettled
 * obligation moved to `discarded_not_saved` by `discard_unsaved_recordings_for_closure_v1` (#1863), proven in
 * tests/db/payment-wall-guards-1863.integration.test.ts ("an expired user finishes deletion"). So none of these three
 * cases blocks deletion any more; what stays open is the user's Try again and the row's own state.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession } from '../../lib/storage';
import { getUnsettledDiscardRecordForUser, UNSETTLED_DISCARD_MAX_AGE_MS } from '../unsettledDiscardRecord';
import { AuthProvider, useAuthProvider } from '../../contexts/AuthProvider';
import { currentOwnerId, setCurrentLogin } from '@/services/loginSessionLog';

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'row-1' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/services/telemetry/fillerMeasurement', () => ({ emitFillerMeasurement: vi.fn() }));
vi.mock('../../utils/fetchWithRetry', () => ({ fetchWithRetry: vi.fn((fn: () => unknown) => fn()) }));
vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anon'), __loaded: true },
}));

const OWNER = 'owner-a';
const SESSION = { access_token: 't', user: { id: OWNER, email: 'a@example.com' } };
let emitAuth: (event: string, session: unknown) => void = () => undefined;
const supabaseSignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
            onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
                emitAuth = cb;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
            signOut: (...args: unknown[]) => supabaseSignOut(...args),
        },
        from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) })),
    })),
}));

// Synthetic words, so the no-speech guard does not apply and the take reaches the short-Stop discard.
const WORDS = 'So um I want to make three points about the rollout plan';

type Priv = {
    state: string; initialized: boolean; isEngineReady: boolean; isEmissionsSafe: boolean; sessionId: string | null; service: unknown;
    pendingDiscardSettlement: unknown; recordingStartedUnresolved: boolean; capturedUserId?: string | null; rehydratedFor?: string | null;
    pendingAttributionRetry?: unknown; pendingFullSaveRetry?: unknown;
};

describe('#1880 open Short Stop recovery cases (offline reproductions)', () => {
    let controller: SpeechRuntimeController;
    const priv = () => controller as unknown as Priv;
    const failedMarks = () => vi.mocked(completeSession).mock.calls.filter((call) => call[1]?.status === 'failed').map((call) => call[0]);

    /** A 3 s take with words, stopped with the page's too-short verdict, whose `failed` mark the server did not confirm. */
    const unsettledShortTake = async () => {
        Object.assign(priv(), { state: 'RECORDING', sessionId: 'row-1', capturedUserId: OWNER });
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript(WORDS, '');
        priv().service = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 3_000),
            stopTranscription: vi.fn(async () => ({ transcript: '', stats: { accuracy: 0.95, total_words: 11, filler_words: {} } })),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        } as unknown as ITranscriptionService;
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await controller.stopRecording({ belowMinimumDuration: true });
        // Precondition, identical for every case: unsettled, recorded for its owner, Try again armed, Start refused.
        expect(controller.pendingResolutionKind()).toBe('discard');
        expect(controller.isEngineSelectionLocked()).toBe(true);
        expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('row-1');
    };

    /** What a reload or a fresh page does to the controller: the memory-only slot is gone. */
    const reloadPage = () => {
        controller.reset('account_switch');
        expect(controller.hasUnsettledDiscard()).toBe(false);
    };

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        setCurrentLogin(null, null);
        controller = SpeechRuntimeController.getInstance();
        controller.reset('account_switch');
        Object.assign(priv(), {
            initialized: true, isEngineReady: true, isEmissionsSafe: true, pendingDiscardSettlement: null,
            recordingStartedUnresolved: false, rehydratedFor: null, pendingAttributionRetry: null, pendingFullSaveRetry: null,
        });
        useSessionStore.getState().resetSession();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
        priv().service = null;
    });

    it('control: a plain reload keeps the record, and the owner\'s return re-arms Try again for the same row', async () => {
        await unsettledShortTake();
        reloadPage();

        expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);
        expect(controller.pendingResolutionKind()).toBe('discard');
        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(failedMarks(), 'the same row, settled by Try again').toEqual(['row-1', 'row-1']);
    });

    describe('case 4: the page is left while the discard\'s `failed` mark is still in flight', () => {
        /** A 3 s take stopped too short, whose `failed` mark is sent and has not answered when the page goes away. */
        const shortTakeWithMarkInFlight = async () => {
            Object.assign(priv(), { state: 'RECORDING', sessionId: 'row-1', capturedUserId: OWNER });
            useSessionStore.getState().setRuntimeState('RECORDING');
            useSessionStore.getState().updateTranscript(WORDS, '');
            priv().service = {
                getMode: vi.fn().mockReturnValue('private'),
                getStartTime: vi.fn().mockReturnValue(Date.now() - 3_000),
                stopTranscription: vi.fn(async () => ({ transcript: '', stats: { accuracy: 0.95, total_words: 11, filler_words: {} } })),
                destroy: vi.fn().mockResolvedValue(undefined),
                isServiceDestroyed: () => false,
                getState: vi.fn().mockReturnValue('RECORDING'),
                subscribe: vi.fn(() => vi.fn()),
                fsm: { is: vi.fn().mockReturnValue(false) },
            } as unknown as ITranscriptionService;
            // The mark never answers on this page: a closed tab, a hard navigation or a reload kills it in flight.
            vi.mocked(completeSession).mockImplementationOnce(() => new Promise(() => undefined));
            void controller.stopRecording({ belowMinimumDuration: true });
            await waitFor(() => expect(failedMarks()).toEqual(['row-1']));
        };

        it('the owner\'s return re-arms Try again for the same row, and the replayed mark settles it', async () => {
            await shortTakeWithMarkInFlight();
            reloadPage(); // the page is gone before the mark answered

            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId, 'the unsettled row is recorded before the mark is sent').toBe('row-1');
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);
            expect(controller.pendingResolutionKind()).toBe('discard');
            // complete_session_v2 is idempotent: if the lost mark did land, this replay is a no-op success.
            await expect(controller.retryRecordingSave()).resolves.toBe(true);
            expect(failedMarks(), 'the same row, settled by Try again').toEqual(['row-1', 'row-1']);
            expect(getUnsettledDiscardRecordForUser(OWNER)).toBeNull();
        });

        it('control: a confirmed mark leaves no record, so nothing re-arms after a reload', async () => {
            Object.assign(priv(), { state: 'RECORDING', sessionId: 'row-1', capturedUserId: OWNER });
            useSessionStore.getState().setRuntimeState('RECORDING');
            useSessionStore.getState().updateTranscript(WORDS, '');
            priv().service = {
                getMode: vi.fn().mockReturnValue('private'),
                getStartTime: vi.fn().mockReturnValue(Date.now() - 3_000),
                stopTranscription: vi.fn(async () => ({ transcript: '', stats: { accuracy: 0.95, total_words: 11, filler_words: {} } })),
                destroy: vi.fn().mockResolvedValue(undefined),
                isServiceDestroyed: () => false,
                getState: vi.fn().mockReturnValue('RECORDING'),
                subscribe: vi.fn(() => vi.fn()),
                fsm: { is: vi.fn().mockReturnValue(false) },
            } as unknown as ITranscriptionService;
            await controller.stopRecording({ belowMinimumDuration: true });

            expect(failedMarks()).toEqual(['row-1']);
            expect(controller.pendingResolutionKind()).toBeNull();
            expect(getUnsettledDiscardRecordForUser(OWNER), 'settled: no durable record').toBeNull();
            reloadPage();
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(false);
            expect(controller.isEngineSelectionLocked()).toBe(false);
        });
    });

    describe('case 1: sign-out while the discard is unsettled', () => {
        let signOut: () => Promise<void> = async () => undefined;
        const Grab: React.FC = () => { signOut = useAuthProvider().signOut; return null; };

        it('GAP: the real sign-out clears the record, so after a reload the owner gets no Try again and Start opens', async () => {
            render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
            act(() => emitAuth('SIGNED_IN', SESSION));
            await waitFor(() => expect(currentOwnerId()).toBe(OWNER));
            await unsettledShortTake();

            await act(async () => { await signOut(); });
            // AuthProvider.signOut clears all site storage (window.localStorage.clear()).
            expect(getUnsettledDiscardRecordForUser(OWNER), 'GAP: the only durable trace of the unsettled row is gone').toBeNull();

            reloadPage(); // sign back in after a reload or a closed tab
            expect(controller.rehydrateUnresolvedRecording(OWNER), 'GAP: nothing to re-arm for the same owner').toBe(false);
            expect(controller.pendingResolutionKind()).toBeNull();
            expect(controller.isEngineSelectionLocked(), 'Start is open again').toBe(false);
            expect(failedMarks(), 'the row was never marked failed: its save obligation is still open').toEqual(['row-1']);
        });

        it('same page, no reload: the live slot still offers Try again to the same owner after sign-out and sign-in', async () => {
            render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
            act(() => emitAuth('SIGNED_IN', SESSION));
            await waitFor(() => expect(currentOwnerId()).toBe(OWNER));
            await unsettledShortTake();

            await act(async () => { await signOut(); });
            act(() => emitAuth('SIGNED_IN', SESSION));
            await waitFor(() => expect(currentOwnerId()).toBe(OWNER));

            // The in-memory slot survives a sign-out without a reload, so this narrower path is recoverable.
            expect(controller.pendingResolutionKind()).toBe('discard');
            await expect(controller.retryRecordingSave()).resolves.toBe(true);
            expect(failedMarks()).toEqual(['row-1', 'row-1']);
        });
    });

    describe('case 2: the same owner on another device', () => {
        it('GAP: a device with no record never learns of the row; no Try again, Start open, the obligation stays open', async () => {
            await unsettledShortTake();
            // Device B: its own storage (the record lives only on device A) and its own fresh controller state.
            const deviceA = localStorage.getItem('speaksharp_unsettled_discard');
            localStorage.clear();
            reloadPage();

            expect(controller.rehydrateUnresolvedRecording(OWNER), 'GAP: device B has nothing to re-arm').toBe(false);
            expect(controller.pendingResolutionKind()).toBeNull();
            expect(controller.isEngineSelectionLocked()).toBe(false);
            expect(failedMarks(), 'nothing settles the row from device B').toEqual(['row-1']);

            // Device A still holds it: when the owner returns there, Try again works.
            localStorage.setItem('speaksharp_unsettled_discard', deviceA ?? '');
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);
            await expect(controller.retryRecordingSave()).resolves.toBe(true);
            expect(failedMarks()).toEqual(['row-1', 'row-1']);
        });
    });

    describe('case 3: Try again after the record\'s 24 h bound', () => {
        it('GAP: one millisecond past the bound the owner gets no Try again and Start opens, with the row still unsettled', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
            await unsettledShortTake();
            reloadPage();

            vi.setSystemTime(new Date(Date.parse('2026-11-17T12:00:00Z') + UNSETTLED_DISCARD_MAX_AGE_MS));
            expect(controller.rehydrateUnresolvedRecording(OWNER), 'inside the bound: re-armed').toBe(true);
            reloadPage();

            vi.setSystemTime(new Date(Date.parse('2026-11-17T12:00:00Z') + UNSETTLED_DISCARD_MAX_AGE_MS + 1));
            expect(controller.rehydrateUnresolvedRecording(OWNER), 'GAP: past the bound, nothing re-arms').toBe(false);
            expect(controller.pendingResolutionKind()).toBeNull();
            expect(controller.isEngineSelectionLocked(), 'Start opens, by design of the bound').toBe(false);
            expect(failedMarks(), 'the row was never settled').toEqual(['row-1']);
        });

        it('a Try again the server keeps refusing (e.g. trial_expired on the failed mark) keeps Start refused inside the bound', async () => {
            await unsettledShortTake();
            reloadPage();
            expect(controller.rehydrateUnresolvedRecording(OWNER)).toBe(true);

            vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
            await expect(controller.retryRecordingSave()).resolves.toBe(false);
            expect(controller.pendingResolutionKind(), 'still unsettled').toBe('discard');
            expect(controller.isEngineSelectionLocked(), 'Start stays refused until it settles or the bound passes').toBe(true);
            expect(getUnsettledDiscardRecordForUser(OWNER)?.sessionId).toBe('row-1');
        });
    });
});
