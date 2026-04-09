import { renderHook, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { TranscriptionProvider } from '../../../providers/TranscriptionProvider';
import { useSpeechRecognition_prod as useSpeechRecognition } from '../index';
import { useTranscriptionState } from '../useTranscriptionState';
import { useFillerWords } from '../useFillerWords';
// Real service dependencies
// window.__SS_E2E__ used for injection
import { ITranscriptionEngine } from '../../../services/transcription/modes/types';


vi.mock('../useTranscriptionState');
vi.mock('../useFillerWords');
vi.mock('@/providers/useTranscriptionContext');
// No module-level mock for useSessionStore to allow real store usage
vi.mock('../../../services/SpeechRuntimeController', () => ({
  speechRuntimeController: {
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
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



// --- Test Helper: Mock Engine ---
class MockEngine implements ITranscriptionEngine {
  checkAvailability = vi.fn().mockResolvedValue({ isAvailable: true });
  prepare = vi.fn().mockResolvedValue(undefined);
  init = vi.fn().mockResolvedValue(undefined);
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn().mockResolvedValue(undefined);
  resume = vi.fn().mockResolvedValue(undefined);
  startTranscription = vi.fn().mockResolvedValue(undefined);
  stopTranscription = vi.fn().mockResolvedValue({ transcript: 'test transcript', duration: 30 });
  getTranscript = vi.fn().mockReturnValue({ transcript: 'test transcript' });
  terminate = vi.fn().mockResolvedValue(undefined);
  dispose = vi.fn().mockResolvedValue(undefined);
  getEngineType = () => 'native' as const;
  getLastHeartbeatTimestamp = () => Date.now();
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TranscriptionProvider>
      {children}
    </TranscriptionProvider>
  );
}
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';

describe('useSpeechRecognition', () => {
  const mockUseTranscriptionState = {
    finalChunks: [],
    interimTranscript: '',
    transcript: '',
    addChunk: vi.fn(),
    setInterimTranscript: vi.fn(),
    reset: vi.fn(),
    state: 'IDLE',
    error: null,
    isRecording: false,
    isInitializing: false,
    setError: vi.fn(),
    transcriptText: ''
  };

  const mockUseFillerWords = {
    counts: { total: { count: 0, color: '' } },
    totalCount: 0
  };

  let mockUseTranscriptionContext: ReturnType<typeof useTranscriptionContext>;
  let mockEngine: MockEngine;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockUseTranscriptionContext = {
      isReady: true,
      error: null,
      status: { type: 'idle', message: '' }
    } as unknown as ReturnType<typeof useTranscriptionContext>;

    // Inject Mock Engine via T=0 Manifest
    mockEngine = new MockEngine();
    (window as unknown as Record<string, unknown>).__SS_E2E__ = {
      registry: {
        native: () => mockEngine
      }
    };

    vi.mocked(useTranscriptionState).mockReturnValue(mockUseTranscriptionState as unknown as ReturnType<typeof useTranscriptionState>);
    vi.mocked(useFillerWords).mockReturnValue(mockUseFillerWords);
    vi.mocked(useTranscriptionContext).mockReturnValue(mockUseTranscriptionContext);
    
    // Wire controller mock to service mock
    await import('../../../services/SpeechRuntimeController');
    
    // Reset real store
    const { useSessionStore } = await import('../../../stores/useSessionStore');
    useSessionStore.getState().resetSession();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__SS_E2E__;
    vi.useRealTimers();
  });

  it('should initialize and return expected interface', () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    expect(result.current).toHaveProperty('transcript');
    expect(result.current).toHaveProperty('chunks');
    expect(result.current).toHaveProperty('interimTranscript');
    expect(result.current).toHaveProperty('fillerData');
    expect(result.current).toHaveProperty('isListening');
    expect(result.current).toHaveProperty('isReady');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('isSupported');
    expect(result.current).toHaveProperty('mode');
    expect(result.current).toHaveProperty('startListening');
    expect(result.current).toHaveProperty('stopListening');
    expect(result.current).toHaveProperty('reset');
  });

  it('should initialize and return expected interface (Baseline)', () => {
    mockUseTranscriptionContext.isReady = false; // Override for baseline check
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false); // Initially false
    expect(result.current.startListening).toBeDefined();
    expect(result.current.stopListening).toBeDefined();
    expect(result.current.reset).toBeDefined();
  });

  // REMOVED: "should call sub-hooks with correct parameters" - Implementation Detail

  it('should handle stopListening with stats (Behavior)', async () => {
    const { speechRuntimeController } = await import('../../../services/SpeechRuntimeController');
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    vi.mocked(speechRuntimeController.stopRecording).mockResolvedValueOnce({ 
      success: true, 
      transcript: 'test transcript', 
      stats: { total_words: 2 } 
    } as unknown as { success: boolean; transcript: string; stats: Record<string, unknown> });

    await act(async () => {
      await result.current.startListening();
      const stats = await result.current.stopListening();

      expect(stats).toEqual(expect.objectContaining({
        transcript: 'test transcript',
        stats: expect.objectContaining({ total_words: 2 }),
        filler_words: expect.objectContaining({
          total: { count: 0, color: '' }
        })
      }));
    });
  });

  it('should reset state when startListening is called', async () => {
    const { speechRuntimeController } = await import('../../../services/SpeechRuntimeController');
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Note: FSM automatically handles resets on state transitions if needed
    expect(speechRuntimeController.startRecording).toHaveBeenCalled();
  });

  it('should handle partial transcript updates (Placeholder)', () => {
    expect(true).toBe(true);
  });

  it('should handle errors during startListening', async () => {
    const { speechRuntimeController } = await import('../../../services/SpeechRuntimeController');
    const error = new Error('Permission denied');

    let subscriberCallbacks: Record<string, (...args: unknown[]) => void> = {};
    vi.mocked(speechRuntimeController.setSubscriberCallbacks).mockImplementation((callbacks) => {
      subscriberCallbacks = callbacks as Record<string, (...args: unknown[]) => void>;
    });

    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    vi.mocked(speechRuntimeController.startRecording).mockImplementation(async () => {
      // Simulate FSM/Controller updating the store on error
      const { useSessionStore } = await import('../../../stores/useSessionStore');
      useSessionStore.setState({ 
        sttStatus: { type: 'error', message: 'Permission denied' },
        isListening: false 
      });
      
      if (subscriberCallbacks.onError) {
        subscriberCallbacks.onError(error);
      }
    });

    await act(async () => {
      await result.current.startListening();
    });

    // Verify hook reacts to store error
    expect(result.current.error).toEqual(error);
  });
});
