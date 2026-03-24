import { renderHook, act, waitFor } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useTranscriptionService } from '../useTranscriptionService';
import { E2E_DETERMINISTIC_NATIVE } from '../types';
import { TranscriptionProvider } from '../../../providers/TranscriptionProvider';
import { speechRuntimeController } from '../../../services/SpeechRuntimeController';
import { testRegistry } from '../../../services/transcription/TestRegistry';
import { ITranscriptionEngine } from '../../../services/transcription/modes/types';
import { useSessionStore } from '../../../stores/useSessionStore';

// --- Mock Engine ---
class MockEngine implements ITranscriptionEngine {
  init = vi.fn().mockResolvedValue({ success: true });
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn().mockResolvedValue(undefined);
  startTranscription = vi.fn().mockResolvedValue(undefined);
  stopTranscription = vi.fn().mockResolvedValue({ transcript: 'mock transcript', duration: 10 });
  getTranscript = vi.fn().mockReturnValue({ transcript: 'mock transcript' });
  terminate = vi.fn().mockResolvedValue(undefined);
  dispose = vi.fn().mockResolvedValue(undefined);
  getEngineType = () => 'native' as const;
  getMode = () => 'native' as const;
  getLastHeartbeatTimestamp = () => Date.now();
  setSessionId = vi.fn();
}

describe('useTranscriptionService (Contract Verification)', () => {
  let mockEngine: MockEngine;

  const mockOptions = {
    onTranscriptUpdate: vi.fn(),
    onModelLoadProgress: vi.fn(),
    onReady: vi.fn(),
    session: null,
    navigate: vi.fn(),
    getAssemblyAIToken: vi.fn().mockResolvedValue('token')
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TranscriptionProvider>{children}</TranscriptionProvider>
  );

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEngine = new MockEngine();
    testRegistry.register('native', () => mockEngine);
    
    // Reset real store and controller
    useSessionStore.getState().resetSession();
    await speechRuntimeController.reset();
  });

  afterEach(async () => {
    testRegistry.clear();
    await speechRuntimeController.reset();
  });

  it('should initialize with correct default state (Contract 1: Initialization)', () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });
    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(true);
    // Anti-Cheat: Ensure no service access
    expect((result.current as unknown as { service: unknown }).service).toBeUndefined();
  });

  it('should transition through FSM states during start (Contract 2: Command Flow)', async () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    // 1. Warm up
    await act(async () => {
        await speechRuntimeController.warmUp();
    });

    // 2. Start Recording
    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    // Wait for the store to reflect the transition
    await waitFor(() => {
      expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
      expect(useSessionStore.getState().isListening).toBe(true);
      expect(result.current.isListening).toBe(true);
    }, { timeout: 2000 });

    expect(mockEngine.startTranscription).toHaveBeenCalled();
  });

  it('should cleanup correctly on stop (Contract 2: Stop Flow)', async () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });

    await act(async () => {
      await speechRuntimeController.warmUp();
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });
    expect(result.current.isListening).toBe(true);

    await act(async () => {
      await result.current.stopListening();
    });

    expect(useSessionStore.getState().isListening).toBe(false);
    expect(useSessionStore.getState().runtimeState).toBe('READY');
  });

  it('should cleanup correctly on unmount (Contract 4: Lifecycle State-Based Proof)', async () => {
    // 1. Render and start recording
    const { result, unmount } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });
    
    await act(async () => {
      await speechRuntimeController.warmUp();
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });
    expect(useSessionStore.getState().runtimeState).toBe('RECORDING');

    // 2. Unmount should trigger reset internally
    await act(async () => {
      unmount();
    });

    // 3. Verify FSM reaches IDLE (High-Fidelity State Proof)
    await vi.waitFor(() => {
      expect(useSessionStore.getState().runtimeState).toBe('IDLE');
    }, { timeout: 2000 });
  });
});