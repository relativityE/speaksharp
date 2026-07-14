// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusNotificationBar } from '../StatusNotificationBar';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../../stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));

const mockStore = (overrides: Record<string, unknown> = {}) => {
    vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
        const state = { activeEngine: 'native', isListening: false, modelLoadingProgress: null, ...overrides };
        return typeof selector === 'function' ? selector(state) : state;
    });
};

const renderRouted = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('StatusNotificationBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('displays the padlock icon when active engine is private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'private',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        // Check for the padlock title or icon
        const padlock = screen.getByTitle(/Private transcription: on-device processing/i);
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

        expect(screen.queryByTitle(/Private transcription: on-device processing/i)).toBeNull();
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

        render(<StatusNotificationBar status={{ type: 'download-required', message: 'Private model setup required.' }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Private model required/i);
        expect(screen.getByText(/Set up the Private model in this browser/i)).toBeInTheDocument();
        expect(screen.getByText(/All audio processing remains local/i)).toBeInTheDocument();
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

        render(<StatusNotificationBar status={{ type: 'download-required', message: 'Private model setup required.', progress: 100 }} />);

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

    describe('post-save Analytics action (folded-in, single status bar)', () => {
        it('renders no action when analyticsAction is absent (default behaviour unchanged)', () => {
            mockStore();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved · Your final feedback is ready.' }} />);
            expect(screen.queryByTestId('post-save-review-session-link')).toBeNull();
            // Still exactly one status bar.
            expect(screen.getAllByTestId('live-session-header')).toHaveLength(1);
        });

        it('labels the action exactly "Analytics" (not "Check out Analytics"/"View analytics") with an aria-hidden arrow', () => {
            mockStore();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved · Your final feedback is ready.' }} analyticsAction={{}} />);
            const action = screen.getByTestId('post-save-review-session-link');
            // Accessible name is exactly "Analytics" — the arrow icon must not contribute text.
            expect(action).toHaveAccessibleName('Analytics');
            expect(action).toHaveTextContent(/^Analytics$/);
            expect(screen.queryByText(/Check out Analytics/i)).toBeNull();
            expect(screen.queryByText(/View analytics/i)).toBeNull();
            // Destination is the existing /analytics route, not a new button.
            expect(action.tagName).toBe('A');
            expect(action).toHaveAttribute('href', '/analytics');
            expect(action.querySelector('[aria-hidden="true"]')).not.toBeNull();
            // One bar only.
            expect(screen.getAllByTestId('live-session-header')).toHaveLength(1);
        });

        it('pulse is bounded (~6.5s) then turns off on its own — never repeats indefinitely', () => {
            vi.useFakeTimers();
            try {
                mockStore();
                renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ pulse: true }} />);
                const action = screen.getByTestId('post-save-review-session-link');
                expect(action).toHaveAttribute('data-cue-active', 'true');
                expect(action.className).toMatch(/animate-pulse/);
                act(() => { vi.advanceTimersByTime(6600); });
                expect(action).toHaveAttribute('data-cue-active', 'false');
                expect(action.className).not.toMatch(/animate-pulse/);
            } finally {
                vi.useRealTimers();
            }
        });

        it('reduced-motion users get a static ring during the cue, not the pulse animation', () => {
            vi.useFakeTimers();
            try {
                mockStore();
                renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ pulse: true }} />);
                const action = screen.getByTestId('post-save-review-session-link');
                // Static emphasis is present during the cue and disabled for motion-reduce.
                expect(action.className).toMatch(/motion-reduce:ring-2/);
                expect(action.className).toMatch(/motion-reduce:animate-none/);
                // ...and clears on the same bounded interval.
                act(() => { vi.advanceTimersByTime(6600); });
                expect(action.className).not.toMatch(/motion-reduce:ring-2/);
            } finally {
                vi.useRealTimers();
            }
        });

        it('selecting the action stops the cue immediately and calls onSelect', () => {
            mockStore();
            const onSelect = vi.fn();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ pulse: true, onSelect }} />);
            const action = screen.getByTestId('post-save-review-session-link');
            expect(action).toHaveAttribute('data-cue-active', 'true');
            fireEvent.click(action);
            expect(onSelect).toHaveBeenCalledTimes(1);
            expect(action).toHaveAttribute('data-cue-active', 'false');
            expect(action.className).not.toMatch(/animate-pulse/);
        });
    });
});
