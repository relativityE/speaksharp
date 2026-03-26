import { renderHook, act, waitFor } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import type { useTranscriptionService as useTranscriptionServiceType } from '../useTranscriptionService';
import { E2E_DETERMINISTIC_NATIVE } from '../types';
import type { TranscriptionProvider as ProviderType } from '../../../providers/TranscriptionProvider';
import type { SpeechRuntimeController } from '../../../services/SpeechRuntimeController';
import type { useSessionStore as useSessionStoreType } from '../../../stores/useSessionStore';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

/**
 * @file useTranscriptionService.component.test.tsx
 * @description Contract verification for the transcription hook lifecycle.
 */

describe('useTranscriptionService (Contract Verification)', () => {
  let useTranscriptionService: typeof useTranscriptionServiceType;
  let speechRuntimeController: SpeechRuntimeController;
  let useSessionStore: typeof useSessionStoreType;

  const mockOptions = {
    onTranscriptUpdate: vi.fn(),
    onModelLoadProgress: vi.fn(),
    onReady: vi.fn(),
    session: null,
    navigate: vi.fn(),
    getAssemblyAIToken: vi.fn().mockResolvedValue('token')
  };

  let TranscriptionProvider: typeof ProviderType;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TranscriptionProvider>{children}</TranscriptionProvider>
  );

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Step 1: Reset + Global Identity Seal at T=0
    await setupStrictZero();

    // Step 2: Dynamic Import AFTER setup to ensure instance identity parity
    const hookModule = await import('../useTranscriptionService');
    const srcModule = await import('../../../services/SpeechRuntimeController');
    const storeModule = await import('../../../stores/useSessionStore');
    const providerModule = await import('../../../providers/TranscriptionProvider');

    useTranscriptionService = hookModule.useTranscriptionService;
    speechRuntimeController = srcModule.speechRuntimeController;
    useSessionStore = storeModule.useSessionStore;
    TranscriptionProvider = providerModule.TranscriptionProvider;

    // Reset real store and controller
    useSessionStore.getState().resetSession();
    await speechRuntimeController.reset();
  });

  afterEach(async () => {
    if (typeof window !== 'undefined') {
        const win = window as unknown as Record<string, unknown>;
        delete win.__SS_E2E__;
    }
    if (speechRuntimeController) {
      await speechRuntimeController.reset();
    }
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
    const { result, unmount } = renderHook(() => useTranscriptionService(mockOptions), { wrapper });
    
    await act(async () => {
      await speechRuntimeController.warmUp();
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });
    expect(useSessionStore.getState().runtimeState).toBe('RECORDING');

    await act(async () => {
      unmount();
    });

    await vi.waitFor(() => {
      expect(useSessionStore.getState().runtimeState).toBe('IDLE');
    }, { timeout: 2000 });
  });
});