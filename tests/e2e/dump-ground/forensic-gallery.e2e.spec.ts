import { test, expect } from '@playwright/test';
import { getProbe, programmaticLoginWithRoutes, navigateToRoute } from '../helpers';

/**
 * FORENSIC GALLERY: Stabilization Sprint Evidence Proofs
 * 
 * This file serves as the canonical audit trail for race conditions and 
 * architectural vulnerabilities resolved during the Phase 5 (Finalization) 
 * stabilization cycle.
 * 
 * Mandate: Adheres to functional naming and 100% type safety (Zero-Any).
 */

test.describe('Forensic Gallery: Stabilization Evidence', () => {

  test('Lifecycle Subscription Audit: Verify cleanup-sync parity', async ({ page }) => {
    // Provenance: Originally Evidence C1
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');

    // Allow lifecycle settle
    await page.waitForTimeout(2000); 

    const logs = await getProbe(page);
    const subs = logs.filter(l => l.event === "SUBSCRIBE");
    
    // Baseline: 1 App Init + 1 Session Mount
    expect(subs.length).toBe(2); 
  });

  test('Store State Transit Audit: Verify non-blocking transitions', async ({ page }) => {
    // Provenance: Originally Evidence C2
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');

    const recordButton = page.getByTestId('session-start-stop-button');
    await recordButton.click();

    await page.waitForTimeout(1500);

    const logs = await getProbe(page);
    const blocked = logs.filter(l => l.event === "STATE_BLOCKED");

    // Success if no valid transitions were blocked by the store guard
    expect(blocked.length).toBe(0);
  });

  test('Global Scope Audit: Identify bootstrap resolution paths', async ({ page }) => {
    // Provenance: Originally Evidence C5
    await programmaticLoginWithRoutes(page, { userType: 'free' });

    await page.evaluate(() => {
        const win = window as Window & { MOCK_STT_AVAILABILITY?: boolean; __SS_E2E__?: { MOCK_STT_AVAILABILITY: boolean } };
        return {
            isStandaloneGlobal: typeof win.MOCK_STT_AVAILABILITY !== 'undefined',
            manifestValue: win.__SS_E2E__?.MOCK_STT_AVAILABILITY
        };
    });

    // High-fidelity resolution proof (eval simulation)
    const evalResult = await page.evaluate(() => {
        try {
            const win = window as unknown as { __SS_E2E__: { MOCK_STT_AVAILABILITY: boolean } };
            return { ok: true, source: 'manifest', value: win.__SS_E2E__.MOCK_STT_AVAILABILITY };
        } catch (e) {
            return { ok: false, error: (e as Error).message };
        }
    });

    expect(evalResult.ok).toBe(true);
    expect(evalResult.value).toBe(true);
  });
});
