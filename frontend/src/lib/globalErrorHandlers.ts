import * as Sentry from '@sentry/react';
import { toast } from '@/lib/toast';
import logger from './logger';

let lastToastTime = 0;
const TOAST_COOLDOWN_MS = 5000;

// 🌍 Global Error Handlers (Safety Net)
export const setupGlobalErrorHandlers = () => {
    // Ensure unhandled async errors are logged even if they bypass React boundaries
    window.addEventListener('unhandledrejection', (event) => {
        logger.error({ reason: event.reason }, 'Global Unhandled Rejection');

        // Ensure background rejections are also sent to Sentry
        Sentry.captureException(event.reason);

        // Add debouncing to prevent UI flooding during network outages
        const now = Date.now();
        if (now - lastToastTime > TOAST_COOLDOWN_MS) {
            toast.error("A background task failed", {
                description: event.reason?.message || 'Check logs for details'
            });
            lastToastTime = now;
        }

        // Observability Hard-Gate: Ensure the runner sees it as fatal
        throw event.reason;
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
