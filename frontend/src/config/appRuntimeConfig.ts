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

/** Build/release id injected into index.html (window.__APP_RELEASE__) — the git commit SHA in production
 * (PROD-CONFIG-1). NOT a JS `define`, so the volatile SHA never rotates chunk hashes across deploys. */

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

/**
 * Pure, testable: are public payment/checkout surfaces enabled? Release rule is
 * fail-closed to LIVE: surfaces render ONLY for a live key (`pk_live_`). Any other
 * class — 'missing', 'test', or 'unknown' — hides/disables checkout. Rationale: a
 * test-mode (or broken) checkout shown in production is a monetized-funnel release
 * blocker, and the app must still boot without Stripe (Stripe is NOT required for
 * core STT). A real test checkout belongs behind explicit dev/test tooling, not
 * public release UI.
 */
export function arePaymentsEnabledFor(key: string | undefined | null): boolean {
  return classifyStripeKey(key) === 'live';
}

/**
 * Explicit beta billing kill-switch, defaulting OFF. A live Stripe publishable key must NOT, on its
 * own, enable checkout: payments require a deliberate `VITE_PAYMENTS_ENABLED=true` in addition to a
 * valid live key. This makes the no-billing beta fail closed even if a live key is present in prod.
 */
export function isPaymentsExplicitlyEnabled(): boolean {
  return (import.meta.env.VITE_PAYMENTS_ENABLED as string | undefined) === 'true';
}

/**
 * Pure, testable: public payment/checkout surfaces are enabled ONLY when BOTH conditions hold —
 * payments are explicitly enabled AND the Stripe publishable key classifies as `live`. Anything
 * else (flag off, missing/test/unknown key) is disabled. Frontend hiding is not the security
 * boundary; the `stripe-checkout` edge function enforces the same rule server-side.
 */
export function paymentsEnabled(explicitlyEnabled: boolean, key: string | undefined | null): boolean {
  return explicitlyEnabled === true && arePaymentsEnabledFor(key);
}

/** Runtime convenience wrapper: explicit enablement flag AND a live publishable key. */
export function arePaymentsEnabled(): boolean {
  return paymentsEnabled(
    isPaymentsExplicitlyEnabled(),
    import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined,
  );
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
  /** Build/release id — the git commit SHA in production; lets ops/test pin a report to a build (PROD-CONFIG-1). */
  release: string;
}

declare global {
  interface Window {
    __APP_RUNTIME_CONFIG__?: AppRuntimeConfig;
    /** Release id (commit SHA in prod) injected into index.html by the release-inject Vite plugin. */
    __APP_RELEASE__?: string;
  }
}

/**
 * The ONLY AppRuntimeConfig fields that may be PERSISTED (e.g. in an issue report's metadata blob).
 * Deliberately EXCLUDES every URL-bearing / environment-locating field:
 *   - `url`         — the raw `window.location.href`; carries dynamic route ids (session UUIDs), query
 *                     strings, and fragments (emails / reset+invite tokens can appear in any of these).
 *   - `port`        — noise, no support value.
 *   - `supabaseUrl` — a raw origin, and redundant: the environment is already conveyed by
 *                     `stripeKeyClass` + `release`.
 * NEVER widen this to include any raw URL, pathname, query string, fragment, or dynamic identifier.
 */
export type PersistedRuntimeConfig = Pick<
  AppRuntimeConfig,
  'viteMode' | 'authMode' | 'mockAuth' | 'stripeKeyClass' | 'releaseProofEligible' | 'release'
>;

/**
 * Reduce a full runtime config to the persistence allowlist. Explicit field-by-field pick (not a
 * denylist) so a future field added to AppRuntimeConfig can never silently leak into persisted metadata.
 */
export function pickPersistedRuntimeConfig(
  cfg: AppRuntimeConfig | undefined | null,
): PersistedRuntimeConfig | undefined {
  if (!cfg) return undefined;
  return {
    viteMode: cfg.viteMode,
    authMode: cfg.authMode,
    mockAuth: cfg.mockAuth,
    stripeKeyClass: cfg.stripeKeyClass,
    releaseProofEligible: cfg.releaseProofEligible,
    release: cfg.release,
  };
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
  release?: string;
}): AppRuntimeConfig {
  const { meta, supabaseUrl, envAuthMode, useMockAuthEnv, actualPort, url, stripeKey, release } = input;
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
    release: (release ?? '').trim() || 'unknown',
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
    release: typeof window !== 'undefined' ? window.__APP_RELEASE__ : undefined,
  });
  if (typeof window !== 'undefined') {
    window.__APP_RUNTIME_CONFIG__ = cfg;
  }
  return cfg;
}
