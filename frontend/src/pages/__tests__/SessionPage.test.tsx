import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionPage } from '../SessionPage';
import * as SpeechRecognitionHook from '../../hooks/useSpeechRecognition';
import * as SessionStore from '../../stores/useSessionStore';
import * as VocalAnalysisHook from '../../hooks/useVocalAnalysis';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as UserProfileHook from '@/hooks/useUserProfile';
import * as UsageLimitHook from '@/hooks/useUsageLimit';

// Mock modules
vi.mock('../../hooks/useSpeechRecognition');
vi.mock('../../stores/useSessionStore');
vi.mock('../../hooks/useVocalAnalysis');
vi.mock('../../contexts/AuthProvider');
vi.mock('@/hooks/useUserProfile');
vi.mock('@/hooks/useUsageLimit');
vi.mock('@/hooks/useSessionManager', () => ({
    useSessionManager: () => ({
        saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    }),
}));
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
    },
}));

// Helper to render with router
const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
};

// Mock child components
vi.mock('@/components/session/PauseMetricsDisplay', () => ({
    PauseMetricsDisplay: () => <div data-testid="pause-metrics-display">Pause Metrics</div>,
}));
vi.mock('@/components/session/CustomVocabularyManager', () => ({
    CustomVocabularyManager: () => <div data-testid="custom-vocabulary-manager">Custom Vocabulary Manager</div>,
}));

const mockUseSpeechRecognition = vi.mocked(SpeechRecognitionHook.useSpeechRecognition);
const mockUseSessionStore = vi.mocked(SessionStore.useSessionStore);
const mockUseVocalAnalysis = vi.mocked(VocalAnalysisHook.useVocalAnalysis);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);
const mockUseUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);

describe('SessionPage', () => {
    const mockStartListening = vi.fn();
    const mockStopListening = vi.fn();
    const mockUpdateElapsedTime = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        // Default mocks
        mockUseSpeechRecognition.mockReturnValue({
            transcript: { transcript: '', confidence: 0, isFinal: false },
            fillerData: {},
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: false,
            isReady: true,
            modelLoadingProgress: null,
            error: null,
            resetTranscript: vi.fn(),
        } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

        mockUseSessionStore.mockReturnValue({
            elapsedTime: 0,
            updateElapsedTime: mockUpdateElapsedTime,
            resetSession: vi.fn(),
        } as unknown as ReturnType<typeof SessionStore.useSessionStore>);

        mockUseVocalAnalysis.mockReturnValue({
            pauseMetrics: {
                totalPauses: 0,
                averagePauseDuration: 0,
                longPauses: 0,
                pauseRate: 0,
            },
        } as unknown as ReturnType<typeof VocalAnalysisHook.useVocalAnalysis>);

        mockUseAuthProvider.mockReturnValue({
            session: { user: { id: 'test-user' } },
        } as unknown as AuthProvider.AuthContextType);

        mockUseUserProfile.mockReturnValue({
            data: { id: 'test-profile' },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

        mockUseUsageLimit.mockReturnValue({
            data: { can_start: true, remaining_seconds: 1800, limit_seconds: 1800, is_pro: false },
            isLoading: false,
        } as unknown as ReturnType<typeof UsageLimitHook.useUsageLimit>);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Rendering', () => {
        it('should render the session page title', () => {
            renderWithRouter(<SessionPage />);
            expect(screen.getByText('Practice Session')).toBeInTheDocument();
        });

        it('should render the live recording card', () => {
            renderWithRouter(<SessionPage />);
            expect(screen.getByText('Live Recording')).toBeInTheDocument();
        });

        it('should render metrics cards', () => {
            renderWithRouter(<SessionPage />);
            expect(screen.getByText('Clarity Score')).toBeInTheDocument();
            expect(screen.getByText('Speaking Rate')).toBeInTheDocument();
            expect(screen.getByText('Filler Words')).toBeInTheDocument();
        });

        it('should render pause metrics display', () => {
            renderWithRouter(<SessionPage />);
            expect(screen.getByTestId('pause-metrics-display')).toBeInTheDocument();
        });

        it('should render settings button', () => {
            renderWithRouter(<SessionPage />);
            expect(screen.getByTestId('session-settings-button')).toBeInTheDocument();
        });
    });

    describe('Loading States', () => {
        it('should render loading state when profile is loading', () => {
            mockUseUserProfile.mockReturnValue({
                data: null,
                isLoading: true,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByTestId('session-page-skeleton')).toBeInTheDocument();
        });

        it('should render error state when profile fails to load', () => {
            mockUseUserProfile.mockReturnValue({
                data: null,
                isLoading: false,
                error: { message: 'Failed to load' },
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByText('Error Loading Profile')).toBeInTheDocument();
        });
    });

    describe('Session Control', () => {
        it('should start listening when start button is clicked', async () => {
            renderWithRouter(<SessionPage />);

            const startButton = screen.getByTestId('session-start-stop-button');
            fireEvent.click(startButton);

            // Default mode is 'native', so it should call with forceNative: true
            expect(mockStartListening).toHaveBeenCalledWith({
                forceNative: true,
                forceOnDevice: false,
                forceCloud: false
            });
        });

        it('should stop listening when stop button is clicked', async () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: true,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);

            const stopButton = screen.getByTestId('session-start-stop-button');
            fireEvent.click(stopButton);

            expect(mockStopListening).toHaveBeenCalled();
        });

        it('should disable start button when listening but not ready', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isReady: false,
                isListening: true,
                modelLoadingProgress: null,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);

            const button = screen.getByTestId('session-start-stop-button');
            expect(button).toBeDisabled();
        });

        it('should show Ready status when not listening', () => {
            renderWithRouter(<SessionPage />);
            expect(screen.getByTestId('session-status-indicator')).toHaveTextContent('Ready');
        });

        it('should show Connecting status when listening but not ready', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isReady: false,
                isListening: true,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByTestId('session-status-indicator')).toHaveTextContent('Connecting...');
        });
    });

    describe('Timer Logic', () => {
        it('should update elapsed time when listening', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: true,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);

            // Advance time by 1 second
            act(() => {
                vi.advanceTimersByTime(1000);
            });

            expect(mockUpdateElapsedTime).toHaveBeenCalled();
        });

        it('should reset elapsed time when stopped', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: false,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);

            expect(mockUpdateElapsedTime).toHaveBeenCalledWith(0);
        });
    });

    describe('Metrics Display', () => {
        it('should display formatted time', () => {
            mockUseSessionStore.mockReturnValue({
                elapsedTime: 65, // 1 minute 5 seconds
                updateElapsedTime: mockUpdateElapsedTime,
            } as unknown as ReturnType<typeof SessionStore.useSessionStore>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByText('01:05')).toBeInTheDocument();
        });

        it('should calculate and display WPM', () => {
            mockUseSessionStore.mockReturnValue({
                elapsedTime: 60,
                updateElapsedTime: mockUpdateElapsedTime,
                resetSession: vi.fn(),
            } as unknown as ReturnType<typeof SessionStore.useSessionStore>);

            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                transcript: { transcript: 'one two three four five', confidence: 1, isFinal: true },
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);
            // 5 words in 60 seconds = 5 WPM
            expect(screen.getByText('5')).toBeInTheDocument();
        });

        it('should display filler word count', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                fillerData: {
                    'um': { count: 2 },
                    'uh': { count: 3 },
                },
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByText('5')).toBeInTheDocument(); // Total filler count
            expect(screen.getByText('"um"')).toBeInTheDocument();
            expect(screen.getByText('"uh"')).toBeInTheDocument();
        });
    });

    describe('Transcript Display', () => {
        it('should display "Listening..." when listening but no transcript', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: true,
                transcript: { transcript: '', confidence: 0, isFinal: false },
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByText('Listening...')).toBeInTheDocument();
        });

        it('should display transcript text', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: true,
                transcript: { transcript: 'Hello world', confidence: 1, isFinal: true },
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByText('Hello world')).toBeInTheDocument();
        });

        it('should display placeholder when not listening and no transcript', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: false,
                transcript: { transcript: '', confidence: 0, isFinal: false },
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);
            expect(screen.getByText('words appear here...')).toBeInTheDocument();
        });
    });
});
