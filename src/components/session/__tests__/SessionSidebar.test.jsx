import React from 'react';
import { render, screen, fireEvent } from '../../../test/test-utils';
import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';

describe('SessionSidebar', () => {
    let mockStartListening;
    let mockStopListening;
    let mockReset;
    let mockSaveSession;
    let defaultProps;
    let proAuthMock;
    let freeAuthMock;

    beforeEach(() => {
        mockStartListening = vi.fn();
        mockStopListening = vi.fn().mockResolvedValue({ transcript: 'test transcript' });
        mockReset = vi.fn();
        mockSaveSession = vi.fn().mockResolvedValue({ id: 'new-session-id' });

        proAuthMock = {
            user: { id: '123' },
            profile: { subscription_status: 'pro' },
            loading: false,
        };

        freeAuthMock = {
            user: { id: '456' },
            profile: { subscription_status: 'free' },
            loading: false,
        };

        defaultProps = {
            isListening: false,
            isReady: true,
            error: null,
            startListening: mockStartListening,
            stopListening: mockStopListening,
            reset: mockReset,
            actualMode: 'native',
            saveSession: mockSaveSession,
            elapsedTime: 0,
            modelLoadingProgress: { status: 'ready' },
        };
    });

    // These tests pass with fake timers
    it('renders the initial state correctly', () => {
        render(<SessionSidebar {...defaultProps} />, { authMock: proAuthMock });
        expect(screen.getByRole('button', { name: /start session/i })).toBeInTheDocument();
        expect(screen.getByText('Native Browser')).toBeInTheDocument();
    });

    it('calls reset and startListening when the start button is clicked', async () => {
        render(<SessionSidebar {...defaultProps} />, { authMock: proAuthMock });
        const startButton = screen.getByRole('button', { name: /start session/i });
        fireEvent.click(startButton);
        expect(mockReset).toHaveBeenCalled();
        expect(mockStartListening).toHaveBeenCalled();
    });

    it('displays the timer and stop button when session is active', () => {
        const activeProps = {
            ...defaultProps,
            isListening: true,
            elapsedTime: 123,
        };
        render(<SessionSidebar {...activeProps} />, { authMock: proAuthMock });
        expect(screen.getByText(/session active/i)).toBeInTheDocument();
        expect(screen.getByText('02:03')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /stop session/i })).toBeInTheDocument();
    });

    it('shows upgrade prompt for non-pro users', () => {
        render(<SessionSidebar {...defaultProps} />, { authMock: freeAuthMock });
        expect(screen.getByRole('heading', { name: /upgrade to pro/i })).toBeInTheDocument();
    });

    it('does not show upgrade prompt for pro users', () => {
        render(<SessionSidebar {...defaultProps} />, { authMock: proAuthMock });
        expect(screen.queryByRole('heading', { name: /upgrade to pro/i })).not.toBeInTheDocument();
    });

    // This test was timing out. Let's run it with real timers.
    describe('with real timers', () => {
        beforeAll(() => {
            vi.useRealTimers();
        });

        afterAll(() => {
            vi.useFakeTimers();
        });

        it('calls stopListening and shows end session dialog', async () => {
            const activeProps = {
                ...defaultProps,
                isListening: true,
            };
            render(<SessionSidebar {...activeProps} />, { authMock: proAuthMock });

            const stopButton = screen.getByRole('button', { name: /stop session/i });
            fireEvent.click(stopButton);

            expect(await screen.findByText('Session Ended', {}, { timeout: 5000 })).toBeInTheDocument();
            expect(mockStopListening).toHaveBeenCalled();
        });
    });
});
