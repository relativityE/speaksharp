import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CustomVocabularyManager } from '@/components/session/CustomVocabularyManager';
import { AuthContext, AuthContextType } from '@/contexts/AuthProvider';
import { useCustomVocabulary } from '@/hooks/useCustomVocabulary';
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

vi.mock('@/hooks/useCustomVocabulary');

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
const mockValidateWord = vi.fn();
const mockRemoveWord = vi.fn().mockResolvedValue(undefined);

describe('CustomVocabularyManager Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
        mockAuthContextValue.user = null;
        mockValidateWord.mockReturnValue(null); // No error by default
    });

    afterEach(() => {
        cleanup();
        if (global.gc) {
            global.gc();
        }
    });

    describe('Anonymous User', () => {
        beforeEach(() => {
            mockAuthContextValue.user = null;

            // Mock non-Pro user
            vi.mocked(useUserProfile).mockReturnValue({
                data: { subscription_status: 'free' } as any,
                isLoading: false,
                error: null,
            } as any);

            vi.mocked(useCustomVocabulary).mockReturnValue({
                vocabulary: [],
                vocabularyWords: [],
                isLoading: false,
                error: null,
                addWord: mockAddWord,
                removeWord: mockRemoveWord,
                isAdding: false,
                isRemoving: false,
                addError: null,
                removeError: null,
            });
        });

        it('shows sign-in message for anonymous users', () => {
            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            // Should show Pro upgrade prompt for non-Pro users
            expect(screen.getByText(/Custom Vocabulary \(Pro\)/i)).toBeInTheDocument();
            expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument();
        });

        it('does not allow adding words when not signed in', () => {
            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            const addButton = screen.queryByRole('button', { name: /add word/i });
            expect(addButton).toBeNull();
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

            vi.mocked(useCustomVocabulary).mockReturnValue({
                vocabulary: [
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
                addError: null,
                removeError: null,
            });
        });

        it('displays existing vocabulary words', () => {
            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            expect(screen.getByText('blockchain')).toBeInTheDocument();
            expect(screen.getByText('kubernetes')).toBeInTheDocument();
        });

        it('allows adding a new custom word', async () => {
            const user = userEvent.setup();

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            const input = screen.getByPlaceholderText(/SpeakSharp/i);
            await user.type(input, 'microservices');

            const addButton = screen.getByRole('button', { name: '' }); // Icon-only button
            await user.click(addButton);

            await waitFor(() => {
                expect(mockAddWord).toHaveBeenCalledWith('microservices');
            });
        });

        it('validates word before adding', async () => {
            const user = userEvent.setup();
            mockValidateWord.mockReturnValue('Word must be at least 2 characters');

            vi.mocked(useCustomVocabulary).mockReturnValue({
                vocabulary: [{ id: '1', word: 'blockchain', user_id: 'test-user', created_at: new Date().toISOString() }],
                vocabularyWords: ['blockchain'],
                isLoading: false,
                error: null,
                addWord: mockAddWord,
                removeWord: mockRemoveWord,
                isAdding: false,
                isRemoving: false,
                addError: new Error('Word must be at least 2 characters'),
                removeError: null,
            });

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            const input = screen.getByPlaceholderText(/SpeakSharp/i);
            await user.type(input, 'a');

            const addButton = screen.getByRole('button', { name: '' });
            await user.click(addButton);

            // Should not call addWord due to validation error
            expect(mockAddWord).not.toHaveBeenCalled();

            // Should show error message
            expect(screen.getByText(/must be at least 2 characters/i)).toBeInTheDocument();
        });

        it('allows removing a custom word', async () => {
            const user = userEvent.setup();

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
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
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            const input = screen.getByPlaceholderText(/SpeakSharp/i) as HTMLInputElement;
            await user.type(input, 'devops');

            const addButton = screen.getByRole('button', { name: '' });
            await user.click(addButton);

            await waitFor(() => {
                expect(mockAddWord).toHaveBeenCalledWith('devops');
                expect(input.value).toBe('');
            });
        });
    });

    describe('Loading State', () => {
        it('shows loading skeleton while fetching vocabulary', () => {
            mockAuthContextValue.user = { id: 'test-user' } as any;
            vi.mocked(useCustomVocabulary).mockReturnValue({
                vocabulary: [],
                vocabularyWords: [],
                isLoading: true,
                error: null,
                addWord: mockAddWord,
                removeWord: mockRemoveWord,
                isAdding: false,
                isRemoving: false,
                addError: null,
                removeError: null,
            });

            render(
                <MockAuthProvider value={mockAuthContextValue}>
                    <CustomVocabularyManager />
                </MockAuthProvider>
            );

            // Should show loading indicator (pulse animations)
            expect(screen.queryByText('blockchain')).not.toBeInTheDocument();
        });
    });
});
