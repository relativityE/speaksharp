import { test, expect } from '@playwright/test';

test('Cluster Diagnostics: Env & Logic', async ({ page }) => {
    await page.goto('/');

    // Q4.3: localStorage Check
    const storageStatus = await page.evaluate(() => {
        try {
            localStorage.setItem('__E2E_STORAGE_TEST__', '1');
            const val = localStorage.getItem('__E2E_STORAGE_TEST__');
            localStorage.removeItem('__E2E_STORAGE_TEST__');
            return val === '1' ? 'OK' : 'VALUE_MISMATCH';
        } catch (e: any) {
            return `ERROR: ${e.message}`;
        }
    });
    console.log(`[DIAGNOSTIC] Cluster 4 Storage: ${storageStatus}`);

    // Q5.3: Force Readiness Negative Control
    await page.goto('/analytics');
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-app-ready', 'true');
    });
    const readyAttr = await page.getAttribute('html', 'data-app-ready');
    console.log(`[DIAGNOSTIC] Cluster 5 Forced Readiness: ${readyAttr}`);

    // Q6.1/6.3: Filler Propagation Check
    // (We will check this in a separate run with logging)
});
