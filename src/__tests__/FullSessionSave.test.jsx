import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SessionPage } from '../pages/SessionPage';
import { AuthContext } from '../contexts/AuthContext';
import { SessionProvider } from '../contexts/SessionContext';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import * as useSpeechRecognition from '../hooks/useSpeechRecognition';
import * as storage from '../lib/storage';
import '@testing-library/jest-dom';

// Mock the navigate function
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('Full Session Save and Navigate Flow', () => {
    const mockUser = { id: 'test-user-123', is_anonymous: false };
    const mockProfile = { id: 'test-user-123', subscription_status: 'pro' };
    const mockAuthContextValue = {
        user: mockUser,
        profile: mockProfile,
        session: {},
        loading: false,
        signOut: async () => {},
    };

    it('should save the session and navigate to analytics when "Go to Analytics" is clicked', async () => {
        // Mock useSpeechRecognition
        const mockStopListening = vi.fn().mockResolvedValue({ transcript: 'test transcript', filler_words: {} });
        vi.spyOn(useSpeechRecognition, 'useSpeechRecognition').mockReturnValue({
            isListening: true,
            isReady: true,
            startListening: vi.fn(),
            stopListening: mockStopListening,
            reset: vi.fn(),
        });

        // Mock the database save function
        const mockSavedSession = { id: 'new-session-789', duration: 10, transcript: 'test transcript' };
        vi.spyOn(storage, 'saveSession').mockResolvedValue({ session: mockSavedSession, usageExceeded: false });
        vi.spyOn(storage, 'getSessionHistory').mockResolvedValue([]);

        // Mock Stripe.js
        const stripePromise = loadStripe('pk_test_TYooMQauvdEDq54NiTphI7jx');

        render(
            <MemoryRouter>
                <AuthContext.Provider value={mockAuthContextValue}>
                    <SessionProvider>
                        <Elements stripe={stripePromise}>
                            <SessionPage />
                        </Elements>
                    </SessionProvider>
                </AuthContext.Provider>
            </MemoryRouter>
        );

        // Find and click the "Stop Session" button
        const stopButton = screen.getByText('Stop Session');
        await act(async () => {
            fireEvent.click(stopButton);
        });

        // The dialog should appear. Find and click "Go to Analytics"
        const goToAnalyticsButton = await screen.findByText('Go to Analytics');
        await act(async () => {
            fireEvent.click(goToAnalyticsButton);
        });

        // Assertions
        expect(storage.saveSession).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/analytics/new-session-789');
    });
});
