export const PORTS = {
    PROD: 5174,
    TEST: 5173,
    DEV: 5173,
    PREVIEW: 4173,
};

/**
 * Canonical app modes — the SINGLE source of truth for port / auth / release-proof
 * eligibility. There are ONLY TWO modes; everything else maps to one of them or fails loudly.
 *
 *   pnpm dev      -> 5174 -> real auth  -> release-proof ELIGIBLE
 *   pnpm dev:test -> 5173 -> mock auth  -> diagnostics only (NEVER release evidence)
 *
 * Consumed by: launch scripts (start-vite banner), the app guard, the app runtime config
 * (frontend appRuntimeConfig.ts), and the test-agent proof preflight.
 */
export const APP_MODES = {
    manual: { command: 'pnpm dev', viteMode: 'development', port: PORTS.PROD, authMode: 'real', releaseProofEligible: true },
    test: { command: 'pnpm dev:test', viteMode: 'test', port: PORTS.TEST, authMode: 'mock', releaseProofEligible: false },
};

/** Resolve the canonical mode from a vite mode string ('test' -> mocked, else manual). */
export function resolveAppMode(viteMode) {
    return viteMode === 'test' ? APP_MODES.test : APP_MODES.manual;
}

/**
 * Resolve the canonical mode meta to publish in the runtime config, reporting the ACTUAL
 * vite mode string as `viteMode` (priority-10 release hygiene). `resolveAppMode` reuses the
 * `manual` entry for every non-test mode — including a `--mode production` build — and `manual`
 * hardcodes `viteMode: 'development'`. Publishing that in production made `__APP_RUNTIME_CONFIG__`
 * report `viteMode: 'development'` on the live site (a misleading diagnostic surface). The
 * auth/port/release-proof semantics are unchanged (still sourced from `resolveAppMode`); only the
 * reported label becomes truthful: 'production' in prod, 'development' in dev, 'test' in test.
 * Release-proof eligibility keys off `viteMode !== 'test'`, so prod ('production') stays eligible.
 */
export function resolveAppModeMeta(viteMode) {
    return { ...resolveAppMode(viteMode), viteMode };
}
