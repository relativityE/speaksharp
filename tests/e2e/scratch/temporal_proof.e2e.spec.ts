import { test, expect } from '@playwright/test';

test('Cluster 5: Temporal Auth Invariant', async ({ page }) => {
    const authStates: any[] = [];
    page.on('console', msg => {
        if (msg.text().includes('Auth Ready')) authStates.push(msg.text());
    });
    
    await page.goto('/analytics');
    // Monitor user state for 10 seconds
    const userState = await page.evaluate(async () => {
        const start = Date.now();
        const results = [];
        while (Date.now() - start < 10000) {
            results.push({ time: Date.now(), user: (window as any).__SS_E2E__?.user || null });
            await new Promise(r => setTimeout(r, 1000));
        }
        return results;
    });
    console.log('[PROBE] Temporal User States:', JSON.stringify(userState));
    console.log('[PROBE] Auth Signals:', JSON.stringify(authStates));
});
