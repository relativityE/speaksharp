import { describe, expect, it } from 'vitest';
import { validateViteEnv } from '../../scripts/vite-env-core.mjs';

const realEnv = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'real-anon-key-for-test',
  VITE_AUTH_MODE: 'real',
};

const mockEnv = {
  VITE_SUPABASE_URL: 'https://mock.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'mock_anon_key',
  VITE_AUTH_MODE: 'mock',
  VITE_USE_MOCK_AUTH: 'true',
};

describe('local Vite environment guard', () => {
  it('allows manual development only on the real-auth port', () => {
    expect(validateViteEnv({ mode: 'development', port: 5174, env: realEnv }).ok).toBe(true);
  });

  it('blocks manual development when mock auth is configured', () => {
    const result = validateViteEnv({ mode: 'development', port: 5174, env: mockEnv });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Manual signup testing must use real auth');
  });

  it('blocks manual development on the test/E2E port', () => {
    const result = validateViteEnv({ mode: 'development', port: 5173, env: realEnv });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('must run on port 5174');
  });

  it('allows test mode only on the mocked E2E port', () => {
    expect(validateViteEnv({ mode: 'test', port: 5173, env: mockEnv }).ok).toBe(true);
  });

  it('blocks test mode with real auth unless explicitly mocked', () => {
    const result = validateViteEnv({ mode: 'test', port: 5173, env: realEnv });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('real Supabase URL without explicit mock auth');
  });

  it('allows test mode with live DB only when explicitly requested', () => {
    expect(validateViteEnv({
      mode: 'test',
      port: 5173,
      env: {
        ...realEnv,
        VITE_USE_LIVE_DB: 'true',
      },
    }).ok).toBe(true);
  });
});
