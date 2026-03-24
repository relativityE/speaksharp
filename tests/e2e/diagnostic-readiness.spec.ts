import { test } from './fixtures';
import { navigateToRoute } from './helpers';
import logger from '../../frontend/src/lib/logger';

test('DIAGNOSTIC: dump readiness state', async ({ proPage: page }) => {
    // Capture ALL browser console output
    page.on('console', msg => {
        if (msg.text().includes('__APP_READY_STATE__')) {
            logger.info(`[BROWSER DIAG] ${msg.text()}`);
        }
    });

    await navigateToRoute(page, '/session');
    
    const state = await page.evaluate(() => {
        return {
            readyState: (window as unknown as { __APP_READY_STATE__: unknown }).__APP_READY_STATE__,
            dataAppReady: document.documentElement.getAttribute('data-app-ready'),
            url: window.location.href
        };
    });

    logger.info({ state }, '[DIAGNOSTIC RESULT] Readiness State Dump');
});
