import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { SessionPage } from '../pages/SessionPage';
import { useAuth } from '../contexts/AuthContext';
import { useSessionManager } from '../hooks/useSessionManager';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import posthog from 'posthog-js';

// Mock dependencies
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useSessionManager');
vi.mock('../hooks/useSpeechRecognition');
vi.mock('posthog-js', () => ({
  __esModule: true,
  default: {
    capture: vi.fn(),
  },
}));

// Mock child components
vi.mock('../components/session/TranscriptPanel', ({ TranscriptPanel: Original }) => ({
  // Pass isLoading as a data attribute for easier testing
  TranscriptPanel: (props) => <div data-testid="transcript-panel" data-is-loading={props.isLoading} />,
}));
vi.mock('../components/session/FillerWordAnalysis', () => ({
  __esModule: true,
  default: () => <div data-testid="filler-analysis" />,
}));
vi.mock('../components/session/AISuggestions', () => ({
  __esModule: true,
  default: () => <div data-testid="ai-suggestions" />,
}));
vi.mock('../components/session/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="session-sidebar" />,
}));
vi.mock('../components/UpgradePromptDialog', () => ({
  UpgradePromptDialog: () => <div data-testid="upgrade-prompt" />,
}));
vi.mock('@/components/ErrorBoundary', () => ({
    __esModule: true,
    default: ({children}) => <>{children}</>
}));
// Mocking the drawer to control its open state and content
vi.mock('@/components/ui/drawer', () => ({
    Drawer: ({ children, open }) => <div data-testid="drawer-wrapper" data-open={open}>{children}</div>,
    DrawerTrigger: ({ children }) => <div>{children}</div>,
    DrawerContent: ({ children }) => <div data-testid="drawer-content">{children}</div>,
}));


describe('SessionPage', () => {
    let mockUseAuth;
    let mockUseSessionManager;
    let mockUseSpeechRecognition;

    beforeEach(() => {
        mockUseAuth = { user: null, profile: null };
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

        useAuth.mockReturnValue(mockUseAuth);
        useSessionManager.mockReturnValue(mockUseSessionManager);
        useSpeechRecognition.mockReturnValue(mockUseSpeechRecognition);

        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('should call posthog.capture on mount', () => {
        render(<SessionPage />);
        expect(posthog.capture).toHaveBeenCalledWith('session_page_viewed');
    });

    it('should render browser not supported message', () => {
        useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, isSupported: false });
        render(<SessionPage />);
        expect(screen.getByText('Browser Not Supported')).toBeInTheDocument();
    });

    it('should show loading indicator when listening but not ready', () => {
        useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, isListening: true, isReady: false });
        render(<SessionPage />);
        // isLoading prop is calculated inside the component, so we check the data attribute on the mock
        expect(screen.getByTestId('transcript-panel')).toHaveAttribute('data-is-loading', 'true');
    });

    it('should render AI suggestions when there is a transcript and not listening', () => {
        useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, transcript: 'hello world', isListening: false });
        render(<SessionPage />);
        expect(screen.getByTestId('ai-suggestions')).toBeInTheDocument();
    });

    it('should not render AI suggestions when listening', () => {
        useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, transcript: 'hello world', isListening: true });
        render(<SessionPage />);
        expect(screen.queryByTestId('ai-suggestions')).not.toBeInTheDocument();
    });

    it('should render sidebar for desktop and mobile (in drawer)', () => {
        render(<SessionPage />);
        // Both sidebars (one for desktop, one for mobile drawer) are rendered.
        expect(screen.getAllByTestId('session-sidebar').length).toBe(2);
    });


    describe('Session Timeout Logic', () => {
        it('should auto-stop for anonymous user after 2 minutes', () => {
            useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, isListening: true });
            render(<SessionPage />);

            act(() => {
                vi.advanceTimersByTime(120 * 1000);
            });

            expect(mockUseSpeechRecognition.stopListening).toHaveBeenCalledTimes(1);
            expect(mockUseSessionManager.setUsageLimitExceeded).toHaveBeenCalledWith(true);
        });

        it('should auto-stop for free user after 30 minutes', () => {
            useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'free' } });
            useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, isListening: true });
            render(<SessionPage />);

            act(() => {
                vi.advanceTimersByTime(30 * 60 * 1000);
            });

            expect(mockUseSpeechRecognition.stopListening).toHaveBeenCalledTimes(1);
            expect(mockUseSessionManager.setUsageLimitExceeded).toHaveBeenCalledWith(true);
        });

        it('should not auto-stop for a pro user', () => {
            useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'pro' } });
            useSpeechRecognition.mockReturnValue({ ...mockUseSpeechRecognition, isListening: true });
            render(<SessionPage />);

            act(() => {
                vi.advanceTimersByTime(31 * 60 * 1000);
            });

            expect(mockUseSpeechRecognition.stopListening).not.toHaveBeenCalled();
        });
    });
});
