import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';

// Mocks
const mockSupabase = {
    functions: {
        invoke: vi.fn(),
    },
};

vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => mockSupabase,
}));

vi.mock('@/lib/logger', () => ({
    default: {
        error: vi.fn(),
    },
}));

const mockSuggestionsData = {
    summary: 'Good job!',
    suggestions: [
        { title: 'Clarity', description: 'Speak more clearly.' },
        { title: 'Pace', description: 'Slow down a bit.' },
    ],
};

describe('AISuggestions', () => {
    it('renders the initial state with a disabled button when there is no transcript', () => {
        render(<AISuggestions transcript="" />);
        expect(screen.getByText('AI-Powered Suggestions')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get Suggestions' })).toBeDisabled();
    });

    it('fetches and displays suggestions when the button is clicked', async () => {
        // Corrected Mock: The function returns an object, and the component expects to find the suggestions *inside* a `suggestions` key within that object.
        vi.mocked(mockSupabase.functions.invoke).mockResolvedValue({
            data: { suggestions: mockSuggestionsData },
            error: null
        });

        render(<AISuggestions transcript="This is a test transcript." />);
        const button = screen.getByRole('button', { name: 'Get Suggestions' });
        fireEvent.click(button);

        // Check for loading state text, which is different from the button text
        expect(screen.getByText('Analyzing your speech...')).toBeInTheDocument();

        await waitFor(() => {
            // Corrected Query: Use a regex to find the summary text, ignoring the surrounding quotes.
            expect(screen.getByText(/Good job!/)).toBeInTheDocument();
        });

        expect(screen.getByText('Clarity')).toBeInTheDocument();
        expect(screen.getByText('Speak more clearly.')).toBeInTheDocument();
    });

    it('displays an error message when fetching suggestions fails', async () => {
        const mockError = new Error('Failed to fetch suggestions');
        vi.mocked(mockSupabase.functions.invoke).mockResolvedValue({ data: null, error: mockError });

        render(<AISuggestions transcript="This is a test transcript." />);
        const button = screen.getByRole('button', { name: 'Get Suggestions' });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText('Error')).toBeInTheDocument();
        });

        expect(screen.getByText('Failed to fetch suggestions')).toBeInTheDocument();
    });
});
