// src/lib/e2e-bridge.ts
/**
 * ============================================================================
 * E2E TEST INFRASTRUCTURE MODULE
 * ============================================================================
 * 
 * PURPOSE:
 * --------
 * Provides test infrastructure for End-to-End testing with Playwright.
 * ONLY loaded when IS_TEST_ENVIRONMENT === true (production code stays clean).
 * 
 * CONTENTS:
 * ---------
 * 1. initializeE2EEnvironment() - Sets up test environment (mswReady, mocks)
 * 2. dispatchE2EEvent() - Sends custom events for test synchronization
 * 3. getInitialSession() - Returns mock session when __E2E_MOCK_SESSION__ set
 * 4. dispatchMockTranscript() - Simulates speech recognition output
 * 5. MockPrivateWhisper - FAKE Whisper service for fast E2E tests
 *    - Simulates 600ms model load (vs real 2-5 seconds)
 *    - Used when __E2E_MOCK_LOCAL_WHISPER__ flag is set
 * 
 * RELATED FILES:
 * --------------
 * - tests/e2e/private-stt.e2e.spec.ts - Uses MockPrivateWhisper
 * - frontend/src/services/transcription/TranscriptionService.ts - Checks for mock
 * - frontend/src/main.tsx - Calls initializeE2EEnvironment()
 * 
 * USAGE IN TESTS:
 * ---------------
 * To use MockPrivateWhisper in E2E tests:
 *   await page.evaluate(() => { (window as any).__E2E_MOCK_LOCAL_WHISPER__ = true; });
 * 
 * @see docs/ARCHITECTURE.md - "Private STT (Whisper) & Service Worker Caching"
 */

import { Session } from '@supabase/supabase-js';
import logger from '@/lib/logger';
import { TranscriptionModeOptions, Transcript } from '@/services/transcription/modes/types';

/**
 * E2E Window interface - extends Window with all E2E-specific properties.
 * This ensures type safety across the bridge boundary.
 */
interface E2EWindow extends Window {
    __E2E_CONTEXT__?: boolean;
    __E2E_MOCK_SESSION__?: boolean;
    __activeSpeechRecognition?: MockSpeechRecognition;
    SpeechRecognition?: typeof MockSpeechRecognition;
    webkitSpeechRecognition?: typeof MockSpeechRecognition;
    MockPrivateWhisper?: typeof MockPrivateWhisper;
    dispatchMockTranscript?: (text: string, isFinal?: boolean) => void;
    mswReady?: boolean;
    __e2eBridgeReady__?: boolean;
    __e2eProfileLoaded__?: boolean;
}

/** Type for speech recognition result with isFinal flag */
interface MockSpeechResult extends Array<{ transcript: string; confidence: number }> {
    isFinal?: boolean;
}

/**
 * Initializes the E2E test environment
 * - Starts MSW for network request mocking
 * - Sets window.mswReady flag for test synchronization
 */
export const initializeE2EEnvironment = async (): Promise<void> => {
    try {
        logger.info('[E2E Bridge] Initializing E2E environment');

        // 🛑 Skip MSW if we're in a Playwright test (standardizing on PW routes)
        // This allows manual browser preview to use MSW mocks while tests stay isolated
        const e2eWin = window as unknown as E2EWindow;
        const isPlaywright = e2eWin.__E2E_CONTEXT__;

        if (!isPlaywright) {
            logger.info('[E2E Bridge] Starting MSW worker for manual preview...');
            const { worker } = await import('../mocks/browser');
            await worker.start({
                onUnhandledRequest: 'bypass',
            });
            logger.info('[E2E Bridge] MSW worker started successfully');
        }

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
        (window as unknown as E2EWindow).__activeSpeechRecognition = this;
        dispatchE2EEvent('e2e:speech-recognition-ready');
    }
    stop() {
        logger.info('[MockSpeechRecognition] stop() called');
    }
    abort() { }
}



/**
 * Mock implementation of PrivateWhisper for E2E tests.
 * 
 * PURPOSE:
 * Provides a fake Whisper service with predictable timing for E2E tests.
 * 
 * TIMING:
 * - Simulates 600ms model load (vs real 2-5 seconds)
 * - Progress updates: 0% → 25% → 50% → 75% → 100%
 * 
 * USAGE:
 * Set `window.__E2E_MOCK_LOCAL_WHISPER__ = true` before starting session.
 * TranscriptionService will use this mock instead of real PrivateWhisper.
 * 
 * @see frontend/src/services/transcription/modes/PrivateWhisper.ts - Real implementation
 * @see tests/e2e/private-stt.e2e.spec.ts - Uses this mock
 */
class MockPrivateWhisper {
    private onModelLoadProgress: ((progress: number) => void) | undefined;
    private onReady: (() => void) | undefined;
    private onTranscriptUpdate: ((update: { transcript: Transcript }) => void) | undefined;

    constructor(options: TranscriptionModeOptions) {
        this.onModelLoadProgress = options.onModelLoadProgress;
        this.onReady = options.onReady;
        this.onTranscriptUpdate = options.onTranscriptUpdate;
    }

    async init() {
        logger.info('[MockPrivateWhisper] init() called - simulating model load');

        return new Promise<void>((resolve) => {
            // Simulate model download
            if (this.onModelLoadProgress) {
                this.onModelLoadProgress(0);
                // Simulate progress - slower for reliable E2E detection
                setTimeout(() => this.onModelLoadProgress!(0.1), 1000);
                setTimeout(() => this.onModelLoadProgress!(0.5), 2000);
                setTimeout(() => this.onModelLoadProgress!(1), 2500);
            }

            // Simulate ready state after download
            setTimeout(() => {
                logger.info('[MockPrivateWhisper] Model loaded, triggering onReady and toast');

                // Trigger toast to match real PrivateWhisper behavior
                // This is needed for E2E tests that verify toast notification
                import('sonner').then(({ toast }) => {
                    toast.success('Model ready! You can now start your session.');
                    logger.info('[MockPrivateWhisper] Toast triggered');
                });

                if (this.onReady) this.onReady();
                resolve();
            }, 3000);
        });
    }

    async startTranscription() {
        logger.info('[MockPrivateWhisper] startTranscription() called');
    }

    async stopTranscription() {
        logger.info('[MockPrivateWhisper] stopTranscription() called');
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
        const e2eWindow = window as unknown as E2EWindow;
        e2eWindow.SpeechRecognition = MockSpeechRecognition;
        e2eWindow.webkitSpeechRecognition = MockSpeechRecognition;

        // Setup MockPrivateWhisper
        e2eWindow.MockPrivateWhisper = MockPrivateWhisper;

        // Helper to dispatch events from Playwright
        e2eWindow.dispatchMockTranscript = (text: string, isFinal: boolean = false) => {
            const instance = e2eWindow.__activeSpeechRecognition;
            if (instance && instance.onresult) {
                logger.info({ text, isFinal }, '[E2E Bridge] Dispatching mock transcript');

                // Construct event matching SpeechRecognitionEvent structure
                const alternative = { transcript: text, confidence: 1 };
                const result: MockSpeechResult = [alternative];
                result.isFinal = isFinal;

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

        // Signal that the bridge is fully initialized and dispatchMockTranscript is available
        e2eWindow.__e2eBridgeReady__ = true;
        dispatchE2EEvent('e2e:bridge-ready');
    }
};

