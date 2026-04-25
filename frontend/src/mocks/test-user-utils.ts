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

export function createMockSession(overrides: Partial<Session> = {}, userType: 'free' | 'pro' = 'pro'): Session {
  const now = Math.floor(Date.now() / 1000);
  const user = createMockUser({
    email: userType === 'pro' ? 'pro@example.com' : 'free@example.com'
  });

  // Harden: Generate a tier-specific mock token for deterministic MSW branching
  const fakeAccessToken = `mock-${userType}-token-${now}`;

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
