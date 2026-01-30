import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';
import React from 'react';

// A component that throws an error on render
const ThrowError = ({ message }: { message: string }) => {
    throw new Error(message);
};

describe('ErrorBoundary', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    it('should catch errors and display fallback UI', () => {
        render(
            <ErrorBoundary>
                <ThrowError message="Test Error" />
            </ErrorBoundary>
        );

        expect(screen.getByText(/Oops! Something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText(/Test Error/i)).toBeInTheDocument();
    });

    it('should reload the page when Refresh button is clicked', () => {
        const reloadMock = vi.fn();

        // Use vitest stubbing for window.location to avoid type errors
        vi.stubGlobal('location', {
            ...window.location,
            reload: reloadMock
        });

        render(
            <ErrorBoundary>
                <ThrowError message="Test Error" />
            </ErrorBoundary>
        );

        fireEvent.click(screen.getByRole('button', { name: /Refresh Page/i }));
        expect(reloadMock).toHaveBeenCalled();

        vi.unstubAllGlobals();
    });

    it('should render children when no error occurs', () => {
        render(
            <ErrorBoundary>
                <div>Safe Content</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Safe Content')).toBeInTheDocument();
        expect(screen.queryByText(/Oops! Something went wrong/i)).not.toBeInTheDocument();
    });
});
