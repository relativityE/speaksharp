// useSpeechRecognition.memory.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { AuthProvider } from '../contexts/AuthContext';

// Mock dependencies
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

let mockTranscriptionServiceInstance;
vi.mock('../services/transcription/TranscriptionService', () => ({
  default: vi.fn().mockImplementation(() => {
    return mockTranscriptionServiceInstance;
  })
}));

console.log('[FILE LOADED] useSpeechRecognition.memory.test.jsx starting to load');
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { AuthProvider } from '../contexts/AuthContext';
console.log('[IMPORTS COMPLETE] All imports loaded successfully');

describe('useSpeechRecognition Memory Test', () => {
  console.log('[DESCRIBE START] useSpeechRecognition Memory Test');
  beforeEach(() => {
    console.log('[TEST START] beforeEach running');
    vi.clearAllMocks();
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
    vi.clearAllTimers(); // Add this
    vi.resetAllMocks();  // Add this
  });

  const session = { user: { id: 'test-user' } };
  const wrapper = ({ children }) => (
    <MemoryRouter>
      <AuthProvider enableSubscription={false} initialSession={session}>
        {children}
      </AuthProvider>
    </MemoryRouter>
  );

  it('should render the hook without crashing', async () => { // Make async
    const { result, unmount } = renderHook(() => useSpeechRecognition(), { wrapper });

    expect(result.current).toBeDefined();

    // Proper cleanup
    unmount();
  });
});
