import React from 'react';
import { render, screen, fireEvent, waitFor } from '../test/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSession } from '../contexts/SessionContext';
import { useAuth } from '../contexts/AuthContext';
import { useSessionManager } from '../hooks/useSessionManager';
import * as storage from '../lib/storage';

// Mock dependencies
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useSessionManager');
vi.mock('../lib/storage');

// A component to display session state and trigger actions
const TestComponent = () => {
    const { sessionHistory, addSession } = useSession();
    const { saveSession } = useSessionManager();

    const handleSave = async () => {
        const newSessionData = { transcript: 'New test session' };
        const saved = await saveSession(newSessionData);
        if (saved) {
            addSession(saved);
        }
    };

    // Ensure sessionHistory is an array before mapping
    const history = Array.isArray(sessionHistory) ? sessionHistory : [];

    return (
        <div>
            <div data-testid="session-count">{history.length}</div>
            <button onClick={handleSave}>Save Session</button>
            <ul>
                {history.map(s => <li key={s.id}>{s.transcript}</li>)}
            </ul>
        </div>
    );
};

describe('Session Data Flow Integration', () => {
    let mockSaveSession;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSaveSession = vi.fn();
        useSessionManager.mockReturnValue({ saveSession: mockSaveSession });
        storage.getSessionHistory.mockResolvedValue({ sessions: [], error: null });
    });

    it('should correctly save a session for an authenticated user and update context', async () => {
        useAuth.mockReturnValue({ user: { id: 'auth-user-1' }, profile: { id: 'prof-1' } });
        const mockSavedSession = { id: 'session-1', transcript: 'New test session' };
        mockSaveSession.mockResolvedValue(mockSavedSession);

        render(<TestComponent />);

        // Wait for initial load to complete
        await waitFor(() => {
            expect(screen.getByTestId('session-count')).toHaveTextContent('0');
        });

        const saveButton = screen.getByText('Save Session');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(screen.getByTestId('session-count')).toHaveTextContent('1');
        });
        expect(screen.getByText('New test session')).toBeInTheDocument();
        expect(mockSaveSession).toHaveBeenCalledWith({ transcript: 'New test session' });
    });

    it('should create a temporary session for an anonymous user and update context', async () => {
        useAuth.mockReturnValue({ user: { id: 'anon-user-1', is_anonymous: true }, profile: null });
        const mockTempSession = { id: 'anonymous-session-xyz', transcript: 'New test session' };
        mockSaveSession.mockResolvedValue(mockTempSession);

        render(<TestComponent />);

        // Wait for initial load to complete
        await waitFor(() => {
            expect(screen.getByTestId('session-count')).toHaveTextContent('0');
        });

        const saveButton = screen.getByText('Save Session');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(screen.getByTestId('session-count')).toHaveTextContent('1');
        });
        expect(screen.getByText('New test session')).toBeInTheDocument();
        expect(mockSaveSession).toHaveBeenCalledWith({ transcript: 'New test session' });
    });
});
