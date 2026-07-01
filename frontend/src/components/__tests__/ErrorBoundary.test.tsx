import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import ErrorBoundary from '../ErrorBoundary';
import logger from '../../lib/logger';
import * as Sentry from '@sentry/react';

vi.mock('@sentry/react', () => ({
    withScope: (cb: (scope: { setTag: () => void; setContext: () => void }) => void) =>
        cb({ setTag: vi.fn(), setContext: vi.fn() }),
    captureException: vi.fn(),
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

        // Verify fallback UI structure (recoverable: Try again + Go Home)
        expect(screen.getByText('Oops! Something went wrong.')).toBeInTheDocument();
        expect(screen.getByText('The page hit a temporary problem. Try again, or go home and reopen the page.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
        expect(screen.queryByText(errorMsg)).not.toBeInTheDocument();

        // Verify logger was called
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.any(Error),
            }),
            "Uncaught error:"
        );

        // Verify the crash is now REPORTED to Sentry (previously it was only logged locally -> invisible)
        expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    });
});
