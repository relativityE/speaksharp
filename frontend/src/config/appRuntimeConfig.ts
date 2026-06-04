/**
 * STT release-proof config-discipline (dev-owned). Publishes ONE runtime config object the
 * test-agent proof preflight reads to decide `releaseProofEligible`. The canonical mode
 * table is `APP_MODES` (scripts/build.config.js), injected at build time as `__APP_MODE_META__`.
 *
 * `releaseProofEligible` is true ONLY when everything lines up — manual mode, manual port,
 * real auth, real Supabase. Any mismatch (mock auth, test mode, wrong port, mock Supabase)
 * => false, so a human can never collect release evidence from the wrong environment.
 */

declare const __APP_MODE_META__:
  | { command: string; viteMode: string; port: number; authMode: string; releaseProofEligible: boolean }
  | undefined;

export interface AppModeMeta {
  viteMode: string;
  port: number;
  authMode: string;
  releaseProofEligible: boolean;
}

export interface AppRuntimeConfig {
  url: string;
  port: number;
  viteMode: string;
  authMode: string;
  mockAuth: boolean;
  supabaseUrl: string;
  releaseProofEligible: boolean;
}

declare global {
  interface Window {
    __APP_RUNTIME_CONFIG__?: AppRuntimeConfig;
  }
}

const USES_REAL_SUPABASE = /\.supabase\.co\/?$/;

/** Pure resolution (testable): combine canonical mode meta with the actual runtime env. */
export function computeAppRuntimeConfig(input: {
  meta: AppModeMeta;
  supabaseUrl: string;
  envAuthMode: string;
  useMockAuthEnv: boolean;
  actualPort: number;
  url: string;
}): AppRuntimeConfig {
  const { meta, supabaseUrl, envAuthMode, useMockAuthEnv, actualPort, url } = input;
  const authMode = envAuthMode || meta.authMode;
  const usesRealSupabase = USES_REAL_SUPABASE.test(supabaseUrl);
  const mockAuth =
    authMode === 'mock' || useMockAuthEnv || !usesRealSupabase || /mock|example/.test(supabaseUrl);

  const releaseProofEligible = Boolean(
    meta.releaseProofEligible &&
      meta.viteMode !== 'test' &&
      Number.isFinite(meta.port) &&
      actualPort === meta.port &&
      authMode === 'real' &&
      !mockAuth &&
      usesRealSupabase,
  );

  return { url, port: actualPort, viteMode: meta.viteMode, authMode, mockAuth, supabaseUrl, releaseProofEligible };
}

function readModeMeta(): AppModeMeta {
  // Replaced at build by vite `define`; undefined in unit tests (fall back to a safe, NOT
  // release-eligible default so nothing ever masquerades as a valid proof environment).
  if (typeof __APP_MODE_META__ !== 'undefined' && __APP_MODE_META__) {
    return __APP_MODE_META__;
  }
  return { viteMode: import.meta.env.MODE, port: Number.NaN, authMode: 'unknown', releaseProofEligible: false };
}

/** Publish `window.__APP_RUNTIME_CONFIG__` from the live env. Returns the computed config. */
export function publishAppRuntimeConfig(): AppRuntimeConfig {
  const meta = readModeMeta();
  const cfg = computeAppRuntimeConfig({
    meta,
    supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
    envAuthMode: (import.meta.env.VITE_AUTH_MODE as string | undefined) ?? '',
    useMockAuthEnv: (import.meta.env.VITE_USE_MOCK_AUTH as string | undefined) === 'true',
    actualPort:
      typeof window !== 'undefined' && window.location.port ? Number(window.location.port) : meta.port,
    url: typeof window !== 'undefined' ? window.location.href : '',
  });
  if (typeof window !== 'undefined') {
    window.__APP_RUNTIME_CONFIG__ = cfg;
  }
  return cfg;
}
