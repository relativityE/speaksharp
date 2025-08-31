import { test as base } from '@playwright/test';

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.clearCookies();
    await use(context);
  },
  page: async ({ page }, use) => {
    // nuke SW at start of each test
    await page.addInitScript(() => {
      (async () => {
        try {
          const regs = await navigator.serviceWorker?.getRegistrations?.();
          if (regs) for (const r of regs) await r.unregister();
          localStorage.clear();
          sessionStorage.clear();
          indexedDB.databases?.().then(dbs => dbs?.forEach(db => indexedDB.deleteDatabase(db.name!)));
        } catch {}
      })();
    });

    // noise-free logging
    page.on('console', m => console.log(`[BROWSER:${m.type()}] ${m.text()}`));
    page.on('pageerror', e => console.error('[PAGE ERROR]', e.message));
    page.on('requestfailed', r => console.error('[REQUEST FAILED]', r.url()));

    await use(page);
  },
});
