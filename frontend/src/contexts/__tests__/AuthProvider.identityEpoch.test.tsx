/**
 * #1259 RETURN — QUEUED ACQUISITION EVENTS AND THE AUTHENTICATION EPOCH THEY BELONG TO.
 *
 * The returned defect: on an ordinary boot `sessionState` is undefined while `loading` is still true,
 * and the identity effect read that as "signed out". It released every queued acquisition event
 * anonymously, and `getSession()` then resolved an authenticated user moments later. The queue exists
 * precisely so a returning user's cold and warm loads can be compared, and it was being emptied before
 * the answer arrived — so the events it was protecting were the exact ones it lost.
 *
 * These drive the REAL provider with a DEFERRED `getSession()`, the real telemetry queue and the real
 * analytics buffer, and assert what `posthog.capture` receives and when relative to `identify()`.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { AuthProvider } from '../AuthProvider';
import * as supabaseClient from '../../lib/supabaseClient';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import {
    __resetAcquisitionTelemetry, __pendingCount, __discardedCount, __settledIdentity,
    __queueForCurrentEpoch, recordAcquisitionStart,
} from '@/services/transcription/modelAcquisitionTelemetry';

/**
 * Put one event back in the queue WITHOUT clearing the settled epoch.
 *
 * A full module reset would wipe the very epoch under test, and after an account has settled an
 * ordinary emit goes straight out. This reproduces the one state that strands an event: a load in
 * flight when the account changes underneath it.
 */
const pendingUnderCurrentEpoch = () => __queueForCurrentEpoch();

vi.mock('../../lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../../utils/fetchWithRetry', () => ({ fetchWithRetry: vi.fn((fn: () => unknown) => fn()) }));
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(), identify: vi.fn(), reset: vi.fn(),
        get_distinct_id: vi.fn(() => 'anon'), __loaded: true,
    },
}));

const SUBJECT = {
    candidateId: 'v2:base.en', modelIdentity: 'Xenova/whisper-base.en@no-revision',
    assetPinDigest: 'digest', releaseId: 'rel-1', trigger: 'warmup' as const,
};

const captureCalls = () => (posthog.capture as unknown as Mock).mock.calls;
const identifyCalls = () => (posthog.identify as unknown as Mock).mock.calls;
const acquisitionCaptures = () => captureCalls().filter((c) => String(c[0]).startsWith('private_model_acquisition'));

/**
 * Whether the analytics buffer already carried an account identity at the moment the acquisition
 * queue was released. Recorded at `push`, which is the release boundary; the send that follows is
 * scheduled and tells us nothing about ordering.
 */
let identifiedAtRelease: boolean | null = null;

/** Empty the buffer through its real background-scheduled delivery path. */
async function drain() {
    for (let i = 0; i < 50 && analyticsBuffer.queue.length > 0; i += 1) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
}

let mockSupabase: { auth: { getSession: Mock; onAuthStateChange: Mock; signOut: Mock } };
const client = new QueryClient();
const renderProvider = () => render(
    <QueryClientProvider client={client}><AuthProvider><div /></AuthProvider></QueryClientProvider>,
);

beforeEach(() => {
    vi.clearAllMocks();
    __resetAcquisitionTelemetry();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    analyticsBuffer.resetIdentity();
    identifiedAtRelease = null;
    const realPush = analyticsBuffer.push.bind(analyticsBuffer);
    vi.spyOn(analyticsBuffer, 'push').mockImplementation(((name: string, ...rest: unknown[]) => {
        if (String(name).startsWith('private_model_acquisition') && identifiedAtRelease === null) {
            // `identify()` on the buffer reaches posthog.identify; a non-zero count at this instant
            // means the account was established before the queue was let go.
            identifiedAtRelease = (posthog.identify as unknown as Mock).mock.calls.length > 0;
        }
        return (realPush as (...a: unknown[]) => unknown)(name, ...rest);
    }) as typeof analyticsBuffer.push);
    mockSupabase = {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
            onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
            signOut: vi.fn().mockResolvedValue({ error: null }),
        },
    };
    (supabaseClient.getSupabaseClient as unknown as Mock).mockReturnValue(mockSupabase);
});

describe('#1259 a boot-time acquisition waits for the account it belongs to', () => {
    it('CASUALTY: a DEFERRED getSession does not release the queue anonymously', async () => {
        // getSession resolves only when the test says so, which is the real shape of a slow boot.
        let resolveSession: (v: unknown) => void = () => {};
        mockSupabase.auth.getSession.mockReturnValue(new Promise((r) => { resolveSession = r; }));

        renderProvider();
        // The model begins loading during page initialisation, before authentication has answered.
        recordAcquisitionStart(SUBJECT, 'miss');
        await drain();

        expect(__pendingCount(), 'the event must still be waiting').toBe(1);
        expect(acquisitionCaptures(), 'nothing may reach PostHog before identity settles').toHaveLength(0);

        await act(async () => {
            resolveSession({ data: { session: { user: { id: 'user-123' } } }, error: null });
        });
        await waitFor(() => expect(identifyCalls().length).toBeGreaterThan(0));
        await drain();

        expect(identifyCalls()[0][0]).toBe('user-123');
        const sent = acquisitionCaptures();
        expect(sent, 'exactly once, never zero and never twice').toHaveLength(1);

        // ORDER IS THE CLAIM, AND THE RELEASE IS WHERE IT IS DECIDED.
        //
        // Asserting that `capture` follows `identify` proves nothing: the buffer flushes on a background
        // task, so a queue released far too early still reaches PostHog after a synchronous identify. The
        // fact that matters is whether the account was known at the moment the queue was RELEASED —
        // recorded below at the push boundary, which is where the release actually happens.
        expect(identifiedAtRelease, 'the queue was released before the account was known').toBe(true);
    });

    it('CONTROL: a definitively signed-out visitor DOES release, so events are not stranded', async () => {
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
        renderProvider();
        recordAcquisitionStart(SUBJECT, 'miss');
        await waitFor(() => expect(__pendingCount()).toBe(0));
        await drain();
        expect(acquisitionCaptures(), 'a signed-out load is still a measurement').toHaveLength(1);
        expect(identifyCalls()).toHaveLength(0);
    });

    it("CASUALTY: a REMOUNT under account B does not release account A's queue", async () => {
        // The epoch used to live in a React ref, which a remount resets to null — so the provider read
        // a switched account as a first authentication and released whatever was waiting. The queue's
        // own epoch survives the remount, which is the point of moving it there.
        mockSupabase.auth.getSession.mockResolvedValue({
            data: { session: { user: { id: 'user-A' } } }, error: null,
        });
        const view = renderProvider();
        await waitFor(() => expect(__settledIdentity()).toBe('user-A'));
        await drain();
        vi.clearAllMocks();

        // A load begins and is still queued when the account changes under it.
        pendingUnderCurrentEpoch();
        expect(__pendingCount()).toBe(1);

        view.unmount();
        mockSupabase.auth.getSession.mockResolvedValue({
            data: { session: { user: { id: 'user-B' } } }, error: null,
        });
        renderProvider();
        await waitFor(() => expect(__settledIdentity()).toBe('user-B'));
        await drain();

        expect(identifyCalls()[0][0]).toBe('user-B');
        expect(acquisitionCaptures(), "A's event must not arrive attributed to B").toHaveLength(0);
        expect(__discardedCount(), 'and the loss is counted rather than silent').toBe(1);
    });

    it("CASUALTY: a transition DISCARDS the queue rather than re-attributing it", async () => {
        // Dropping the event loses a measurement. Keeping it loses the truth about whose it was, and a
        // wrong attribution is worse than a missing one because it looks like data.
        __resetAcquisitionTelemetry();
        recordAcquisitionStart(SUBJECT, 'miss');
        const { resetIdentitySettlement } = await import('@/services/transcription/modelAcquisitionTelemetry');
        resetIdentitySettlement();
        expect(__pendingCount()).toBe(0);
        expect(__discardedCount(), 'the loss is counted, not silent').toBe(1);
    });
});
