/**
 * ARCHITECTURAL TRUTH: Isomorphic Test Fixtures
 * 
 * Shared constants for MSW and Playwright to prevent mock drift.
 * Import via '@shared/test-fixtures' in Frontend/E2E.
 */

export const SUBSCRIPTION_STATUS = {
    FREE: 'free',
    PRO: 'pro',
} as const;

export type SubscriptionStatus = typeof SUBSCRIPTION_STATUS[keyof typeof SUBSCRIPTION_STATUS];

export const MOCK_USER = {
    id: 'test-user-123',
    email: 'test@example.com',
    app_metadata: {
        provider: 'email',
        subscription_status: SUBSCRIPTION_STATUS.FREE as SubscriptionStatus
    },
    user_metadata: { name: 'Test User' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2025-01-01T00:00:00.000Z',
};

export const MOCK_USER_PROFILE = {
    id: 'test-user-123',
    subscription_status: SUBSCRIPTION_STATUS.FREE as SubscriptionStatus,
    usage_seconds: 1250,
    usage_reset_date: '2025-02-01T00:00:00.000Z',
    created_at: '2025-01-01T00:00:00.000Z',
};

export const MOCK_SESSION = {
    access_token: 'mock-access-token-for-e2e-testing',
    refresh_token: 'mock-refresh-token-for-e2e-testing',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: MOCK_USER,
};

// Rich mock session history for analytics testing
// (Matches the complex scenario required for trend analysis)
export const MOCK_SESSION_HISTORY = [
    {
        id: 'session-1',
        user_id: 'test-user-123',
        created_at: '2025-01-10T10:00:00.000Z',
        duration: 180,
        transcript: 'Um, so today I wanted to talk about my presentation skills.',
        title: 'First Practice Session',
        total_words: 85,
        engine: 'Native',
        clarity_score: 72.5,
        wpm: 28.3,
        filler_words: {
            um: { count: 8, timestamps: [1.2, 5.4, 12.1, 18.3, 25.6, 32.1, 45.2, 58.9] },
            uh: { count: 6, timestamps: [3.1, 9.2, 22.4, 38.7, 52.1, 65.3] },
            like: { count: 4, timestamps: [7.8, 28.9, 41.2, 72.1] },
            'you know': { count: 2, timestamps: [15.4, 55.8] },
            total: { count: 20 }
        }
    },
    {
        id: 'session-2',
        user_id: 'test-user-123',
        created_at: '2025-01-12T11:00:00.000Z',
        duration: 240,
        transcript: 'Today I practiced discussing REST APIs and, um, database schemas.',
        title: 'Technical Practice',
        total_words: 120,
        engine: 'Cloud AI',
        clarity_score: 78.2,
        wpm: 30.1,
        filler_words: {
            um: { count: 5, timestamps: [8.2, 22.4, 45.6, 78.2, 112.3] },
            uh: { count: 4, timestamps: [15.1, 38.9, 62.4, 95.1] },
            total: { count: 9 }
        }
    },
    {
        id: 'session-3',
        user_id: 'test-user-123',
        created_at: '2025-01-15T09:00:00.000Z',
        duration: 300,
        transcript: 'In this session I focused on explaining Kubernetes orchestration and CI/CD pipelines.',
        title: 'DevOps Vocabulary Practice',
        total_words: 165,
        engine: 'Private',
        clarity_score: 85.0,
        wpm: 33.0,
        filler_words: {
            um: { count: 3, timestamps: [18.4, 62.1, 145.8] },
            uh: { count: 2, timestamps: [42.3, 98.7] },
            total: { count: 5 }
        }
    },
    {
        id: 'session-4',
        user_id: 'test-user-123',
        created_at: '2025-01-17T14:00:00.000Z',
        duration: 420,
        transcript: 'Today I presented about machine learning algorithms including neural networks and gradient descent.',
        title: 'ML Presentation Practice',
        total_words: 245,
        engine: 'Cloud AI',
        clarity_score: 91.5,
        wpm: 35.0,
        filler_words: {
            um: { count: 2, timestamps: [55.2, 185.4] },
            uh: { count: 1, timestamps: [122.8] },
            total: { count: 3 }
        }
    },
    {
        id: 'session-5',
        user_id: 'test-user-123',
        created_at: '2025-01-20T16:00:00.000Z',
        duration: 480,
        transcript: 'This was my most fluent session yet! I discussed cloud architecture, serverless computing, and how SpeakSharp has helped me become a more confident speaker.',
        title: 'Cloud Architecture Deep Dive',
        total_words: 320,
        engine: 'Private',
        clarity_score: 95.8,
        wpm: 40.0,
        filler_words: {
            um: { count: 1, timestamps: [142.5] },
            total: { count: 1 }
        }
    },
];

export const MOCK_GOALS = {
    user_id: 'test-user-123',
    weekly_goal: 5,
    clarity_goal: 90,
};
