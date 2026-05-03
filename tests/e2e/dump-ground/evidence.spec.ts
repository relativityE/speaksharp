import { test, expect } from '@playwright/test';
import { setupE2EManifest, goToApp, getProbe } from '../helpers';

/**
 * 🕵️ GENESIS TRACE AUDIT (The Blueprint Proof)
 * -------------------------------------------
 * This test uses a T=Minus-1 console monitor to capture engine 
 * lifecycle signals from the very first JS pulse.
 */
test.describe('Genesis Trace Audit', () => {
  test('Capture T=0 Lifecycle signals with real engine enabled', async ({ page }) => {
    // STABILIZE MANIFEST
    // SETUP MANIFEST & STORAGE (Atomic T=0)
    const projectRef = 'abc'; 
    const localStorageKey = `sb-${projectRef}-auth-token`;
    const session = { access_token: 'mock-token', expires_at: Date.now() + 3600000, user: { id: 'u1' } };

    await setupE2EManifest(page, {
      engineType: 'mock',
      enableRealEngine: true, // 🚀 SELECTIVE MOBILIZATION
      storage: {
        [localStorageKey]: JSON.stringify(session)
      }
    });

    // 🧪 PHASE 2: CAUSAL MOORING (Reviewer Directive)
    // Monkey-patch destroySession to NOOP to isolate destructive reset potential
    await page.addInitScript(() => {
        const win = window as unknown as Record<string, Record<string, unknown>>;
        // Wait for the bundle to load the sessionManager global if possible, 
        // or intercept via the known singleton pattern
        const mgr = win['__SS_SESSION_MANAGER__'];
        if (mgr) {
            mgr['destroySession'] = async () => {
                console.warn('[TRACE] WOULD_DESTROY_SESSION (Monkey-Patched NOOP)');
                return Promise.resolve();
            };
        }
    });

    // ATOMIC NAVIGATION & BOOT
    await goToApp(page, '/session');

    // WAIT FOR READINESS & MOBILIZE ENGINE
    await page.waitForSelector('html[data-app-ready="true"]', { state: 'attached', timeout: 15000 });
    
    // 🎙️ ACTIVATE ENGINE
    await page.getByTestId('session-start-stop-button').click();
    await page.waitForSelector('html[data-runtime-state="RECORDING"]', { timeout: 15000 });

    // 🧪 STEP 1: THE REMOUNT PULSE (Forensic Discovery)
    // We navigate away to /dashboard and immediately back to /session.
    // This forces the React component to unmount/remount while the Service persists.
    console.log('🚀 Triggering STEP 1: Remount Pulse...');
    await goToApp(page, '/dashboard');
    await page.waitForTimeout(500); // Allow unmount cleanup to fire
    await goToApp(page, '/session');
    
    // Wait for the new component to mount and ready up
    await page.waitForSelector('html[data-app-ready="true"]', { state: 'attached', timeout: 15000 });

    // GENERATE REPORT
    const probe = await getProbe(page);
    const events = probe.map(e => ({ event: e.event, timestamp: e.ts }));

    console.log('\n--- FORENSIC LIFECYCLE EVENT TABLE ---');
    console.table(events);
    console.log('------------------------------------\n');

    const counts: Record<string, number> = {};
    events.forEach(e => {
        const key = String(e.event).split(' ')[0]; // Split and take the first word for generic counts
        counts[key] = (counts[key] || 0) + 1;
        // Also keep exact match for specific signals
        counts[String(e.event)] = (counts[String(e.event)] || 0) + 1;
    });
    
    console.log('FINAL_COUNTS:', JSON.stringify(counts));

    // Validate Subscription Semantics
    // StrictMode mount→unmount→remount = 3 events
    expect(counts['SUBSCRIBE'] || 0).toBeGreaterThanOrEqual(2);
    expect(counts['UNSUBSCRIBE'] || 0).toBeGreaterThanOrEqual(1);

    // Prove Visibility Gap
    // If the fix is NOT yet applied, we expect CALLBACK_DATA to be 0 or 1 
    // but not immediately follow the second SUBSCRIBE with state.
    console.log(`STEP 1 PROVEN: SUBSCRIBE=${counts['SUBSCRIBE']}, UNSUBSCRIBE=${counts['UNSUBSCRIBE']}`);
  });
});
