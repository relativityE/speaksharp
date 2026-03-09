import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { SessionPage } from '../SessionPage';
import * as UsageLimitHook from '@/hooks/useUsageLimit';
import * as SessionStore from '../../stores/useSessionStore';
import * as VocalAnalysisHook from '../../hooks/useVocalAnalysis';
import * as AuthProvider from '../../contexts/AuthProvider';
import { createTestSessionStore } from '../../../tests/unit/factories/storeFactory';

// ARCHITECTURE: Mock useSessionLifecycle to strictly unit test the View
vi.mock('@/hooks/useSessionLifecycle');
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
const mockUseSessionLifecycle = vi.mocked(useSessionLifecycle);

// Mock dependencies
vi.mock('../../hooks/useSpeechRecognition');
vi.mock('../../stores/useSessionStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../stores/useSessionStore')>();
    return {
        ...actual,
        useSessionStore: Object.assign(vi.fn(), {
            getState: vi.fn(() => ({ modelLoadingProgress: null }))
        }),
    };
});
vi.mock('../../hooks/useVocalAnalysis');
vi.mock('../../contexts/AuthProvider', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../contexts/AuthProvider')>();
    return {
        ...actual,
        useAuthProvider: vi.fn(() => ({ session: { user: { id: 'test-user' } } })),
    };
});
vi.mock('@/hooks/useUserProfile');
vi.mock('@/hooks/useUsageLimit');
vi.mock('@/hooks/useUserFillerWords', () => ({
    useUserFillerWords: () => ({
        userFillerWords: ['mock-word'],
        fullVocabularyObjects: [{ id: '1', word: 'mock-word', user_id: 'test', created_at: new Date().toISOString() }],
        isLoading: false,
        error: null,
        addWord: vi.fn(),
        removeWord: vi.fn(),
        isAdding: false,
        isRemoving: false,
        count: 1,
        maxWords: 100,
        isPro: false,
    }),
}));
vi.mock('@/hooks/useSessionManager', () => ({
    useSessionManager: () => ({
        saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    }),
}));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
vi.mock('@/components/session/PauseMetricsDisplay', () => ({ PauseMetricsDisplay: () => <div>Pause Metrics</div> }));
vi.mock('@/components/session/UserFillerWordsManager', () => ({ UserFillerWordsManager: () => <div>User Filler Words</div> }));

vi.mock('@/providers/useTranscriptionContext', () => ({
    useTranscriptionContext: () => ({
        service: {
            warmUp: vi.fn(),
        },
        isReady: true,
    }),
}));

const mockUseUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);
const mockUseSessionStore = vi.mocked(SessionStore.useSessionStore);
const mockUseVocalAnalysis = vi.mocked(VocalAnalysisHook.useVocalAnalysis);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

describe('SessionPage - STT Mode Selection UI', () => {

    beforeEach(() => {
        vi.clearAllMocks();

        // Default Lifecycle Mock
        mockUseSessionLifecycle.mockReturnValue({
            isListening: false,
            isReady: true,
            isProUser: false, // Default to false
            mode: 'native',
            sttStatus: { type: 'ready', message: '' },
            modelLoadingProgress: null,
            metrics: {
                formattedTime: '00:00',
                wpm: 0,
                clarityScore: 100,
                clarityLabel: 'Excellent',
                wpmLabel: 'Optimal',
                fillerCount: 0
            },
            pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
            transcriptContent: '',
            fillerData: {},
            setMode: vi.fn(),
            handleStartStop: vi.fn(),
            isButtonDisabled: false,
            showPromoExpiredDialog: false,
            showAnalyticsPrompt: false,
            sessionFeedbackMessage: null,
            sunsetModal: { type: 'daily', open: false }
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        const mockStore = createTestSessionStore({
            elapsedTime: 0,
        });
        (mockUseSessionStore as unknown as Mock).mockImplementation(mockStore);
        mockUseSessionStore.getState = vi.fn(() => mockStore.getState());

        mockUseVocalAnalysis.mockReturnValue({
            pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
        } as unknown as ReturnType<typeof VocalAnalysisHook.useVocalAnalysis>);

        mockUseAuthProvider.mockReturnValue({
            session: { user: { id: 'test-user' } },
        } as unknown as AuthProvider.AuthContextType);

        mockUseUsageLimit.mockReturnValue({
            data: { can_start: true, remaining_seconds: 1800, limit_seconds: 1800, is_pro: false },
            isLoading: false,
        } as unknown as ReturnType<typeof UsageLimitHook.useUsageLimit>);
    });

    it('should disable Pro options (Private, Cloud) for Free users', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });

        // Mock Free User via Lifecycle Hook
        mockUseSessionLifecycle.mockReturnValue({
            ...mockUseSessionLifecycle(),
            isProUser: false
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        // Open dropdown using userEvent
        const trigger = screen.getByText('Native Browser'); // Initial label
        await user.click(trigger);

        // Radix UI renders content in a specific way, userEvent should handle it.
        // Wait for items to appear - Free users see "Private (Pro)" and "Cloud (Pro)"
        // Using regex with ignoreCase to be more resilient to styling (uppercase etc)
        const onDeviceItem = await screen.findByText(/Private/i);
        const cloudItem = await screen.findByText(/Cloud/i);

        expect(onDeviceItem.closest('[role="menuitemradio"]')).toHaveAttribute('aria-disabled', 'true');
        expect(cloudItem.closest('[role="menuitemradio"]')).toHaveAttribute('aria-disabled', 'true');
    });

    it('should enable options for Pro users', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });

        // Mock Pro User via Lifecycle Hook
        mockUseSessionLifecycle.mockReturnValue({
            ...mockUseSessionLifecycle(),
            isProUser: true,
            mode: 'native' // Explicitly start with native to match trigger text
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        const trigger = screen.getByText('Native Browser');
        await user.click(trigger);

        // Find items in the dropdown
        const onDeviceItem = await screen.findByTestId('stt-mode-private');
        const cloudItem = await screen.findByTestId('stt-mode-cloud');

        expect(onDeviceItem).not.toHaveAttribute('aria-disabled', 'true');
        expect(cloudItem).not.toHaveAttribute('aria-disabled', 'true');
    });
});
