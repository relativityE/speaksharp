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

/**
 * Class of the runtime Stripe publishable key. Publishable keys are NOT secrets (they ship in
 * the client bundle by design), but the *class* matters: a production deploy must run `live`,
 * never `test`. `missing` means no key was injected (fail-closed → ConfigurationNeededPage).
 */
export type StripeKeyClass = 'live' | 'test' | 'missing' | 'unknown';

/** Pure, testable classifier for the runtime Stripe publishable key. */
export function classifyStripeKey(key: string | undefined | null): StripeKeyClass {
  const value = (key ?? '').trim();
  if (value === '') return 'missing';
  if (value.startsWith('pk_live_')) return 'live';
  if (value.startsWith('pk_test_')) return 'test';
  return 'unknown';
}

export interface AppRuntimeConfig {
  url: string;
  port: number;
  viteMode: string;
  authMode: string;
  mockAuth: boolean;
  supabaseUrl: string;
  releaseProofEligible: boolean;
  /** Observable proof of the Stripe key class in the live runtime (see classifyStripeKey). */
  stripeKeyClass: StripeKeyClass;
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
  stripeKey?: string;
}): AppRuntimeConfig {
  const { meta, supabaseUrl, envAuthMode, useMockAuthEnv, actualPort, url, stripeKey } = input;
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

  return {
    url,
    port: actualPort,
    viteMode: meta.viteMode,
    authMode,
    mockAuth,
    supabaseUrl,
    releaseProofEligible,
    stripeKeyClass: classifyStripeKey(stripeKey),
  };
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
    stripeKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined,
  });
  if (typeof window !== 'undefined') {
    window.__APP_RUNTIME_CONFIG__ = cfg;
  }
  return cfg;
}
