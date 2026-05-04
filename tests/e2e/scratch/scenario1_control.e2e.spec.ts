import { test, expect } from '@playwright/test';

test('Scenario 1 Negative Control: Force Download Gate', async ({ page }) => {
    // 1. Setup gate bypass before navigation
    await page.addInitScript(() => {
        console.log('[PROBE] Setting up download gate intercept');
        Object.defineProperty(window, '__E2E_FINISH_DOWNLOAD__', {
            set: (val) => {
                if (typeof val === 'function') {
                    console.log('[PROBE] Download gate triggered - Auto-resolving');
                    val();
                }
            },
            configurable: true
        });
    });

    await page.goto('/session');
    
    // 2. Wait for forensic anchor
    await expect.poll(async () => await page.getAttribute('html', 'data-engine-ready'), { timeout: 30000 }).toBe('true');
    console.log('[PROBE] Success: data-engine-ready is true');
});
