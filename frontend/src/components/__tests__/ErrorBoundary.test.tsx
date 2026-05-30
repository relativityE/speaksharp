import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import ErrorBoundary from '../ErrorBoundary';
import logger from '../../lib/logger';

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
        expect(screen.getByText('The page hit a temporary problem. Go home, then open the page again.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
        expect(screen.queryByText(errorMsg)).not.toBeInTheDocument();

        // Verify logger was called
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.any(Error),
            }),
            "Uncaught error:"
        );
    });
});
