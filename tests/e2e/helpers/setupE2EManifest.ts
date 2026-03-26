import { Page } from '@playwright/test';

/**
 * setupE2EManifest — Atomic T=0 injection.
 *
 * Clears stale state and injects the deterministic E2E manifest
 * before the application boots. Accepts the same shape as window.__SS_E2E__.
 */
export async function setupE2EManifest(
  page: Page,
  config: {
    engineType?: string;
    registry?: Record<string, unknown>;
    flags?: { bypassMutex?: boolean; fastTimers?: boolean };
    debug?: boolean;
    storage?: Record<string, string>;
  }
) {
  const { storage = {}, ...manifest } = config;

  await page.addInitScript(({ m, s }) => {
    const manifest = m as { 
      flags?: Record<string, unknown>; 
      engineType?: string;
      isActive?: boolean;
    };
    const storage = s as Record<string, string>;

    // 1. CLEAR: Strict Zero baseline — no stale state from previous runs
    window.localStorage.clear();

    // 2. STORAGE: Re-inject specific tokens if provided (e.g. auth session)
    Object.entries(storage).forEach(([key, val]) => {
      window.localStorage.setItem(key, val);
    });

    // 3. MANIFEST: Inject the E2E bridge before any module is imported
    window.__SS_E2E__ = {
      isActive: true,
      flags: {
        bypassMutex: true,
        fastTimers: true,
        ...(manifest.flags || {}),
      },
      ...manifest,
    } as unknown as { isActive: boolean; [key: string]: unknown }; // Explicit cast for script boundary

    console.log('[T=0] Manifest injected, engineType:', manifest.engineType);
  }, { m: manifest, s: storage });
}
