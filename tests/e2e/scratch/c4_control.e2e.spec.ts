import { test, expect } from '@playwright/test';

test('C4 Negative Control: Disable Persistence', async ({ page }) => {
    const logs: any[] = [];
    page.on('console', msg => logs.push(msg.text()));
    
    // Force persistSession: false in the client
    await page.addInitScript(() => {
        window.__SS_E2E_CONFIG__ = {
            auth: { persistSession: false }
        };
    });

    await page.goto('/login');
    await page.waitForTimeout(3000);
    
    const errors = logs.filter(l => l.includes('SecurityError'));
    console.log('[PROBE] C4 Errors:', JSON.stringify(errors));
});
