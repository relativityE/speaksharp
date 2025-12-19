import type { Session, User } from '@supabase/supabase-js';
import type { UserProfile } from '@/types/user';

export const TEST_USER_ID = 'test-user-123';
export const TEST_USER_EMAIL = 'test@example.com';

export function createMockUser(overrides: Partial<User> = {}): User {
  const now = new Date().toISOString();
  return {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: 'Test User' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createMockUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: TEST_USER_ID,
    subscription_status: 'pro',
    usage_seconds: 1250,
    usage_reset_date: new Date(Date.now() + 15 * 86400000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockSession(overrides: Partial<Session> = {}): Session {
  const now = Math.floor(Date.now() / 1000);
  const user = createMockUser();

  const base64UrlEncode = (str: string) => {
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    email: user.email,
    aud: "authenticated",
    role: "authenticated",
    exp: now + 3600,
    iat: now,
    session_id: `test-session-${now}`,
  }));
  const signature = "fake-signature-for-e2e-testing";
  const fakeAccessToken = `${header}.${payload}.${signature}`;

  return {
    access_token: fakeAccessToken,
    refresh_token: `fake-refresh-token-${now}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user,
    ...overrides,
  };
}
