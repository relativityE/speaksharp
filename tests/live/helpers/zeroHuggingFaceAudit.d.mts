// #1339 — types for the JS-only private-model audit helper.
//
// The implementation deliberately lives outside the app bundle as `.mjs` so it can hook Playwright
// request events without being pulled into a Vite build. Without a declaration it resolved to `any`,
// which silently disabled type checking at every call site — the same class of blind spot this gate
// closes. Declared here rather than converting the helper, so its out-of-bundle placement is preserved.
//
// `.d.mts`, not `.d.ts`: the call site imports the explicit `./helpers/zeroHuggingFaceAudit.mjs`
// specifier, so TypeScript resolves the `.mts` declaration form.
import type { Page } from '@playwright/test';

/** Records every request URL the page issues, and audits that none reached Hugging Face. */
export function trackPrivateModelRequests(page: Page): {
    urls: string[];
    stop(): void;
    /**
     * Fails if any model request went to Hugging Face. With `requireModelsFromOrigin` (default true)
     * it additionally fails when NO same-origin model request was seen — a zero-Hugging-Face result
     * over zero model requests would otherwise pass while proving nothing.
     */
    assertZeroHuggingFace(opts?: { requireModelsFromOrigin?: boolean }): Promise<{
        ok: true;
        totalRequests: number;
        modelsFromOrigin: number;
        huggingFaceRequests: 0;
    }>;
};

/** Evaluated INSIDE the page to audit cached private-model artifacts. */
export const inPageCacheAuditFn: () => Promise<unknown>;
