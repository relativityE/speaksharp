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
