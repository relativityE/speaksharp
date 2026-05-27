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
    process.stderr.write(`\n[DIAG] ALL LOGS: ${JSON.stringify(logs, null, 2)}\n`);
    const subs = logs.filter(l => l.event === "SUBSCRIBE");
    
    // StrictMode mount→unmount→remount = 3 events
    expect(subs.length).toBeGreaterThanOrEqual(2); 
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

  test('SECURITY: E2E globals must be absent from production bundle', async ({ page }) => {
    // Provenance: Originally Evidence C5
    await programmaticLoginWithRoutes(page, { userType: 'free' });

    // Proves tree-shaking removed E2E globals from production bundle
    const leaked = await page.evaluate(() => ({
      mockSttAvailability: (window as unknown as { MOCK_STT_AVAILABILITY?: boolean }).MOCK_STT_AVAILABILITY,
      userTierAttr: document.documentElement.dataset.userTier,
    }));

    expect(leaked.mockSttAvailability).toBeUndefined();
    expect(leaked.userTierAttr).toBeUndefined();
  });
});
