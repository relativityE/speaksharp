import React from 'react';
import { render, screen, fireEvent, waitFor } from '../test/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionPage } from '../pages/SessionPage';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';

// Mock dependencies
vi.mock('../hooks/useSpeechRecognition');
vi.mock('../hooks/useSessionManager');
vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SessionContext');

// Mock the entire stripe module as it's a dependency of SessionPage->SessionSidebar
vi.mock('@stripe/react-stripe-js', () => ({
    Elements: ({ children }) => <div>{children}</div>,
    useStripe: () => ({
        redirectToCheckout: vi.fn(),
    }),
}));

describe('Full Session Save and Navigate Flow', () => {
    let mockStopListening;
    let mockSaveSession;

    beforeEach(() => {
        vi.clearAllMocks();

        mockStopListening = vi.fn().mockResolvedValue({
            transcript: 'This is a full session transcript.',
            filler_words: { um: { count: 2 } },
            word_count: 6,
            words_per_minute: 120,
            accuracy: 0.95,
        });

        useSpeechRecognition.mockReturnValue({
            isListening: true,
            isReady: true,
            error: null,
            startListening: vi.fn(),
            stopListening: mockStopListening,
            reset: vi.fn(),
        });

        mockSaveSession = vi.fn();
        useSessionManager.mockReturnValue({
            saveSession: mockSaveSession,
        });

        useAuth.mockReturnValue({
            user: { id: 'test-user-123', is_anonymous: false },
            profile: { id: 'test-user-123', subscription_status: 'pro' },
            loading: false,
        });

        useSession.mockReturnValue({
            sessionHistory: [],
            addSession: vi.fn(),
        });
    });

    it('should save the session and navigate to analytics when "Go to Analytics" is clicked', async () => {
        const mockSavedSession = { id: 'session-123', transcript: 'This is a full session transcript.' };
        mockSaveSession.mockResolvedValue(mockSavedSession);

        const mockNavigate = vi.fn();
        vi.mock('react-router-dom', async () => {
            const original = await vi.importActual('react-router-dom');
            return {
                ...original,
                useNavigate: () => mockNavigate,
            };
        });

        render(<SessionPage />);

        // Simulate clicking the "Stop Session" button
        const stopButton = screen.getByRole('button', { name: /stop session/i });
        fireEvent.click(stopButton);

        // Wait for the end-of-session dialog to appear
        const dialogTitle = await screen.findByText('Session Ended');
        expect(dialogTitle).toBeInTheDocument();

        // Click the "Go to Analytics" button in the dialog
        const goToAnalyticsButton = screen.getByRole('button', { name: /go to analytics/i });
        fireEvent.click(goToAnalyticsButton);

        // Assert that saveSession was called and navigation occurred
        await waitFor(() => {
            expect(mockSaveSession).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/analytics/session-123');
        });
    });
});
