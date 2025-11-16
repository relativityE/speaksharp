// tests/e2e/fixtures/mockData.ts
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
  subscription_status: 'pro',
  preferred_mode: 'cloud',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as const;

export const MOCK_SESSIONS = [
  {
    id: 'session-1',
    user_id: MOCK_USER.id,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    duration: 300,
    word_count: 750,
    filler_word_count: 15,
    average_pace: 150,
    clarity_score: 85,
    confidence_score: 78,
  },
  {
    id: 'session-2',
    user_id: MOCK_USER.id,
    created_at: new Date(Date.now() - 172800000).toISOString(),
    duration: 420,
    word_count: 1050,
    filler_word_count: 12,
    average_pace: 150,
    clarity_score: 88,
    confidence_score: 82,
  },
  {
    id: 'session-3',
    user_id: MOCK_USER.id,
    created_at: new Date(Date.now() - 259200000).toISOString(),
    duration: 360,
    word_count: 900,
    filler_word_count: 10,
    average_pace: 150,
    clarity_score: 90,
    confidence_score: 85,
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
