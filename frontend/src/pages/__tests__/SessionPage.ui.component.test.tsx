import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderWithAllProviders as render } from '../../../tests/support/test-utils/render';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionPage } from '../SessionPage';
import { TEST_IDS } from '@/constants/testIds';
import * as UsageLimitHook from '@/hooks/useUsageLimit';
import * as SessionStore from '@/stores/useSessionStore';
import * as VocalAnalysisHook from '@/hooks/useVocalAnalysis';
import * as AuthProvider from '@/contexts/AuthProvider';
import { createTestSessionStore } from '../../../tests/unit/factories/storeFactory';

// ARCHITECTURE: Mock useSessionLifecycle to strictly unit test the View
vi.mock('@/hooks/useSessionLifecycle');
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
const mockUseSessionLifecycle = vi.mocked(useSessionLifecycle);

// Mock dependencies
vi.mock('@/hooks/useSpeechRecognition');
vi.mock('@/stores/useSessionStore');
vi.mock('@/hooks/useVocalAnalysis');
vi.mock('@/contexts/AuthProvider');
vi.mock('@/hooks/useUserProfile');
vi.mock('@/hooks/useUsageLimit');
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/providers/useTranscriptionContext', () => ({
    useTranscriptionContext: vi.fn(() => ({ service: { warmUp: vi.fn(), destroy: vi.fn(), getState: vi.fn().mockReturnValue('IDLE') } })),
}));
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

const mockUseUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);
const mockUseSessionStore = vi.mocked(SessionStore.useSessionStore);
const mockUseVocalAnalysis = vi.mocked(VocalAnalysisHook.useVocalAnalysis);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

// Stable base mock to avoid destructuring undefined
const DEFAULT_LIFECYCLE_MOCK = {
    isListening: false,
    isReady: true,
    isProUser: false,
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
};

describe('SessionPage - STT Mode Selection UI', () => {

    beforeEach(() => {
        vi.clearAllMocks();

        mockUseSessionLifecycle.mockReturnValue(DEFAULT_LIFECYCLE_MOCK as unknown as ReturnType<typeof useSessionLifecycle>);

        (mockUseSessionStore as unknown as Mock).mockImplementation(createTestSessionStore({
            elapsedTime: 0,
        }));

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

        mockUseSessionLifecycle.mockReturnValue({
            ...DEFAULT_LIFECYCLE_MOCK,
            isProUser: false
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        const trigger = screen.getByText(/Native/i);
        await user.click(trigger);

        const onDeviceItem = await screen.findByText(/Private/i);
        const cloudItem = await screen.findByText(/Cloud/i);

        expect(onDeviceItem.closest('[role="menuitemradio"]')).toHaveAttribute('aria-disabled', 'true');
        expect(cloudItem.closest('[role="menuitemradio"]')).toHaveAttribute('aria-disabled', 'true');
    });

    it('should enable options for Pro users', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });

        mockUseSessionLifecycle.mockReturnValue({
            ...DEFAULT_LIFECYCLE_MOCK,
            isProUser: true
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        const trigger = screen.getByText(/Native/i);
        await user.click(trigger);

        const onDeviceItem = await screen.findByText(/Private/i);
        const cloudItem = await screen.findByText(/Cloud/i);

        expect(onDeviceItem.closest('[role="menuitemradio"]')).not.toHaveAttribute('aria-disabled', 'true');
        expect(cloudItem.closest('[role="menuitemradio"]')).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('should correctly trigger mode change', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const setModeSpy = vi.fn();

        mockUseSessionLifecycle.mockReturnValue({
            ...DEFAULT_LIFECYCLE_MOCK,
            isProUser: true,
            setMode: setModeSpy
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        const trigger = await screen.findByTestId(TEST_IDS.STT_MODE_SELECT);
        await user.click(trigger);

        const privateItem = await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);
        await user.click(privateItem);

        expect(setModeSpy).toHaveBeenCalledWith('private');
    });
});
