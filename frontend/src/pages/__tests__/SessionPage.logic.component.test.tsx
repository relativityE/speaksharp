import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SessionPage from '../SessionPage';
import { MemoryRouter } from 'react-router-dom';

// --- Mocks ---
const mockNavigate = vi.fn();
const mockUpdateElapsedTime = vi.fn();
const mockSaveSession = vi.fn();
const mockStartListening = vi.fn();
const mockStopListening = vi.fn();


// Mock dependencies
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
        init: vi.fn(),
    },
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: () => ({ session: { user: { id: 'test-user' } } }),
}));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: vi.fn(),
}));

vi.mock('../../stores/useSessionStore', () => ({
    useSessionStore: () => ({
        updateElapsedTime: mockUpdateElapsedTime,
        elapsedTime: 0,
    }),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
    useSpeechRecognition: vi.fn(),
}));

vi.mock('../../hooks/useVocalAnalysis', () => ({
    useVocalAnalysis: () => ({
        pauseMetrics: {
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0
        },
        pauseMetricsHistory: []
    }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/hooks/useUsageLimit', () => ({
    useUsageLimit: () => ({ data: { can_start: true, remaining_seconds: 3600 }, isLoading: false }),
    formatRemainingTime: (s: number) => `${s}s`,
}));

vi.mock('@/hooks/useStreak', () => ({
    useStreak: () => ({ updateStreak: vi.fn(() => ({ currentStreak: 1, isNewDay: false })) }),
}));

vi.mock('@/hooks/useSessionManager', () => ({
    useSessionManager: () => ({ saveSession: mockSaveSession }),
}));

vi.mock('@/hooks/useUserFillerWords', () => ({
    useUserFillerWords: () => ({ userFillerWords: [] }),
}));

vi.mock('@/hooks/useSessionMetrics', () => ({
    useSessionMetrics: () => ({
        wpm: 0,
        clarityScore: 0,
        fillerCount: 0,
        formattedTime: '00:00',
    }),
}));

// Mock child components to isolate logic
vi.mock('@/components/session/LiveRecordingCard', () => ({
    LiveRecordingCard: ({ mode, onModeChange }: { mode: string, onModeChange: (m: string) => void }) => (
        <div data-testid="recording-card">
            <span data-testid="mode-display">{mode}</span>
            <button onClick={() => onModeChange('cloud')} data-testid="switch-mode-btn">Switch to Cloud</button>
        </div>
    ),
}));

vi.mock('@/components/session/StatusNotificationBar', () => ({
    StatusNotificationBar: () => <div data-testid="status-bar" />,
}));

vi.mock('@/components/session/LiveTranscriptPanel', () => ({
    LiveTranscriptPanel: () => <div data-testid="transcript-panel" />,
}));

vi.mock('@/components/session/ClarityScoreCard', () => ({
    ClarityScoreCard: () => <div data-testid="clarity-card" />,
}));

vi.mock('@/components/session/SpeakingRateCard', () => ({
    SpeakingRateCard: () => <div data-testid="rate-card" />,
}));

vi.mock('@/components/session/FillerWordsCard', () => ({
    FillerWordsCard: () => <div data-testid="filler-card" />,
}));

vi.mock('@/components/session/SpeakingTipsCard', () => ({
    SpeakingTipsCard: () => <div data-testid="tips-card" />,
}));

vi.mock('@/components/session/MobileActionBar', () => ({
    MobileActionBar: () => <div data-testid="mobile-bar" />,
}));

vi.mock('@/components/PromoExpiredDialog', () => ({
    PromoExpiredDialog: () => <div data-testid="promo-dialog" />,
}));

vi.mock('@/components/session/SessionPageSkeleton', () => ({
    SessionPageSkeleton: () => <div data-test-id="skeleton" />,
}));

vi.mock('@/components/session/UserFillerWordsManager', () => ({
    UserFillerWordsManager: () => <div data-testid="filler-manager" />,
}));

// Mock sonner to prevent timer issues
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        id: vi.fn(),
    },
}));

// Import for mocking responses
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
// Removing the one I added at line 94 if it conflicts with top level.
// Actually, looking at the previous file content, I don't see an import at the top in the Snippet.
// But the error says "Duplicate identifier". 
// I will check the file content first to be sure, but to be safe I will just use the one I added and ensure no other exists.
// Wait, I can't check file content inside replace_file_content.
// I will just remove the one I added at line 94 because it likely conflicted with line 3 `import SessionPage from '../SessionPage';`


describe('SessionPage Logic', () => {
    beforeEach(() => {
        console.log('[TEST] beforeEach START');
        vi.clearAllMocks();
        // Default mocks
        (useUserProfile as unknown as Mock).mockReturnValue({
            data: { subscription_status: 'pro' }, // CORRECT: Matches SUBSCRIPTION_TIERS.PRO
            isLoading: false,
            error: null,
        });

        (useSpeechRecognition as unknown as Mock).mockReturnValue({
            transcript: { transcript: '' }, // Fix: transcript is an object with transcript string
            fillerData: {},
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: false,
            isReady: true,
            modelLoadingProgress: null,
            mode: 'native',
            sttStatus: { type: 'ready' },
            chunks: [],
        });
    });




    describe('Redirect / Loading Logic', () => {
        it('should show loading skeleton while profile is loading', () => {
            (useUserProfile as unknown as Mock).mockReturnValue({
                data: null,
                isLoading: true, // Emulate loading state
                error: null,
            });

            render(
                <MemoryRouter>
                    <SessionPage />
                </MemoryRouter>
            );

            // In code: if (isProfileLoading) return <SessionPageSkeleton />;
            // We assume skeleton renders something identifiable or simply verify no main content
            expect(screen.queryByTestId('recording-card')).not.toBeInTheDocument();
        });

        it('should render main content when profile is loaded and user is Pro', () => {
            // Default is Pro
            render(
                <MemoryRouter>
                    <SessionPage />
                </MemoryRouter>
            );
            expect(screen.getByTestId('recording-card')).toBeInTheDocument();
        });
    });

    describe('Mode Switching Logic', () => {
        it('should update mode when user changes it via dropdown', () => {
            console.log('[TEST] "update mode" START');
            render(
                <MemoryRouter>
                    <SessionPage />
                </MemoryRouter>
            );

            const display = screen.getByTestId('mode-display');
            expect(display).toHaveTextContent('native');
            console.log('[TEST] "update mode" Initial state OK');

            const btn = screen.getByTestId('switch-mode-btn');
            console.time('act-click');
            act(() => {
                btn.click();
            });
            console.timeEnd('act-click');

            console.log('[TEST] "update mode" After click');
            expect(screen.getByTestId('mode-display')).toHaveTextContent('cloud');
            console.log('[TEST] "update mode" DONE');
        });

        it('should SYNC UI mode when a fallback event occurs', () => {
            console.log('[TEST] "fallback sync" START');

            // Start with isListening=true and mode='private' (emulating active Private STT)
            (useSpeechRecognition as unknown as Mock).mockReturnValue({
                transcript: { transcript: '' },
                fillerData: {},
                startListening: mockStartListening,
                stopListening: mockStopListening,
                isListening: true,
                isReady: true,
                modelLoadingProgress: null,
                mode: 'private',
                sttStatus: { type: 'ready' },
                chunks: [],
            });

            const { rerender } = render(
                <MemoryRouter>
                    <SessionPage />
                </MemoryRouter>
            );
            expect(screen.getByTestId('mode-display')).toHaveTextContent('private');
            console.log('[TEST] "fallback sync" Initial render complete');

            console.log('[TEST] "fallback sync" Updating mock to fallback...');
            // Simulate fallback: service changes `mode` (activeMode) to 'cloud' after fallback
            (useSpeechRecognition as unknown as Mock).mockReturnValue({
                transcript: { transcript: '' },
                fillerData: {},
                startListening: mockStartListening,
                stopListening: mockStopListening,
                isListening: true, // Still listening after fallback
                isReady: true,
                modelLoadingProgress: null,
                mode: 'cloud', // The new active mode after fallback
                sttStatus: {
                    type: 'fallback',
                    newMode: 'cloud'
                },
                chunks: [],
            });
            console.log('[TEST] "fallback sync" Mock updated. Rerendering...');

            console.time('rerender');
            act(() => {
                rerender(
                    <MemoryRouter>
                        <SessionPage />
                    </MemoryRouter>
                );
            });
            console.timeEnd('rerender');

            console.log('[TEST] "fallback sync" Verifying result...');
            expect(screen.getByTestId('mode-display')).toHaveTextContent('cloud');
            console.log('[TEST] "fallback sync" DONE');
        });
    });
});
