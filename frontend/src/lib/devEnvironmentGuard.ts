export type DevAuthMode = 'real' | 'mock' | 'unspecified';

export interface DevEnvironmentStatus {
  valid: boolean;
  authMode: DevAuthMode;
  expectedPort: number;
  currentPort: number | null;
  message?: string;
}

export const DEV_PORTS = {
  PROD: 5174,
  TEST: 5173,
} as const;

const getAuthMode = (): DevAuthMode => {
  const mode = import.meta.env.VITE_AUTH_MODE;
  if (mode === 'real' || mode === 'mock') return mode;
  if (import.meta.env.VITE_USE_MOCK_AUTH === 'true') return 'mock';
  return 'unspecified';
};

export function getDevEnvironmentStatus(): DevEnvironmentStatus {
  const viteMode = import.meta.env.MODE;
  const authMode = getAuthMode();
  const currentPort = typeof window === 'undefined' ? null : Number(window.location.port || 80);
  const url = String(import.meta.env.VITE_SUPABASE_URL || '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
  const usesMockUrl = !url || /mock|example|localhost/.test(url);
  const usesMockKey = !anonKey || anonKey.startsWith('mock_') || anonKey.includes('fake');
  const usesRealSupabase = /\.supabase\.co\/?$/.test(url);
  const isTestMode = viteMode === 'test' || import.meta.env.VITE_TEST_MODE === 'true';
  const expectedPort = isTestMode ? DEV_PORTS.TEST : DEV_PORTS.PROD;
  const unsafeOverride = import.meta.env.ALLOW_UNSAFE_MIXED_SUPABASE_CONFIG === 'true';

  if (unsafeOverride || import.meta.env.PROD) {
    return { valid: true, authMode, expectedPort, currentPort };
  }

  if (currentPort && currentPort !== expectedPort) {
    return {
      valid: false,
      authMode,
      expectedPort,
      currentPort,
      message: `Mode ${viteMode} must run on port ${expectedPort}, but this app is on ${currentPort}.`,
    };
  }

  if (!isTestMode && (authMode === 'mock' || usesMockKey || usesMockUrl)) {
    return {
      valid: false,
      authMode,
      expectedPort,
      currentPort,
      message: 'Manual app mode is using mock/test auth configuration.',
    };
  }

  if (isTestMode && usesRealSupabase && authMode !== 'mock') {
    return {
      valid: false,
      authMode,
      expectedPort,
      currentPort,
      message: 'Test app mode is pointing at a real Supabase project without explicit mock auth.',
    };
  }

  return { valid: true, authMode, expectedPort, currentPort };
}
