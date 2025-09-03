import React from 'react';
import { render, act, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useSessionManager } from '../hooks/useSessionManager';
import { SessionProvider, useSession } from '../contexts/SessionContext';
import { AuthContext } from '../contexts/AuthContext';
import * as storage from '../lib/storage';
import '@testing-library/jest-dom';

// Test component to trigger the hooks
const TestComponent = () => {
    const { saveSession } = useSessionManager();
    const { sessionHistory, addSession } = useSession();

    const handleSave = async () => {
        const mockSessionData = { duration: 123, transcript: 'hello world' };
        const newSession = await saveSession(mockSessionData);
        if (newSession) {
            addSession(newSession);
        }
    };

    return (
        <div>
            <button onClick={handleSave}>Save Session</button>
            <div data-testid="history-length">{sessionHistory.length}</div>
            {sessionHistory.length > 0 && (
                <div data-testid="first-session-id">{sessionHistory[0].id}</div>
            )}
        </div>
    );
};

describe('Session Data Flow Integration Test', () => {
    const mockUser = { id: 'test-user-123', is_anonymous: false };
    const mockProfile = { id: 'test-user-123', subscription_status: 'pro' };
    const mockAuthContextValue = {
        user: mockUser,
        profile: mockProfile,
        session: {},
        loading: false,
        signOut: async () => {},
    };

    it('should correctly save a session and update the global session history', async () => {
        // Mock the database save function from storage.js
        const mockSavedSession = { id: 'new-session-456', duration: 123, transcript: 'hello world', user_id: mockUser.id };
        vi.spyOn(storage, 'saveSession').mockResolvedValue({ session: mockSavedSession, usageExceeded: false });

        // Mock getSessionHistory to avoid initial load interference
        vi.spyOn(storage, 'getSessionHistory').mockResolvedValue([]);

        render(
            <AuthContext.Provider value={mockAuthContextValue}>
                <SessionProvider>
                    <TestComponent />
                </SessionProvider>
            </AuthContext.Provider>
        );

        // Initially, history should be empty
        expect(screen.getByTestId('history-length')).toHaveTextContent('0');

        // Simulate saving a session
        const saveButton = screen.getByText('Save Session');
        await act(async () => {
            saveButton.click();
        });

        // After saving, history should have 1 item
        expect(screen.getByTestId('history-length')).toHaveTextContent('1');

        // The item in history should be the full session object, not just an ID
        expect(screen.getByTestId('first-session-id')).toHaveTextContent('new-session-456');
    });
});
