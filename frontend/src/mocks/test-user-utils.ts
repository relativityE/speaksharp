import type { Session, User } from '@supabase/supabase-js';
import type { UserProfile } from '@/types/user';
import { MOCK_USER, MOCK_USER_PROFILE, SUBSCRIPTION_STATUS } from '@shared/test-fixtures';

export const TEST_USER_ID = MOCK_USER.id;
export const TEST_USER_EMAIL = MOCK_USER.email;

export function createMockUser(overrides: Partial<User> = {}): User {
  const now = new Date().toISOString();
  return {
    ...MOCK_USER,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as User;
}

export function createMockUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    ...MOCK_USER_PROFILE,
    subscription_status: SUBSCRIPTION_STATUS.PRO,
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
