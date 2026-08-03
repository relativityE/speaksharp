import { renderHook } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { TranscriptionProvider } from '../../../providers/TranscriptionProvider';
import { useSpeechRecognition_prod as useSpeechRecognition } from '../index';
import { useTranscriptionState } from '../useTranscriptionState';
import { useFillerWords } from '../useFillerWords';


vi.mock('../useTranscriptionState');
vi.mock('../useFillerWords');
vi.mock('../../../providers/useTranscriptionContext');
// No module-level mock for useSessionStore to allow real store usage
vi.mock('../../../services/SpeechRuntimeController', () => ({
  speechRuntimeController: {
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    initializeInfrastructure: vi.fn().mockResolvedValue(undefined),
    warmUp: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue('READY'),
    setSubscriberCallbacks: vi.fn(),
    confirmSubscriberHandshake: vi.fn(),
    updatePolicy: vi.fn(),
  }
}));

vi.mock('../../useVocalAnalysis', () => ({
  useVocalAnalysis: vi.fn(() => ({
    pauseMetrics: { totalPauses: 0 },
    setIsActive: vi.fn(),
    processAudioFrame: vi.fn(),
    reset: vi.fn()
  }))
}));

vi.mock('../../useProfile', () => ({
  useProfile: vi.fn(() => ({ subscription_status: 'pro' }))
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), success: vi.fn() },
  Toaster: vi.fn(() => null)
}));

vi.mock('../../../contexts/AuthProvider', async () => {
  const actual = await vi.importActual('../../../contexts/AuthProvider') as object;
  return {
    ...actual,
    useAuthProvider: vi.fn(() => ({ session: { user: { id: 'mock-id' } } }))
  };
});

vi.mock('../../useProfile', () => ({
  useProfile: vi.fn(() => ({ subscription_status: 'free' }))
}));

vi.mock('../../useProfile', () => ({
  useProfile: vi.fn(() => ({ subscription_status: 'free' }))
}));

vi.mock('../../../utils/fillerWordUtils', () => ({
  calculateTranscriptStats: vi.fn(() => ({
    transcript: 'test transcript',
    total_words: 2,
    accuracy: 0.9,
    duration: 30
  }))
}));


function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TranscriptionProvider>
      {children}
    </TranscriptionProvider>
  );
}
import { useTranscriptionContext } from '../../../providers/useTranscriptionContext';

// ============================================================================
// #1120 S1 (accepted item 2) — TOKEN RECONNECT falsification.
// The Cloud token callback (getAssemblyAIToken) is passed into useTranscriptionCallbacks and memoized with [],
// so an already-constructed Cloud engine can invoke it again on connect/reconnect. This proves that once the
// canonical client gate flips OFF, invoking that captured callback denies at invocation time with ZERO
// downstream activity: no rate-limit read, no Supabase client, no Edge invoke, no provider/token/network call.
// ============================================================================
const cbHarness = vi.hoisted(() => ({ getToken: null as null | (() => Promise<string | null>) }));
vi.mock('../useTranscriptionCallbacks', () => ({
  // Capture the REAL callback the hook builds; do not wire the controller (not under test here).
  useTranscriptionCallbacks: (args: { getAssemblyAIToken: () => Promise<string | null> }) => {
    cbHarness.getToken = args.getAssemblyAIToken;
  },
}));

const gate = vi.hoisted(() => ({ cloud: true }));
vi.mock('@/config/sttHierarchyFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/sttHierarchyFlags')>();
  return { ...actual, isCloudSttEnabled: () => gate.cloud, isCloudSttGloballyVisible: () => gate.cloud };
});

const invokeSpy = vi.hoisted(() => vi.fn(async () => ({ data: { token: 'should-never-be-returned' }, error: null })));
const getSupabaseClientSpy = vi.hoisted(() => vi.fn(() => ({ functions: { invoke: invokeSpy } })));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: getSupabaseClientSpy }));

const checkRateLimitSpy = vi.hoisted(() => vi.fn(() => ({ allowed: true })));
vi.mock('@/lib/rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rateLimiter')>();
  return { ...actual, checkRateLimit: checkRateLimitSpy };
});

import { useProfile as useProfileForToken } from '../../useProfile';

const fetchSpy = vi.hoisted(() => vi.fn(async () => new Response('{}')));

describe('#1120 S1 — Cloud token reconnect denial after the gate flips OFF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cbHarness.getToken = null;
    gate.cloud = true; // constructed while Cloud is allowed
    // An entitled Pro user, so the token path is genuinely reachable at construction time.
    vi.mocked(useProfileForToken).mockReturnValue({
      profile: { id: 'pro-user', subscription_status: 'pro', stripe_subscription_id: 'sub_test_x' },
      isVerified: true,
    } as unknown as ReturnType<typeof useProfileForToken>);
    vi.mocked(useTranscriptionState).mockReturnValue({
      finalChunks: [], interimTranscript: '', transcript: '', transcriptText: '',
      addChunk: vi.fn(), setInterimTranscript: vi.fn(), reset: vi.fn(),
      state: 'IDLE', error: null, isRecording: false, isInitializing: false, setError: vi.fn(),
    } as unknown as ReturnType<typeof useTranscriptionState>);
    vi.mocked(useFillerWords).mockReturnValue({ counts: { total: { count: 0, color: '' } }, totalCount: 0 });
    vi.mocked(useTranscriptionContext).mockReturnValue({
      isReady: true, error: null, status: { type: 'idle', message: '' },
    } as unknown as ReturnType<typeof useTranscriptionContext>);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('an already-constructed Cloud engine cannot mint a token once the gate is OFF — zero rate-limit/Supabase/Edge/token/network', async () => {
    renderHook(() => useSpeechRecognition(), { wrapper });
    // The hook built and handed us its real token callback.
    expect(cbHarness.getToken).toBeInstanceOf(Function);

    // Isolate the callback's OWN downstream effect: zero the counters after construction so we measure only
    // what the reconnect invocation does (other hooks may touch the shared rate limiter during render).
    checkRateLimitSpy.mockClear();
    getSupabaseClientSpy.mockClear();
    invokeSpy.mockClear();
    fetchSpy.mockClear();

    // Config change: Cloud is turned OFF after construction. The engine still holds the memoized callback.
    gate.cloud = false;

    const token = await cbHarness.getToken!();

    // Denied at invocation, before ANY downstream work.
    expect(token).toBeNull();
    expect(checkRateLimitSpy).not.toHaveBeenCalled();   // no rate-limit read
    expect(getSupabaseClientSpy).not.toHaveBeenCalled(); // no Supabase client
    expect(invokeSpy).not.toHaveBeenCalled();            // no Edge invoke / token request
    expect(fetchSpy).not.toHaveBeenCalled();             // no provider/network call
  });

  it('control: with the gate ON the same captured callback DOES reach the Edge invoke (proves the deny is the gate, not a broken path)', async () => {
    renderHook(() => useSpeechRecognition(), { wrapper });
    expect(cbHarness.getToken).toBeInstanceOf(Function);

    checkRateLimitSpy.mockClear();
    getSupabaseClientSpy.mockClear();
    invokeSpy.mockClear();
    fetchSpy.mockClear();

    gate.cloud = true; // still allowed
    const token = await cbHarness.getToken!();

    expect(checkRateLimitSpy).toHaveBeenCalledTimes(1);
    expect(getSupabaseClientSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(token).toBe('should-never-be-returned'); // the mocked Edge token flows through when allowed
  });
});
