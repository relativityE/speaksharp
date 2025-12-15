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
        console.log('[E2E Bridge] Initializing E2E environment (MSW Removed)');

        // We strictly use Playwright's route capabilities or Live DB now.
        // MSW Service Worker is no longer started here.

        setupSpeechRecognitionMock();

        window.mswReady = true;
        dispatchE2EEvent('e2e:msw-ready');
    } catch (error) {
        logger.error({ error }, '[E2E Bridge] Failed to initialize E2E environment');
        throw error;
    }
};

/**
 * Dispatches a custom event for E2E test synchronization
 */
export const dispatchE2EEvent = (eventName: string, detail: unknown = {}) => {
    logger.info({ eventName, detail }, '[E2E Bridge] Dispatching event');
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
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
                id: 'test-user-123',
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

// Mock SpeechRecognition for E2E tests - exported for use when MSW is skipped
export class MockSpeechRecognition {
    continuous = false;
    interimResults = false;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;

    start() {
        logger.info('[MockSpeechRecognition] start() called');
        // Register this instance as the active one so we can dispatch events to it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__activeSpeechRecognition = this;
        dispatchE2EEvent('e2e:speech-recognition-ready');
    }
    stop() {
        logger.info('[MockSpeechRecognition] stop() called');
    }
    abort() { }
}

interface MockOnDeviceWhisperOptions {
    onModelLoadProgress?: (progress: number) => void;
    onReady?: () => void;
    onTranscriptUpdate?: (update: unknown) => void;
}

// Mock OnDeviceWhisper for E2E tests
class MockOnDeviceWhisper {
    private onModelLoadProgress: ((progress: number) => void) | undefined;
    private onReady: (() => void) | undefined;
    private onTranscriptUpdate: ((update: unknown) => void) | undefined;

    constructor(options: MockOnDeviceWhisperOptions) {
        this.onModelLoadProgress = options.onModelLoadProgress;
        this.onReady = options.onReady;
        this.onTranscriptUpdate = options.onTranscriptUpdate;
    }

    async init() {

        return new Promise<void>((resolve) => {
            // Simulate model download
            if (this.onModelLoadProgress) {
                this.onModelLoadProgress(0);
                // Simulate progress
                setTimeout(() => this.onModelLoadProgress!(0.1), 100);
                setTimeout(() => this.onModelLoadProgress!(0.5), 300);
                setTimeout(() => this.onModelLoadProgress!(1), 500);
            }

            // Simulate ready state after download
            setTimeout(() => {
                if (this.onReady) this.onReady();
                resolve();
            }, 600);
        });
    }

    async startTranscription() {
        logger.info('[MockOnDeviceWhisper] startTranscription() called');
    }

    async stopTranscription() {
        logger.info('[MockOnDeviceWhisper] stopTranscription() called');
        return '';
    }

    async getTranscript() {
        return '';
    }
}

// Exported for use when VITE_SKIP_MSW=true to set up transcript mocking
export const setupSpeechRecognitionMock = () => {
    if (typeof window !== 'undefined') {
        logger.info('[E2E Bridge] Setting up MockSpeechRecognition');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).SpeechRecognition = MockSpeechRecognition;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitSpeechRecognition = MockSpeechRecognition;

        // Setup MockOnDeviceWhisper
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MockOnDeviceWhisper = MockOnDeviceWhisper;

        // Helper to dispatch events from Playwright
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).dispatchMockTranscript = (text: string, isFinal: boolean = false) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const instance = (window as any).__activeSpeechRecognition;
            if (instance && instance.onresult) {
                logger.info({ text, isFinal }, '[E2E Bridge] Dispatching mock transcript');

                // Construct event matching SpeechRecognitionEvent structure
                // results is a SpeechRecognitionResultList (array-like)
                // item is SpeechRecognitionResult (array-like of alternatives) + isFinal

                const alternative = { transcript: text, confidence: 1 };
                const result = [alternative];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

