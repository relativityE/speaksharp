import { toast as sonnerToast, ExternalToast } from 'sonner';
import { UI_CONFIG } from '../config';

const DEFAULT_DURATION_MS = UI_CONFIG.DEFAULT_TOAST_LENGTH_SECS * 1000;

/**
 * Keeps transient toasts short by default. Critical states should also be
 * surfaced inline or in the persistent status bar.
 */
export const resolveToastDuration = (duration?: number, fallback: number = DEFAULT_DURATION_MS): number => {
    return duration ?? fallback;
};

interface EnforcedToastOptions extends ExternalToast {
    duration?: number;
}

type ToastFunction = (message: string | React.ReactNode, options?: EnforcedToastOptions) => string | number;

const wrapToast = (
    fn: (message: string | React.ReactNode, options?: ExternalToast) => string | number,
    fallbackDuration: number = DEFAULT_DURATION_MS,
): ToastFunction => {
    return (message: string | React.ReactNode, options?: EnforcedToastOptions) => {
        const enforcedOptions = {
            ...options,
            duration: resolveToastDuration(options?.duration, fallbackDuration),
        };
        return fn(message, enforcedOptions);
    };
};

/**
 * Wrapped sonner toast with severity-aware durations.
 */
export const toast = Object.assign(
    (message: string | React.ReactNode, options?: EnforcedToastOptions): string | number => {
        return sonnerToast(message, {
            ...options,
            duration: resolveToastDuration(options?.duration),
        });
    },
    {
        success: wrapToast(sonnerToast.success, 3200),
        error: wrapToast(sonnerToast.error, 8000),
        info: wrapToast(sonnerToast.info, 3500),
        warning: wrapToast(sonnerToast.warning, 6000),
        loading: sonnerToast.loading, // loading typically doesn't have a fixed duration until promised
        promise: sonnerToast.promise,
        dismiss: sonnerToast.dismiss,
        custom: sonnerToast.custom,
    }
);

export default toast;
