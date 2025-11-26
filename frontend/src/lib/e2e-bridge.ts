// src/lib/e2e-bridge.ts
/**
 * E2E Test Bridge Module
 * 
 * This module isolates all E2E-specific logic from the main application code.
 * It is only loaded when running in test mode (IS_TEST_ENVIRONMENT === true).
 * 
 * Purpose:
 * - Initializes Mock Service Worker (MSW) for network mocking
 * - Provides mock session injection for E2E tests
 * - Keeps production code clean from test-specific concerns
 */

import { Session } from '@supabase/supabase-js';
import logger from '@/lib/logger';

/**
 * Initializes the E2E test environment
 * - Starts MSW for network request mocking
 * - Sets window.mswReady flag for test synchronization
 */
export const initializeE2EEnvironment = async (): Promise<void> => {
    try {
        const { worker } = await import('@/mocks/browser');
        await worker.start({ onUnhandledRequest: 'bypass' });
        logger.info('[E2E Bridge] MSW initialized successfully');

        setupSpeechRecognitionMock();

        window.mswReady = true;
    } catch (error) {
        logger.error({ error }, '[E2E Bridge] Failed to initialize MSW');
        throw error;
    }
};

/**
 * Gets the initial session for the application
 * - Returns mock session if __E2E_MOCK_SESSION__ is set
 * - Otherwise returns the provided session (or null)
 */
export const getInitialSession = (fallbackSession: Session | null = null): Session | null => {
    if (window.__E2E_MOCK_SESSION__) {
        logger.info('[E2E Bridge] Using mock session');
        return {
            user: {
                id: 'mock-user-id',
                email: 'test@example.com',
                aud: 'authenticated',
                role: 'authenticated',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                app_metadata: {
                    provider: 'email',
                    providers: ['email'],
                },
                user_metadata: { subscription_status: 'free' },
            },
            access_token: 'mock-token',
            refresh_token: 'mock-refresh-token',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
        } as Session;
    }

    return fallbackSession;
};

// Mock SpeechRecognition for E2E tests
class MockSpeechRecognition {
    continuous = false;
    interimResults = false;
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: (() => void) | null = null;

    start() {
        logger.info('[MockSpeechRecognition] start() called');
        // Register this instance as the active one so we can dispatch events to it
        (window as any).__activeSpeechRecognition = this;
    }
    stop() {
        logger.info('[MockSpeechRecognition] stop() called');
    }
    abort() { }
}

const setupSpeechRecognitionMock = () => {
    if (typeof window !== 'undefined') {
        logger.info('[E2E Bridge] Setting up MockSpeechRecognition');
        (window as any).SpeechRecognition = MockSpeechRecognition;
        (window as any).webkitSpeechRecognition = MockSpeechRecognition;

        // Helper to dispatch events from Playwright
        (window as any).dispatchMockTranscript = (text: string, isFinal: boolean = false) => {
            const instance = (window as any).__activeSpeechRecognition;
            if (instance && instance.onresult) {
                logger.info({ text, isFinal }, '[E2E Bridge] Dispatching mock transcript');

                // Construct event matching SpeechRecognitionEvent structure
                // results is a SpeechRecognitionResultList (array-like)
                // item is SpeechRecognitionResult (array-like of alternatives) + isFinal

                const alternative = { transcript: text, confidence: 1 };
                const result = [alternative];
                (result as any).isFinal = isFinal;

                const results = [result];

                const event = {
                    resultIndex: 0,
                    results: results,
                    type: 'result'
                };

                instance.onresult(event);
            } else {
                logger.warn('[E2E Bridge] No active SpeechRecognition instance found to dispatch to');
            }
        };
    }
};
