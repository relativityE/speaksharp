export const MOCK_USER = {
    id: 'test-user-123',
    email: 'test@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: 'Test User' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
} as const;

export const MOCK_USER_PROFILE = {
    id: MOCK_USER.id,
    email: MOCK_USER.email,
    subscription_status: 'free',
    usage_seconds: 0,
    usage_reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
} as const;

export const MOCK_SESSIONS = [
    {
        id: 'session-1',
        user_id: MOCK_USER.id,
        created_at: new Date(Date.now() - 86400000).toISOString(),
        duration: 300,
        total_words: 750,
        accuracy: 0.85,
        filler_words: { um: { count: 10 }, uh: { count: 5 } },
    },
    {
        id: 'session-2',
        user_id: MOCK_USER.id,
        created_at: new Date(Date.now() - 172800000).toISOString(),
        duration: 420,
        total_words: 1050,
        accuracy: 0.88,
        filler_words: { like: { count: 8 }, um: { count: 4 } },
    },
    {
        id: 'session-3',
        user_id: MOCK_USER.id,
        created_at: new Date(Date.now() - 259200000).toISOString(),
        duration: 360,
        total_words: 900,
        accuracy: 0.90,
        filler_words: { actually: { count: 10 } },
    },
] as const;

export const MOCK_TRANSCRIPTS = [
    'Welcome everyone to the session.',
    'This is a test of live transcript streaming.',
    'We are simulating multiple lines arriving over time.',
] as const;

export const MOCK_JWT_PAYLOAD = {
    sub: MOCK_USER.id,
    email: MOCK_USER.email,
    aud: 'authenticated',
    role: 'authenticated',
} as const;

export const MOCK_SESSION_KEY = 'sb-mock-session';

import type { PracticeSession } from '../types/session';

// DEV BYPASS: Mock session data for UI testing in Analytics Dashboard
export const ANALYTICS_MOCK_SESSIONS: PracticeSession[] = [
    {
        id: 'mock-session-1',
        user_id: 'dev-bypass-user-id',
        title: 'Monday Practice Session',
        transcript: 'This is a mock transcript for testing purposes.',
        duration: 720, // 12 minutes
        total_words: 1740, // ~145 WPM
        accuracy: 0.87,
        filler_words: { 'um': { count: 23 }, 'uh': { count: 18 }, 'like': { count: 15 }, 'you know': { count: 10 } } as { [key: string]: { count: number } },
        created_at: '2025-01-14T10:00:00.000Z',
    },
    {
        id: 'mock-session-2',
        user_id: 'dev-bypass-user-id',
        title: 'Tuesday Practice Session',
        transcript: 'Another mock transcript.',
        duration: 480,
        total_words: 1100,
        accuracy: 0.85,
        filler_words: { 'um': { count: 8 }, 'uh': { count: 5 } } as { [key: string]: { count: number } },
        created_at: '2025-01-13T10:00:00.000Z',
    },
    {
        id: 'mock-session-3',
        user_id: 'dev-bypass-user-id',
        title: 'Wednesday Practice Session',
        transcript: 'Mock transcript three.',
        duration: 600,
        total_words: 1500,
        accuracy: 0.82,
        filler_words: { 'um': { count: 12 } } as { [key: string]: { count: number } },
        created_at: '2025-01-12T10:00:00.000Z',
    },
] as unknown as PracticeSession[];
