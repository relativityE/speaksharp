import { render, screen, act } from '@testing-library/react';
import { vi } from 'vitest';
import { SessionPage } from '../pages/SessionPage';
import { useAuth } from '../contexts/AuthContext';
import { useSessionManager } from '../hooks/useSessionManager';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

// Mock the hooks
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useSessionManager');
vi.mock('../hooks/useSpeechRecognition');

// Mock child components that are not relevant to the test
vi.mock('../components/session/FillerWordAnalysis', () => ({
  __esModule: true,
  default: () => <div data-testid="filler-analysis" />,
}));
vi.mock('../components/session/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="session-sidebar" />,
}));
vi.mock('../components/UpgradePromptDialog', () => ({
    UpgradePromptDialog: () => null,
}));


describe('SessionPage', () => {
    let mockUseAuth;
    let mockUseSessionManager;
    let mockUseSpeechRecognition;

    beforeEach(() => {
        // Reset mocks before each test
        mockUseAuth = {
            user: null,
            profile: null,
        };
        mockUseSessionManager = {
            saveSession: vi.fn(),
            usageLimitExceeded: false,
            setUsageLimitExceeded: vi.fn(),
        };
        mockUseSpeechRecognition = {
            isListening: false,
            startListening: vi.fn(),
            stopListening: vi.fn(),
            reset: vi.fn(),
            // Provide default values for other properties
            transcript: '',
            chunks: [],
            interimTranscript: '',
            fillerData: {},
            error: null,
            isSupported: true,
            mode: 'cloud',
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

    it('should auto-stop the session for an anonymous user after 2 minutes', () => {
        // Start as not listening
        mockUseSpeechRecognition.isListening = false;
        const { rerender } = render(<SessionPage />);

        // Simulate starting the recording
        mockUseSpeechRecognition.isListening = true;
        rerender(<SessionPage />);

        // Advance time by 120 seconds
        act(() => {
            vi.advanceTimersByTime(120 * 1000);
        });

        // Check that stopListening was called
        expect(mockUseSpeechRecognition.stopListening).toHaveBeenCalledTimes(1);
        // Check that the upgrade prompt is triggered
        expect(mockUseSessionManager.setUsageLimitExceeded).toHaveBeenCalledWith(true);
    });

    it('should auto-stop the session for a free user after 30 minutes', () => {
        mockUseAuth.user = { id: 'test-user' };
        mockUseAuth.profile = { subscription_status: 'free' };
        useAuth.mockReturnValue(mockUseAuth);

        mockUseSpeechRecognition.isListening = false;
        const { rerender } = render(<SessionPage />);

        mockUseSpeechRecognition.isListening = true;
        rerender(<SessionPage />);

        act(() => {
            vi.advanceTimersByTime(30 * 60 * 1000);
        });

        expect(mockUseSpeechRecognition.stopListening).toHaveBeenCalledTimes(1);
        expect(mockUseSessionManager.setUsageLimitExceeded).toHaveBeenCalledWith(true);
    });

    it('should not auto-stop the session for a pro user', () => {
        mockUseAuth.user = { id: 'test-user' };
        mockUseAuth.profile = { subscription_status: 'pro' };
        useAuth.mockReturnValue(mockUseAuth);

        mockUseSpeechRecognition.isListening = false;
        const { rerender } = render(<SessionPage />);

        mockUseSpeechRecognition.isListening = true;
        rerender(<SessionPage />);

        // Advance time past the 30-minute mark
        act(() => {
            vi.advanceTimersByTime(31 * 60 * 1000);
        });

        expect(mockUseSpeechRecognition.stopListening).not.toHaveBeenCalled();
    });

    it('should render an error message when speech recognition fails', () => {
        const errorMessage = 'Speech recognition service is unavailable.';
        // Override the mock for this specific test to simulate an error state
        useSpeechRecognition.mockReturnValue({
            isListening: true,
            isReady: false,
            error: new Error(errorMessage),
            transcript: '',
            chunks: [],
            interimTranscript: '',
            fillerData: {},
            isSupported: true,
            mode: 'cloud',
            startListening: vi.fn(),
            stopListening: vi.fn(),
            reset: vi.fn(),
        });

        render(<SessionPage />);

        expect(screen.getByText('An Error Occurred')).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
});
