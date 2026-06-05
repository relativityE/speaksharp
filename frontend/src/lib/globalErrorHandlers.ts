import * as Sentry from '@sentry/react';
import { toast } from '@/lib/toast';
import logger from './logger';
import { analyticsBuffer } from '../services/AnalyticsBuffer';

let lastToastTime = 0;
const TOAST_COOLDOWN_MS = 5000;

const getErrorMessage = (reason: unknown): string => {
    if (reason instanceof Error) return reason.message;
    if (reason && typeof reason === 'object' && 'message' in reason) {
        return String((reason as { message?: unknown }).message ?? 'Unknown');
    }
    return typeof reason === 'string' ? reason : 'Unknown';
};

const isBenignBackgroundAbort = (reason: unknown): boolean => {
    const name = reason instanceof Error ? reason.name : '';
    const message = getErrorMessage(reason).toLowerCase();
    return (
        name === 'AbortError' ||
        message.includes('aborterror') ||
        message.includes('signal is aborted') ||
        message.includes('operation was aborted')
    );
};

// 🌍 Global Error Handlers (Safety Net)
export const setupGlobalErrorHandlers = () => {
    // Ensure unhandled async errors are logged even if they bypass React boundaries
    window.addEventListener('unhandledrejection', (event) => {
        const message = getErrorMessage(event.reason);

        if (isBenignBackgroundAbort(event.reason)) {
            event.preventDefault();
            logger.debug({ reason: event.reason }, 'Benign background promise abort suppressed');
            return;
        }

        logger.error({ reason: event.reason }, 'Global Unhandled Rejection');

        // Ensure background rejections are also sent to Sentry and Analytics
        Sentry.captureException(event.reason);
        analyticsBuffer.push('GLOBAL_UNHANDLED_REJECTION', {
            reason: message
        }, 'CRITICAL');

        // Add debouncing to prevent UI flooding during network outages.
        // The raw `message` is kept in logs/Sentry/analytics above (internal only); the
        // user-facing toast stays generic so backend internals never leak (P2 hardening).
        const now = Date.now();
        if (now - lastToastTime > TOAST_COOLDOWN_MS) {
            toast.error("Something went wrong in the background", {
                description: "We've logged the issue. Please retry — if it keeps happening, reload the page."
            });
            lastToastTime = now;
        }

        // Prevent duplicate browser-level "Uncaught (in promise)" noise after
        // explicit Sentry/log capture. Tests should assert on this log/event,
        // not rely on rethrowing inside the global handler.
        event.preventDefault();
    });

    window.addEventListener('error', (event) => {
        logger.error({
            error: event.error,
            message: event.message,
            filename: event.filename,
            lineno: event.lineno
        }, 'Global Uncaught Error');

        // Observability Hard-Gate: Ensure raw error is pushed to console for Playwright
        if (event.error) {
            console.error('[GlobalHardGate]', event.error);
        }


    });
};



/** @internal - For testing use only */
export const resetErrorState = () => {
    lastToastTime = 0;
};
