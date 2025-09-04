import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionPage } from '../pages/SessionPage';
import { AuthContext } from '../contexts/AuthContext';
import { SessionProvider, useSession } from '../contexts/SessionContext';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';
import * as storage from '../lib/storage';

// Mock dependencies
vi.mock('../hooks/useSpeechRecognition');
vi.mock('../hooks/useSessionManager');
vi.mock('../lib/storage');
vi.mock('../contexts/SessionContext');

describe('Full Session Save and Navigate Flow', () => {
    let mockUseSpeechRecognition;
    let mockUseSessionManager;
    let mockAuthContextValue;
    let mockUseSession;

    beforeEach(() => {
        vi.clearAllMocks();

        mockUseSpeechRecognition = {
            isListening: false,
            isReady: true,
            transcript: 'This is a full session transcript.',
            interimTranscript: '',
            fillerData: { um: { count: 2 } },
            wordCount: 6,
            wpm: 120,
            accuracy: 0.95,
            error: null,
            isSupported: true,
            startListening: vi.fn(),
            stopListening: vi.fn(),
            reset: vi.fn(),
        };
        useSpeechRecognition.mockReturnValue(mockUseSpeechRecognition);

        mockUseSessionManager = {
            saveSession: vi.fn(),
        };
        useSessionManager.mockReturnValue(mockUseSessionManager);

        mockAuthContextValue = {
            user: { id: 'test-user-123', is_anonymous: false },
            profile: { id: 'test-user-123', subscription_status: 'pro' },
            loading: false,
        };

        mockUseSession = {
            sessionHistory: [],
            addSession: vi.fn(),
        };
        useSession.mockReturnValue(mockUseSession);

        storage.getSessionHistory.mockResolvedValue({ sessions: [], error: null });
    });

    it('should save the session and navigate to analytics when "Go to Analytics" is clicked', async () => {
        const mockSavedSession = { id: 'session-123', transcript: 'This is a full session transcript.' };
        mockUseSessionManager.saveSession.mockResolvedValue(mockSavedSession);

        render(
            <MemoryRouter initialEntries={['/session']}>
                <AuthContext.Provider value={mockAuthContextValue}>
                    <SessionProvider>
                        <Routes>
                            <Route path="/session" element={<SessionPage />} />
                            <Route path="/analytics/:sessionId" element={<div data-testid="analytics-page" />} />
                        </Routes>
                    </SessionProvider>
                </AuthContext.Provider>
            </MemoryRouter>
        );

        const goToAnalyticsButton = screen.getByRole('button', { name: /go to analytics/i });
        fireEvent.click(goToAnalyticsButton);

        await waitFor(() => {
            expect(mockUseSessionManager.saveSession).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
        });
    });
});
