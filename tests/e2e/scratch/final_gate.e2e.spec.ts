import { test, expect } from '@playwright/test';

test('Cluster 4: Storage Context & Control', async ({ page }) => {
    const logs: any[] = [];
    page.on('console', msg => logs.push({ type: msg.type(), text: msg.text() }));
    
    await page.goto('/login');
    
    const context = await page.evaluate(async () => ({
        origin: window.location.origin,
        isIframe: window.top !== window,
        hasStorageAccess: (document as any).hasStorageAccess ? await (document as any).hasStorageAccess() : 'N/A'
    }));
    console.log('[PROBE] Context:', JSON.stringify(context));
});

test('Cluster 5: Network Transport Audit', async ({ page }) => {
    const requests: string[] = [];
    const responses: any[] = [];
    
    page.on('request', r => {
        if (r.url().includes('practice') || r.url().includes('sessions')) {
            requests.push(r.url());
        }
    });
    
    page.on('response', r => {
        if (r.url().includes('practice') || r.url().includes('sessions')) {
            responses.push({ url: r.url(), status: r.status() });
        }
    });

    await page.goto('/analytics');
    await page.waitForTimeout(5000);
    
    console.log('[PROBE] Network Requests:', JSON.stringify(requests));
    console.log('[PROBE] Network Responses:', JSON.stringify(responses));
});
