import { render, screen } from '../../test/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionPage } from '../SessionPage';

// Since this page uses useSpeechRecognition hook internally,
// we need to make sure it's mocked to return some default values.
// The global setup in setup.tsx already does this, but we can override it if needed.

describe('SessionPage', () => {
    it('renders the session page with its key components', () => {
        const authMock = { user: { id: 'test-user' }, profile: { subscription_status: 'pro' }, loading: false };
        const sessionMock = { sessionHistory: [], loading: false, error: null };

        render(<SessionPage />, { authMock, sessionMock });

        // Check for the sidebar by looking for the start button
        expect(screen.getByRole('button', { name: /start session/i })).toBeInTheDocument();

        // Check for the transcript panel by looking for the initial "Ready to Go" state
        expect(screen.getByText("Ready to Go")).toBeInTheDocument();
    });
});
