// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusNotificationBar } from '../StatusNotificationBar';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../../stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));

describe('StatusNotificationBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('displays the padlock icon (Vault Mode) when active engine is private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'private',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        // Check for the padlock title or icon
        const padlock = screen.getByTitle(/Vault Mode: On-Device Processing/i);
        expect(padlock).toBeDefined();
    });

    it('does NOT display the padlock icon when active engine is NOT private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        expect(screen.queryByTitle(/Vault Mode: On-Device Processing/i)).toBeNull();
    });

    it('uses neutral styling for ready state instead of a full green alert band', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                isListening: false,
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'ready', message: 'Mic ready' }} />);

        const statusBar = screen.getByTestId('live-session-header');
        expect(statusBar).toHaveClass('bg-card', 'border-[hsl(var(--border-strong))]');
        expect(statusBar).not.toHaveClass('bg-emerald-50', 'border-emerald-200');
    });

    it('replaces generic error copy with actionable recording recovery copy', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                isListening: false,
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'error', message: 'Error occurred' }} />);

        expect(screen.queryByText(/^Error occurred$/i)).toBeNull();
        expect(screen.getByText(/Recording could not start/i)).toBeDefined();
    });

    it('keeps Private download progress visible without overloading the status copy', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'downloading', message: 'Downloading private model... 35%', progress: 35 }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Downloading private model/i);
        expect(screen.queryByText(/choose Browser, or Cloud if included in your plan/i)).toBeNull();
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('Private Model');
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('35%');
    });

    it('keeps the status bar read-only for Private setup prompts', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'download-required', message: 'Private model needs a one-time download.' }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Private model required/i);
        expect(screen.getByText(/Download once to use private local transcription/i)).toBeInTheDocument();
        expect(screen.queryByTestId('status-download-model-button')).toBeNull();
    });

    it('hides the Private setup action once setup progress exists', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'download-required', message: 'Private model needs a one-time download.', progress: 100 }} />);

        expect(screen.queryByTestId('status-download-model-button')).toBeNull();
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('Complete');
    });

    it('shows Private initialized state and far-right complete progress without extra guidance copy', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'ready', message: 'Private ready. Nothing leaves your browser.', progress: 100 }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Private ready/i);
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('Complete');
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('100%');
    });
});
