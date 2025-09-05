import { vi } from 'vitest';

// CRITICAL: Mock MUST be at the very top, before any other imports
// This ensures Vitest hoists it before module resolution
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    }
  },
  default: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    }
  }
}));

// NOW you can import everything else
import { render, screen, waitFor } from '../test/test-utils';
import { SessionPage } from '../pages/SessionPage';
import { useSessionManager } from '../hooks/useSessionManager';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

vi.mock('../hooks/useSessionManager');
vi.mock('../hooks/useSpeechRecognition');
vi.mock('../components/session/SessionSidebar', () => ({
    SessionSidebar: () => <div data-testid="session-sidebar" />
}));
vi.mock('../components/session/TranscriptPanel', () => ({
    TranscriptPanel: () => <div data-testid="transcript-panel" />
}));

describe('SessionPage', () => {
    let mockUseSessionManager;
    let mockUseSpeechRecognition;

    beforeEach(() => {
        mockUseSessionManager = {
            saveSession: vi.fn(),
            usageLimitExceeded: false,
            setUsageLimitExceeded: vi.fn(),
        };
        mockUseSpeechRecognition = {
            isListening: false,
            isReady: false,
            transcript: '',
            interimTranscript: '',
            fillerData: {},
            error: null,
            isSupported: true,
            mode: 'native',
            modelLoadingProgress: null,
            startListening: vi.fn(),
            stopListening: vi.fn(),
            reset: vi.fn(),
        };

        useSessionManager.mockReturnValue(mockUseSessionManager);
        useSpeechRecognition.mockReturnValue(mockUseSpeechRecognition);
    });

  it('should render with SessionProvider', async () => {
    const { supabase } = await import('../lib/supabaseClient');
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } });
    supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'test-user', subscription_status: 'free' }, error: null })
    });

    render(<SessionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('transcript-panel')).toBeInTheDocument();
    });
  });
});
