import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { useAuth } from '../contexts/AuthContext';

// Mock dependencies
vi.mock('../contexts/AuthContext');
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Define a mutable instance that our mock will return.
let mockTranscriptionServiceInstance;

vi.mock('../services/transcription/TranscriptionService', () => ({
  default: vi.fn().mockImplementation(() => {
    return mockTranscriptionServiceInstance;
  })
}));


describe('useSpeechRecognition Memory Test', () => {
  let mockAuth;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth = {
      session: { user: { id: 'test-user' } },
      profile: { subscription_status: 'free' },
    };
    useAuth.mockReturnValue(mockAuth);

    mockTranscriptionServiceInstance = {
      init: vi.fn().mockResolvedValue(undefined),
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      destroy: vi.fn(),
      mode: 'mock',
    };
  });

  afterEach(() => {
    cleanup();
  });

  const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

  it('should render the hook without crashing', () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });
    expect(result.current).toBeDefined();
  });
});
