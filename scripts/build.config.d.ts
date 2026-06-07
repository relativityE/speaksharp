export const PORTS: {
    readonly PROD: 5174;
    readonly TEST: 5173;
    readonly DEV: 5173;
    readonly PREVIEW: 4173;
};

export interface AppModeEntry {
    command: string;
    viteMode: string;
    port: number;
    authMode: string;
    releaseProofEligible: boolean;
}

export const APP_MODES: {
    manual: AppModeEntry;
    test: AppModeEntry;
};

/** Resolve the canonical mode entry from a vite mode string ('test' -> mocked, else manual). */
export function resolveAppMode(viteMode: string): AppModeEntry;

/**
 * Canonical mode meta to publish in the runtime config, reporting the ACTUAL vite mode string
 * as `viteMode` while preserving manual's auth/port/release-proof semantics (priority-10 fix).
 */
export function resolveAppModeMeta(viteMode: string): AppModeEntry;
