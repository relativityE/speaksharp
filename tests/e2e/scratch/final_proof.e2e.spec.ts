import { test, expect } from '@playwright/test';

test('Cluster 4: Auth Origin & Storage Proof', async ({ page }) => {
    await page.goto('/login');
    const origin = await page.evaluate(() => window.location.origin);
    console.log('[PROBE] Origin:', origin);

    const storageError = await page.evaluate(async () => {
        try {
            localStorage.setItem('probe', '1');
            return 'OK';
        } catch (e: any) {
            return e.message;
        }
    });
    console.log('[PROBE] Storage Status:', storageError);
});

test('Cluster 5: Analytics Dependency Timing', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => logs.push(msg.text()));
    
    await page.goto('/analytics');
    // Wait for a reasonable duration to capture query settlement
    await page.waitForTimeout(5000);
    
    console.log('[PROBE] Analytics Logs:');
    logs.filter(l => l.includes('useAnalytics') || l.includes('setReady')).forEach(l => console.log(l));
});
