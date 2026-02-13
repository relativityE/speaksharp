import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';
import logger from '../../lib/logger';

// Mock logger to avoid console spam and verify calls
vi.mock('../../lib/logger', () => ({
    default: {
        error: vi.fn(),
    },
}));

// Mock ErrorDisplay to avoid alias resolution issues in test environment
vi.mock('../ErrorDisplay', () => ({
    ErrorDisplay: () => <div data-testid="mock-error-display">Mock Error Display</div>
}));

// Component that throws an error for testing
const Bomb = ({ message }: { message: string }) => {
    throw new Error(message);
};

describe('ErrorBoundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render children when no error occurs', () => {
        render(
            <ErrorBoundary>
                <div>Safe Content</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Safe Content')).toBeInTheDocument();
    });

    it('should render fallback UI when a child throws', () => {
        const errorMsg = 'Test Error Explosion';

        render(
            <ErrorBoundary>
                <Bomb message={errorMsg} />
            </ErrorBoundary>
        );

        // Verify fallback UI structure
        expect(screen.getByText('Oops! Something went wrong.')).toBeInTheDocument();
        expect(screen.getByTestId('mock-error-display')).toBeInTheDocument();

        // Verify logger was called
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.any(Error),
            }),
            "Uncaught error:"
        );
    });
});
