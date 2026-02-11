import { toast as sonnerToast, ExternalToast } from 'sonner';
import { UI_CONFIG } from '../config';

const MIN_DURATION_MS = UI_CONFIG.MIN_TOAST_LENGTH_SECS * 1000;

/**
 * Enforces the minimum toast duration.
 * if duration is lower than 5 sec (MIN_DURATION_MS), it returns the min.
 */
export const enforceMinDuration = (duration?: number): number => {
    if (duration === undefined) return MIN_DURATION_MS;
    return Math.max(duration, MIN_DURATION_MS);
};

interface EnforcedToastOptions extends ExternalToast {
    duration?: number;
}

type ToastFunction = (message: string | React.ReactNode, options?: EnforcedToastOptions) => string | number;

const wrapToast = (fn: (message: string | React.ReactNode, options?: ExternalToast) => string | number): ToastFunction => {
    return (message: string | React.ReactNode, options?: EnforcedToastOptions) => {
        const enforcedOptions = {
            ...options,
            duration: enforceMinDuration(options?.duration),
        };
        return fn(message, enforcedOptions);
    };
};

/**
 * Wrapped sonner toast that enforces UI_CONFIG.MIN_TOAST_LENGTH_SECS
 */
export const toast = Object.assign(
    (message: string | React.ReactNode, options?: EnforcedToastOptions): string | number => {
        return sonnerToast(message, {
            ...options,
            duration: enforceMinDuration(options?.duration),
        });
    },
    {
        success: wrapToast(sonnerToast.success),
        error: wrapToast(sonnerToast.error),
        info: wrapToast(sonnerToast.info),
        warning: wrapToast(sonnerToast.warning),
        loading: sonnerToast.loading, // loading typically doesn't have a fixed duration until promised
        promise: sonnerToast.promise,
        dismiss: sonnerToast.dismiss,
        custom: sonnerToast.custom,
    }
);

export default toast;
