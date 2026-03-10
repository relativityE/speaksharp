import { renderHook, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useTranscriptionService } from '../useTranscriptionService';
import { E2E_DETERMINISTIC_NATIVE } from '../types';
import { TranscriptionProvider } from '../../../providers/TranscriptionProvider';
import { TranscriptionServiceOptions } from '../../../services/transcription/TranscriptionService';

// Hoist the mock to avoid ReferenceError
vi.mock('../../../services/transcription/TranscriptionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/transcription/TranscriptionService')>();

  const localMockService = {
    init: vi.fn().mockResolvedValue({ success: true }),
    startTranscription: vi.fn().mockImplementation(async () => {}),
    stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: '', stats: { transcript: '', total_words: 0, accuracy: 0, duration: 0 } }),
    destroy: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue('native'),
    getEngineType: vi.fn().mockReturnValue('native'),
    updateCallbacks: vi.fn().mockImplementation((cbs) => {
      (globalThis as Record<string, unknown>)._lastMockCallbacks = cbs;
    }),
    updatePolicy: vi.fn(),
    fsm: {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn().mockReturnValue('IDLE')
    },
    getState: vi.fn().mockReturnValue('IDLE')
  };

  (globalThis as Record<string, unknown>)._currentMockService = localMockService;

  return {
    ...actual,
    getTranscriptionService: vi.fn().mockReturnValue(localMockService),
  };
});

vi.mock('../../../lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  }
}));

describe('useTranscriptionService', () => {
  const mockOptions = {
    onTranscriptUpdate: vi.fn(),
    onModelLoadProgress: vi.fn(),
    onReady: vi.fn(),
    session: null,
    navigate: vi.fn(),
    getAssemblyAIToken: vi.fn().mockResolvedValue('token')
  };

  let activeMockService: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    activeMockService = (globalThis as Record<string, unknown>)._currentMockService as Record<string, unknown>;
  });

  // Common wrapper
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TranscriptionProvider>{children}</TranscriptionProvider>
  );

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isSupported).toBe(true);
    expect(result.current.mode).toBeNull();
  });

  it('should start listening successfully', async () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    expect(activeMockService.startTranscription).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
    expect(result.current.mode).toBe('native');
  });

  it('should stop listening successfully', async () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    // Start listening
    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });
    expect(result.current.isListening).toBe(true);

    // Stop listening
    await act(async () => {
      const response = await result.current.stopListening();
      expect(response).toEqual(expect.objectContaining({ success: true }));
    });

    expect(result.current.isListening).toBe(false);
  });

  it('should handle start listening errors', async () => {
    // Simulate failure
    (activeMockService.startTranscription as Mock).mockImplementationOnce(async () => {
      const cbs = (globalThis as Record<string, unknown>)._lastMockCallbacks as Partial<TranscriptionServiceOptions>;
      if (cbs && cbs.onError) {
        cbs.onError(new Error('Permission denied'));
      }
    });

    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toContain('Permission denied');
    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(true);
  });

});
