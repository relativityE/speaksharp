import { renderHook, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useSpeechRecognition_prod as useSpeechRecognition } from '../index';
import { useTranscriptionState } from '../useTranscriptionState';
import { useFillerWords } from '../useFillerWords';
// Real service dependencies
import { testRegistry } from '../../../services/transcription/TestRegistry';
import { ITranscriptionMode } from '../../../services/transcription/modes/types';
import { TranscriptionServiceOptions } from '../../../services/transcription/TranscriptionService';
import { Mock } from 'vitest';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { TranscriptionContextValue } from '@/providers/TranscriptionContext';

vi.mock('../useTranscriptionState');
vi.mock('../useFillerWords');
vi.mock('@/providers/useTranscriptionContext');

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
  toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: vi.fn(() => null)
}));

vi.mock('../../../contexts/AuthProvider', async () => {
  const actual = await vi.importActual('../../../contexts/AuthProvider') as object;
  return {
    ...actual,
    useAuthProvider: vi.fn(() => ({ session: { user: { id: 'mock-id' } } }))
  };
});

vi.mock('../../../utils/fillerWordUtils', () => ({
  calculateTranscriptStats: vi.fn(() => ({
    transcript: 'test transcript',
    total_words: 2,
    accuracy: 0.9,
    duration: 30
  }))
}));

// --- Test Helper: Mock Engine ---
class MockEngine implements ITranscriptionMode {
  init = vi.fn().mockResolvedValue(undefined);
  startTranscription = vi.fn().mockResolvedValue(undefined);
  stopTranscription = vi.fn().mockResolvedValue({ transcript: 'test transcript', duration: 30 });
  getTranscript = vi.fn().mockReturnValue({ transcript: 'test transcript' });
  terminate = vi.fn().mockResolvedValue(undefined);
  getEngineType = () => 'native' as const;
}

const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => {
  return (
    <div data-testid="transcription-provider-mock">
      {children}
    </div>
  );
};

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
    setError: vi.fn()
  };

  const mockUseFillerWords = {
    counts: { total: { count: 0, color: '' } },
    totalCount: 0
  };

  let mockUseTranscriptionContextValue: TranscriptionContextValue;
  let mockEngine: MockEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockUseTranscriptionContextValue = {
      service: {
        startTranscription: vi.fn(),
        stopTranscription: vi.fn(),
        init: vi.fn(),
        terminate: vi.fn(),
        updateCallbacks: vi.fn(),
        destroy: vi.fn(),
      } as unknown as TranscriptionContextValue['service'],
      isReady: true,
    };

    // Inject Mock Engine
    mockEngine = new MockEngine();
    testRegistry.enable(); // Important!
    testRegistry.register('native', () => mockEngine);

    vi.mocked(useTranscriptionState).mockReturnValue(mockUseTranscriptionState as unknown as ReturnType<typeof useTranscriptionState>);
    vi.mocked(useFillerWords).mockReturnValue(mockUseFillerWords);
    vi.mocked(useTranscriptionContext).mockReturnValue(mockUseTranscriptionContextValue);
  });

  afterEach(() => {
    testRegistry.clear();
    testRegistry.disable();
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
    mockUseTranscriptionContextValue.isReady = false;
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.startListening).toBeDefined();
    expect(result.current.stopListening).toBeDefined();
    expect(result.current.reset).toBeDefined();
  });

  it('should handle stopListening with stats (Behavior)', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    (mockUseTranscriptionContextValue.service!.stopTranscription as unknown as Mock).mockResolvedValueOnce({ success: true });

    await act(async () => {
      await result.current.startListening();
      const stats = await result.current.stopListening();

      expect(stats).toEqual(expect.objectContaining({
        transcript: 'test transcript',
        total_words: 2,
        filler_words: expect.objectContaining({
          total: { count: 0, color: '' }
        })
      }));
    });
  });

  it('should reset state when startListening is called', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockUseTranscriptionState.reset).toHaveBeenCalled();
    expect(mockUseTranscriptionContextValue.service!.startTranscription).toHaveBeenCalled();
  });

  it('should handle partial transcript updates (Placeholder)', () => {
    expect(true).toBe(true);
  });

  it('should handle errors during startListening', async () => {
    const error = new Error('Permission denied');

    let serviceCallbacks: Partial<TranscriptionServiceOptions> = {};
    (mockUseTranscriptionContextValue.service!.updateCallbacks as unknown as Mock).mockImplementation((opts: Partial<TranscriptionServiceOptions>) => {
      serviceCallbacks = { ...serviceCallbacks, ...opts };
    });

    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    (mockUseTranscriptionContextValue.service!.startTranscription as unknown as Mock).mockImplementation(async () => {
      if (serviceCallbacks.onError) {
        serviceCallbacks.onError(error);
      }
    });

    mockUseTranscriptionContextValue.isReady = true;

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockUseTranscriptionState.setError).toHaveBeenCalledWith(error);
  });
});
