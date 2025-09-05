import React from 'react';
import { render, screen, fireEvent, act } from '../../../test/test-utils';
import { vi } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';
import { useAuth } from '../../../contexts/AuthContext';

// Mocks
vi.mock('../../../contexts/AuthContext');
vi.mock('@stripe/react-stripe-js', () => ({
    Elements: ({ children }) => <div>{children}</div>,
    useStripe: () => ({
        redirectToCheckout: vi.fn(),
    }),
}));


describe('SessionSidebar', () => {
    let mockStartListening;
    let mockStopListening;
    let mockReset;
    let mockSaveSession;
    let defaultProps;

    beforeEach(() => {
        vi.clearAllMocks();

        mockStartListening = vi.fn();
        mockStopListening = vi.fn().mockResolvedValue({ transcript: 'test transcript' });
        mockReset = vi.fn();
        mockSaveSession = vi.fn().mockResolvedValue({ id: 'new-session-id' });

        useAuth.mockReturnValue({
            user: { id: '123' },
            profile: { subscription_status: 'pro' },
        });

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

    it('renders the initial state correctly', () => {
        render(<SessionSidebar {...defaultProps} />);
        expect(screen.getByText('Start Session')).toBeInTheDocument();
        expect(screen.getByText('Native Browser')).toBeInTheDocument();
    });

    it('calls reset and startListening when the start button is clicked', async () => {
        render(<SessionSidebar {...defaultProps} />);
        const startButton = screen.getByText('Start Session');
        await act(async () => {
            fireEvent.click(startButton);
        });
        expect(mockReset).toHaveBeenCalled();
        expect(mockStartListening).toHaveBeenCalled();
    });

    it('displays the timer and stop button when session is active', () => {
        const activeProps = {
            ...defaultProps,
            isListening: true,
            elapsedTime: 123,
        };
        render(<SessionSidebar {...activeProps} />);
        expect(screen.getByText('Session Active')).toBeInTheDocument();
        expect(screen.getByText('02:03')).toBeInTheDocument();
        expect(screen.getByText('Stop Session')).toBeInTheDocument();
    });

    it('calls stopListening and shows end session dialog', async () => {
        const activeProps = {
            ...defaultProps,
            isListening: true,
        };
        render(<SessionSidebar {...activeProps} />);

        const stopButton = screen.getByText('Stop Session');
        await act(async () => {
            fireEvent.click(stopButton);
        });

        expect(mockStopListening).toHaveBeenCalled();
        expect(screen.getByText('Session Ended')).toBeInTheDocument();
    });

    it('shows upgrade prompt for non-pro users', () => {
        useAuth.mockReturnValue({
            user: { id: '123' },
            profile: { subscription_status: 'free' },
        });
        render(<SessionSidebar {...defaultProps} />);
        expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
    });

    it('does not show upgrade prompt for pro users', () => {
        render(<SessionSidebar {...defaultProps} />);
        expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
    });
});
