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
