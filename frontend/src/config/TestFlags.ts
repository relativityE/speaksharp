/**
 * Test configuration flags with clear hierarchy.
 * 
 * HIERARCHY:
 * - VITE_TEST_ENABLE_MOCKING (master): Enables fake API/engine responses.
 *   ↳ VITE_TEST_USE_REAL_DATABASE: Override to use real Supabase.
 *   ↳ VITE_TEST_USE_REAL_TRANSCRIPTION: Override to use real AI models (TransformersJS/WhisperTurbo).
 *     ↳ VITE_TEST_TRANSCRIPTION_FORCE_CPU: Force CPU inference (TransformersJS) even if WebGPU is available.
 * - E2E_DEBUG_ENABLED: Expose internal logs to test runner.
 */

import logger from '../lib/logger';

const getEnvVar = (key: string): string | undefined => {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        return (import.meta.env as Record<string, string>)[key];
    }
    if (typeof process !== 'undefined' && process.env) {
        return process.env[key];
    }
    return undefined;
};

// Type-safe flag access for window globals
declare global {
    interface Window {
        __E2E_CONTEXT__?: boolean;
        __FORCE_TRANSFORMERS_JS__?: boolean;
        __E2E_MOCK_SESSION__?: boolean;
        __E2E_MOCK_PROFILE__?: { id: string; subscription_status: string };
        __e2eProfileLoaded__?: boolean;
        __e2eBridgeReady__?: boolean;
        __e2eSessionDataLoaded__?: boolean;
        REAL_WHISPER_TEST?: boolean;
        TEST_MODE?: boolean;
    }
}

export const TestFlags = {
    /**
     * Master Switch: When true, the application operates in "test mode"
     * where MSW mocks APIs and we default to fake processing.
     */
    IS_TEST_MODE:
        getEnvVar('VITE_TEST_MODE') === 'true' ||
        (typeof window !== 'undefined' && window.TEST_MODE === true),

    /**
     * Database Override: When true, use real Supabase even in test mode.
     */
    USE_REAL_DATABASE: getEnvVar('VITE_USE_LIVE_DB') === 'true',

    /**
     * Transcription Override: When true, use real STT engines (Private STT)
     * instead of the MockEngine, even in test mode.
     */
    USE_REAL_TRANSCRIPTION:
        getEnvVar('REAL_WHISPER_TEST') === 'true' ||
        (typeof window !== 'undefined' && window.REAL_WHISPER_TEST === true),

    /**
     * Hardware Override: Force TransformersJS (CPU) even if WebGPU is available.
     * Useful for stable headless testing or low-end devices.
     */
    FORCE_CPU_TRANSCRIPTION:
        getEnvVar('VITE_FORCE_CPU_TRANSCRIPTION') === 'true' ||
        (typeof window !== 'undefined' && window.__FORCE_TRANSFORMERS_JS__ === true),

    /**
     * Debug Switch: Exposes internal logs and bridge state for E2E runners.
     */
    DEBUG_ENABLED: typeof window !== 'undefined' && !!window.__E2E_CONTEXT__,

    /**
     * Session Mock: Bypass real mic recording with a mock session flow.
     */
    IS_SESSION_MOCKED: typeof window !== 'undefined' && window.__E2E_MOCK_SESSION__ === true,
} as const;

/**
 * Logic helper to determine if we should use the MockEngine for STT.
 */
export function shouldUseMockTranscription(): boolean {
    return TestFlags.IS_TEST_MODE && !TestFlags.USE_REAL_TRANSCRIPTION;
}

/**
 * Logic helper to determine if we should use MSW.
 */
export function shouldEnableMocks(): boolean {
    // Disable MSW if we are explicitly using a real database (live/canary modes)
    return TestFlags.IS_TEST_MODE && !TestFlags.USE_REAL_DATABASE;
}

// Helper to log current configuration in debug mode
if (TestFlags.DEBUG_ENABLED && typeof window !== 'undefined') {
    logger.debug({ flags: TestFlags }, '[TestFlags] Initialized');
}
