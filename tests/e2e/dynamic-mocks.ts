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

const MOCK_SESSIONS_STORAGE_KEY = '__SS_MOCK_SESSIONS__';

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

    const sessions = Array.from({ length: count }, (_, i) => {
        const now = new Date();
        const template = MOCK_SESSION_HISTORY[i % MOCK_SESSION_HISTORY.length] || {};

        return {
            ...template,
            id: `dynamic-session-${now.getTime()}-${i}`,
            user_id: 'test-user-123',
            created_at: new Date(
                now.getTime() - (i * (daysBack / count) * 24 * 60 * 60 * 1000)
            ).toISOString(),
            ...baseSession,
        };
    });

    await page.evaluate(
        ({ key, value }) => window.sessionStorage.setItem(key, JSON.stringify(value)),
        { key: MOCK_SESSIONS_STORAGE_KEY, value: sessions }
    );

    // Explicitly unroute existing handlers to avoid conflicts
    // (Playwright LIFO mostly handles this, but explicit is safer)
    await page.unroute('**/rest/v1/sessions*');

    await page.route('**/rest/v1/sessions*', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(sessions)
        });
    });
}
