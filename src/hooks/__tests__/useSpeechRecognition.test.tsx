import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSpeechRecognition } from '../useSpeechRecognition';
import { useAuth } from '../../contexts/useAuth';
import TranscriptionService, { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { User } from '@supabase/supabase-js';
import { UserProfile } from '../../types/user';
import { AuthContextType } from '../../contexts/AuthContext';

// Mock dependencies
vi.mock('../../contexts/useAuth');
vi.mock('../../services/transcription/TranscriptionService');

const mockUseAuth = vi.mocked(useAuth);
const MockTranscriptionService = vi.mocked(TranscriptionService);

// Wrapper component to provide Router context
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

// Mock implementation for TranscriptionService
let mockServiceInstance: {
  init: ReturnType<typeof vi.fn>,
  startTranscription: ReturnType<typeof vi.fn>,
  stopTranscription: ReturnType<typeof vi.fn>,
  destroy: ReturnType<typeof vi.fn>,
  getMode: ReturnType<typeof vi.fn>,
  options: TranscriptionServiceOptions,
};

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    // Create fresh mock instance for each test
    mockServiceInstance = {
      init: vi.fn().mockResolvedValue({ success: true }),
      startTranscription: vi.fn().mockResolvedValue(undefined),
      stopTranscription: vi.fn().mockResolvedValue('final transcript'),
      destroy: vi.fn().mockResolvedValue(undefined),
      getMode: vi.fn().mockReturnValue('native'),
      options: {} as TranscriptionServiceOptions,
    };

    MockTranscriptionService.mockImplementation((options) => {
      mockServiceInstance.options = options;
      return mockServiceInstance as unknown as TranscriptionService;
    });

    mockUseAuth.mockReturnValue({
      user: { id: 'test-user' } as User,
      profile: { subscription_status: 'free' } as UserProfile,
    } as AuthContextType);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it('should initialize correctly and set isReady to true', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
      // Simulate the onReady callback from the service
      if (mockServiceInstance.options.onReady) {
        mockServiceInstance.options.onReady();
      }
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.isListening).toBe(true);
    
    // Clean up
    unmount();
  });

  it('should call startTranscription and update mode', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockServiceInstance.startTranscription).toHaveBeenCalled();
    expect(result.current.mode).toBe('native');
    
    // Clean up
    unmount();
  });

  it('should handle transcript updates from the service', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    // Test partial transcript update
    await act(async () => {
      if (mockServiceInstance.options.onTranscriptUpdate) {
        mockServiceInstance.options.onTranscriptUpdate({ 
          transcript: { partial: 'hello' } 
        } as TranscriptUpdate);
      }
    });
    expect(result.current.interimTranscript).toBe('hello');

    // Test final transcript update
    await act(async () => {
      if (mockServiceInstance.options.onTranscriptUpdate) {
        mockServiceInstance.options.onTranscriptUpdate({ 
          transcript: { final: 'world' } 
        });
      }
    });
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.chunks).toEqual([{ text: 'world', id: expect.any(Number) }]);

    // Wait for debounced operations to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    expect(result.current.transcript).toBe('world');
    
    // Clean up
    unmount();
  });

  it('should call stopTranscription and return stats', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    let stats = null;
    await act(async () => {
      stats = await result.current.stopListening();
    });

    expect(mockServiceInstance.stopTranscription).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
    expect(stats).toEqual(expect.objectContaining({
      transcript: '',
      total_words: 0,
    }));
    
    // Clean up
    unmount();
  });

  it('should handle errors during startListening', async () => {
    const error = new Error('Permission denied');
    mockServiceInstance.init.mockRejectedValue(error);
    const { unmount, result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(false);
    
    // Clean up
    unmount();
  });

  it('should call destroy on unmount', async () => {
    const { unmount } = renderHook(() => useSpeechRecognition(), { wrapper });
    
    // Wait a tick to ensure hook is fully initialized
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    unmount();
    expect(mockServiceInstance.destroy).toHaveBeenCalled();
  });
});
