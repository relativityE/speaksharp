import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalErrorBoundary } from '../LocalErrorBoundary';
import logger from '../../lib/logger';
import * as Sentry from '@sentry/react';

// Mock Logger
vi.mock('../../lib/logger', () => ({
    default: {
        error: vi.fn(),
    },
}));

// Mock Sentry
const mockScope = {
    setTag: vi.fn(),
    setContext: vi.fn(),
    setExtra: vi.fn(),
};

vi.mock('@sentry/react', () => ({
    withScope: vi.fn((callback: (scope: unknown) => void) => callback(mockScope)),
    captureException: vi.fn(),
}));

// Test Component that throws
const Bomb = ({ message = 'KABOOM' }: { message?: string }) => {
    throw new Error(message);
};

describe('LocalErrorBoundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render children when no error occurs', () => {
        render(
            <LocalErrorBoundary>
                <div>Safe Content</div>
            </LocalErrorBoundary>
        );
        expect(screen.getByText('Safe Content')).toBeInTheDocument();
    });

    it('should render default fallback UI when error occurs', () => {
        render(
            <LocalErrorBoundary>
                <Bomb />
            </LocalErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByText('KABOOM')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('should render custom fallback UI if provided', () => {
        render(
            <LocalErrorBoundary fallback={<div>Custom Error UI</div>}>
                <Bomb />
            </LocalErrorBoundary>
        );

        expect(screen.getByText('Custom Error UI')).toBeInTheDocument();
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('should log to Sentry with isolation key and component name', () => {
        const isolationKey = 'test-isolation-key';
        const componentName = 'TestComponent';

        render(
            <LocalErrorBoundary isolationKey={isolationKey} componentName={componentName}>
                <Bomb />
            </LocalErrorBoundary>
        );

        // Verify Sentry integration
        expect(Sentry.withScope).toHaveBeenCalled();

        expect(mockScope.setTag).toHaveBeenCalledWith('errorBoundary', isolationKey);
        expect(mockScope.setTag).toHaveBeenCalledWith('component', componentName);

        // Verify Component Stack Context (Critical for Domain 6/Area 12)
        expect(mockScope.setContext).toHaveBeenCalledWith('react', expect.objectContaining({
            componentStack: expect.any(String),
        }));

        expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should log to local logger with context', () => {
        const errorMsg = 'Logger Test Error';

        render(
            <LocalErrorBoundary componentName="LoggerTest">
                <Bomb message={errorMsg} />
            </LocalErrorBoundary>
        );

        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                err: expect.any(Error),
                component: 'LoggerTest',
            }),
            '[LocalErrorBoundary] Caught error'
        );
    });

    it('should reset error state when Try Again is clicked', () => {
        const onReset = vi.fn();
        render(
            <LocalErrorBoundary onReset={onReset}>
                <Bomb />
            </LocalErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();

        // Click Try Again
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));

        expect(onReset).toHaveBeenCalled();
        // Note: In a real app, the parent would reset the key or state that caused the error.
        // The boundary itself just clears its internal error state.
    });
});
