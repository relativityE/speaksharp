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
