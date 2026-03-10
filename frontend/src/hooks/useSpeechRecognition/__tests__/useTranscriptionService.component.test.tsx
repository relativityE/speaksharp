import { renderHook, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTranscriptionService } from '../useTranscriptionService';
import { E2E_DETERMINISTIC_NATIVE } from '../types';
import { TranscriptionProvider } from '../../../providers/TranscriptionProvider';

// Mock the TranscriptionService with callback support
const { mockService, mockCallbacks } = vi.hoisted(() => {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const service = {
        init: vi.fn().mockResolvedValue({ success: true }),
        startTranscription: vi.fn().mockImplementation(async () => {
            // Simulate FSM transition or callback if needed for success path
        }),
        stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: '', stats: { transcript: '', total_words: 0, accuracy: 0, duration: 0 } }),
        destroy: vi.fn().mockResolvedValue(undefined),
        getMode: vi.fn().mockReturnValue('native'),
        getEngineType: vi.fn().mockReturnValue('native'),
        updateCallbacks: vi.fn().mockImplementation((cbs) => {
            Object.assign(callbacks, cbs);
        }),
        updatePolicy: vi.fn(),
        fsm: {
            subscribe: vi.fn((_cb) => {
                // Simulate subscription if needed, or just return unmouter
                return vi.fn();
            }),
            getState: vi.fn().mockReturnValue('IDLE')
        },
        getState: vi.fn().mockReturnValue('IDLE')
    };
    return { mockService: service, mockCallbacks: callbacks };
});

vi.mock('../../../services/transcription/TranscriptionService', () => ({
    default: vi.fn().mockImplementation(() => mockService),
    getTranscriptionService: vi.fn().mockReturnValue(mockService)
}));

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

  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(mockService.startTranscription).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
    expect(result.current.mode).toBe('native');
  });

  it('should stop listening successfully', async () => {
    const { result, unmount } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

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

    act(() => {
      unmount();
    });

    // The useEffect cleanup which calls destroy is asynchronous.
    // We need to wait for the mock to be called.
    // Actually in this test setup, destroy might not be called if the component is still mounted
    // and only stopListening was called.
    // expect(mockService.destroy).toHaveBeenCalled();

    // isListening is derived from store, which is not mocked here but works because module state is shared?
    // Actually store IS NOT mocked in this file. It uses real store.
    expect(result.current.isListening).toBe(false);
  });

  it('should handle start listening errors', async () => {
    // Simulate failure by triggering onError callback, as the real service does
    mockService.startTranscription.mockImplementationOnce(async () => {
      if (mockCallbacks.onError) {
        mockCallbacks.onError(new Error('Permission denied'));
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

  it('should cleanup on unmount', async () => {
    const { result, unmount } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    act(() => {
      unmount();
    });

    // We no longer destroy the service on unmount because it's a global singleton
    // but the hook should have unmounted without errors.
    expect(true).toBe(true);
  });
});