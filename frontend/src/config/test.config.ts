import { ENV } from './TestFlags';

/**
 * Centralized access to global test flags.
 * Used to decouple application logic from 'window' access.
 */
export const getTestConfig = () => {
    return {
        isTestMode: ENV.isTest,
    };
};

/**
 * Helper to dispatch test events safely
 */
export const dispatchTestEvent = (eventName: string, detail: unknown) => {
    if (typeof window !== 'undefined') {
        document.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
};

/**
 * Helper to set global flags safely (for test feedback)
 */
export const setTestFlag = (flag: string, value: unknown) => {
    if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>)[flag] = value;
    }
};
