import { PORTS } from './build.config.js';

export function validateViteEnv({ mode = 'development', port, env }) {
  const expectedPort = mode === 'test' ? PORTS.TEST : PORTS.PROD;
  const url = env.VITE_SUPABASE_URL || '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
  const authMode = env.VITE_AUTH_MODE || '';
  const usesRealSupabase = /\.supabase\.co\/?$/.test(url);
  const usesMockUrl = !url || /mock|example|localhost/.test(url);
  const usesMockKey = anonKey.startsWith('mock_');
  const explicitlyMocked = authMode === 'mock' || env.VITE_USE_MOCK_AUTH === 'true';
  const unsafeOverride = env.ALLOW_UNSAFE_MIXED_SUPABASE_CONFIG === 'true';

  const configuredPort = Number(port || expectedPort);

  if (!url || !anonKey) {
    return { ok: false, unsafeOverride, message: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.' };
  }

  if (configuredPort !== expectedPort && !unsafeOverride) {
    return { ok: false, unsafeOverride, message: `Mode "${mode}" must run on port ${expectedPort}, but got ${configuredPort}.` };
  }

  if (authMode && !['real', 'mock'].includes(authMode)) {
    return { ok: false, unsafeOverride, message: `Mode "${mode}" has invalid VITE_AUTH_MODE="${authMode}". Use "real" or "mock".` };
  }

  if (mode !== 'test' && (usesMockKey || explicitlyMocked || usesMockUrl || env.VITE_TEST_MODE === 'true') && !unsafeOverride) {
    return { ok: false, unsafeOverride, message: `Mode "${mode}" is configured for mock auth. Manual signup testing must use real auth.` };
  }

  if (mode === 'test' && usesRealSupabase && !explicitlyMocked && !unsafeOverride) {
    return { ok: false, unsafeOverride, message: `Mode "${mode}" is pointing at a real Supabase URL without explicit mock auth.` };
  }

  if (usesRealSupabase && usesMockKey && !explicitlyMocked && !unsafeOverride) {
    return { ok: false, unsafeOverride, message: `Mode "${mode}" pairs a real Supabase URL with a mock Supabase anon key.` };
  }

  if (authMode === 'real' && usesMockKey && !unsafeOverride) {
    return { ok: false, unsafeOverride, message: `Mode "${mode}" declares VITE_AUTH_MODE=real but uses a mock Supabase anon key.` };
  }

  return { ok: true, unsafeOverride, message: `Vite env check passed for mode "${mode}"` };
}
