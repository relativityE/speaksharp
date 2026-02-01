import { Page } from '@playwright/test';
import { MOCK_SESSION_HISTORY } from './mock-routes';

export interface MockSession {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    duration: number;
    wpm: number;
    clarity_score: number;
    filler_words: Record<string, unknown> | null;
    transcript: string;
    engine: string;
    total_words: number;
}

/**
 * Enhanced Mock Injection Helper
 * 
 * Replaces static mock data with dynamic, request-time generated timestamps.
 * eliminating race conditions where sessions fall out of "last 7 days" window
 * due to test execution delays.
 */
export async function mockRecentSessions(
    page: Page,
    options: {
        count?: number;
        daysBack?: number;
        baseSession?: Partial<MockSession>;
    } = {}
) {
    const { count = 5, daysBack = 7, baseSession = {} } = options;

    // Explicitly unroute existing handlers to avoid conflicts
    // (Playwright LIFO mostly handles this, but explicit is safer)
    await page.unroute('**/rest/v1/sessions*');

    await page.route('**/rest/v1/sessions*', async (route) => {
        const now = new Date();

        // Generate sessions based on MOCK_SESSION_HISTORY patterns but with fresh dates
        const sessions = Array.from({ length: count }, (_, i) => {
            // Cycle through existing mock templates or use defaults
            const template = MOCK_SESSION_HISTORY[i % MOCK_SESSION_HISTORY.length] || {};

            return {
                ...template,
                id: `dynamic-session-${now.getTime()}-${i}`,
                user_id: 'test-user-123',
                // Spread calculated date to guarantee window inclusion
                created_at: new Date(
                    now.getTime() - (i * (daysBack / count) * 24 * 60 * 60 * 1000)
                ).toISOString(),
                // Allow overrides
                ...baseSession,
            };
        });

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(sessions)
        });
    });
}
