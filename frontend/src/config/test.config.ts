import { IS_TEST_ENVIRONMENT } from './env';

/**
 * Centralized access to global test flags.
 * Used to decouple application logic from 'window' access.
 */
export const getTestConfig = () => {
    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};

    return {
        isTestMode: IS_TEST_ENVIRONMENT,
        useMockPrivateWhisper: !!win.__E2E_MOCK_LOCAL_WHISPER__,
        mockSession: !!win.__E2E_MOCK_SESSION__,
        // Helper to check if we should skip heavy inits
        shouldSkipMicInit: !!win.__E2E_MOCK_SESSION__,
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
