import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserFillerWordsManager } from '@/components/session/UserFillerWordsManager';
import { AuthContext, AuthContextType } from '@/contexts/AuthProvider';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { useUserProfile } from '@/hooks/useUserProfile';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

// Mock AuthContext 
const mockAuthContextValue: Partial<AuthContextType> = {
    user: null,
    signOut: vi.fn(),
    loading: false,
    session: null,

};

const MockAuthProvider: React.FC<{ children: React.ReactNode; value: Partial<AuthContextType> }> = ({
    children,
    value,
}) => {
    return (
        <QueryClientProvider client={queryClient}>
            <AuthContext.Provider value={value as AuthContextType}>{children}</AuthContext.Provider>
        </QueryClientProvider>
    );
};

// Mock dependencies
vi.mock('@/contexts/AuthProvider', async () => {
    const actual = await vi.importActual('@/contexts/AuthProvider');
    return {
        ...(actual as object),
        useAuthProvider: () => mockAuthContextValue,
    };
});

vi.mock('@/hooks/useUserFillerWords');

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

const mockAddWord = vi.fn().mockResolvedValue(undefined);
const mockRemoveWord = vi.fn().mockResolvedValue(undefined);

describe('UserFillerWordsManager Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
        mockAuthContextValue.user = null;
    });

    afterEach(() => {
        cleanup();
        if (global.gc) {
            global.gc();
        }
    });

    describe('Free User', () => {
        beforeEach(() => {
            mockAuthContextValue.user = { id: 'free-user' } as any;

            // Mock non-Pro user
            vi.mocked(useUserProfile).mockReturnValue({
                data: { subscription_status: 'free' } as any,
                isLoading: false,
                error: null,
            } as any);

            vi.mocked(useUserFillerWords).mockReturnValue({
                fullVocabularyObjects: [],
                vocabularyWords: [],
                isLoading: false,
                error: null,
                addWord: mockAddWord,
                removeWord: mockRemoveWord,
                isAdding: false,
                isRemoving: false,
                count: 0,
                maxWords: 10,
                isPro: false
            });
        });

        it('shows user filler words manager for free users', () => {
            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            // Should show renamed title: 'User Filler Words'
            expect(screen.getByText(/^User Filler Words$/i)).toBeInTheDocument();
            expect(screen.queryByText(/upgrade to pro/i)).not.toBeInTheDocument();
        });

        it('allows adding words for free users', () => {
            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            const addButton = screen.getByRole('button', { name: /add word/i });
            expect(addButton).toBeInTheDocument();
        });
    });

    describe('Authenticated User', () => {
        beforeEach(() => {
            mockAuthContextValue.user = { id: 'test-user', email: 'test@example.com' } as any;

            // Mock Pro user
            vi.mocked(useUserProfile).mockReturnValue({
                data: { subscription_status: 'pro' } as any,
                isLoading: false,
                error: null,
            } as any);

            vi.mocked(useUserFillerWords).mockReturnValue({
                fullVocabularyObjects: [
                    { id: '1', word: 'blockchain', user_id: 'test-user', created_at: new Date().toISOString() },
                    { id: '2', word: 'kubernetes', user_id: 'test-user', created_at: new Date().toISOString() },
                ],
                vocabularyWords: ['blockchain', 'kubernetes'],
                isLoading: false,
                error: null,
                addWord: mockAddWord,
                removeWord: mockRemoveWord,
                isAdding: false,
                isRemoving: false,
                count: 2,
                maxWords: 100,
                isPro: true
            });
        });

        it('displays existing filler words', () => {
            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            expect(screen.getByText('blockchain')).toBeInTheDocument();
            expect(screen.getByText('kubernetes')).toBeInTheDocument();
        });

        it('allows adding a new user filler word', async () => {
            const user = userEvent.setup();

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            const input = screen.getByPlaceholderText(/literally/i); // Matches new placeholder
            await user.type(input, 'microservices');

            const addButton = screen.getByRole('button', { name: /add word/i });
            await user.click(addButton);

            await waitFor(() => {
                expect(mockAddWord).toHaveBeenCalledWith('microservices', expect.any(Object));
            });
        });



        it('allows removing a word', async () => {
            const user = userEvent.setup();

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            // Find and click remove button for first word
            const removeButtons = screen.getAllByRole('button', { name: /Remove blockchain/i });
            await user.click(removeButtons[0]);

            await waitFor(() => {
                expect(mockRemoveWord).toHaveBeenCalled();
            });
        });

        it('clears input after successful word addition', async () => {
            const user = userEvent.setup();

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            const input = screen.getByPlaceholderText(/literally/i) as HTMLInputElement;
            await user.type(input, 'devops');

            const addButton = screen.getByRole('button', { name: /add word/i });
            await user.click(addButton);

            await waitFor(() => {
                expect(mockAddWord).toHaveBeenCalledWith('devops', expect.any(Object));
            });

            // Simulate success callback
            const callArgs = mockAddWord.mock.calls[0];
            const options = callArgs[1] as { onSuccess: () => void };
            options.onSuccess();

            await waitFor(() => {
                expect(input.value).toBe('');
            });
        });
    });

    describe('Loading State', () => {
        it('shows loading skeleton while fetching', () => {
            mockAuthContextValue.user = { id: 'test-user' } as any;
            vi.mocked(useUserFillerWords).mockReturnValue({
                fullVocabularyObjects: [],
                vocabularyWords: [],
                isLoading: true,
                error: null,
                addWord: mockAddWord,
                removeWord: mockRemoveWord,
                isAdding: false,
                isRemoving: false,
                count: 0,
                maxWords: 100,
                isPro: true
            });

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <UserFillerWordsManager />
                </MockAuthProvider>
            );

            // Should show loading indicator (pulse animations) and not list items
            expect(screen.queryByText('blockchain')).not.toBeInTheDocument();
        });
    });
});
