import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { SessionPage } from '../SessionPage';
import * as UserProfileHook from '@/hooks/useUserProfile';
import * as UsageLimitHook from '@/hooks/useUsageLimit';
import * as SpeechRecognitionHook from '../../hooks/useSpeechRecognition';
import * as SessionStore from '../../stores/useSessionStore';
import * as VocalAnalysisHook from '../../hooks/useVocalAnalysis';
import * as AuthProvider from '../../contexts/AuthProvider';

// Mock dependencies
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
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
vi.mock('@/components/session/PauseMetricsDisplay', () => ({ PauseMetricsDisplay: () => <div>Pause Metrics</div> }));
vi.mock('@/components/session/CustomVocabularyManager', () => ({ CustomVocabularyManager: () => <div>Custom Vocabulary</div> }));

// Helper to render with router
const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
};

const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);
const mockUseUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);
const mockUseSpeechRecognition = vi.mocked(SpeechRecognitionHook.useSpeechRecognition);
const mockUseSessionStore = vi.mocked(SessionStore.useSessionStore);
const mockUseVocalAnalysis = vi.mocked(VocalAnalysisHook.useVocalAnalysis);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

describe('SessionPage - STT Mode Selection UI', () => {

    beforeEach(() => {
        vi.clearAllMocks();

        // Default mocks needed for render
        mockUseSpeechRecognition.mockReturnValue({
            transcript: { transcript: '', confidence: 0, isFinal: false },
            fillerData: {},
            startListening: vi.fn(),
            stopListening: vi.fn(),
            isListening: false,
            isReady: true,
            modelLoadingProgress: null,
            error: null,
            resetTranscript: vi.fn(),
        } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

        mockUseSessionStore.mockReturnValue({
            elapsedTime: 0,
            updateElapsedTime: vi.fn(),
            resetSession: vi.fn(),
        } as unknown as ReturnType<typeof SessionStore.useSessionStore>);

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

    it('should disable Pro options (On-Device, Cloud) for Free users', async () => {
        const user = userEvent.setup();

        // Mock Free User
        mockUseUserProfile.mockReturnValue({
            data: { id: 'test-profile', subscription_status: 'free' },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

        renderWithRouter(<SessionPage />);

        // Open dropdown using userEvent
        const trigger = screen.getByText('Native'); // Initial label
        await user.click(trigger);

        // Radix UI renders content in a specific way, userEvent should handle it.
        // Wait for items to appear
        const onDeviceItem = await screen.findByText(/Private.*\(Whisper\)/);
        const cloudItem = await screen.findByText(/Cloud.*\(Pro\)/);

        expect(onDeviceItem).toHaveAttribute('aria-disabled', 'true');
        expect(cloudItem).toHaveAttribute('aria-disabled', 'true');
    });

    it('should enable options for Pro users', async () => {
        const user = userEvent.setup();

        // Mock Pro User
        mockUseUserProfile.mockReturnValue({
            data: { id: 'test-profile', subscription_status: 'pro' },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

        renderWithRouter(<SessionPage />);

        const trigger = screen.getByText('Native');
        await user.click(trigger);

        // Note: When enabled, the text matches exactly "Private (Whisper)"
        const onDeviceItem = await screen.findByText('Private (Whisper)');
        const cloudItem = await screen.findByText('Cloud (AssemblyAI)');

        expect(onDeviceItem).not.toHaveAttribute('aria-disabled', 'true');
        expect(cloudItem).not.toHaveAttribute('aria-disabled', 'true');
    });
});
