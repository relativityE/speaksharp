#!/usr/bin/env bash
set -e
echo "===== AUTH DOM INSPECTION START $(date) ====="

pnpm exec playwright eval "
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
        await page.goto('http://localhost:5173/auth', { waitUntil: 'networkidle', timeout: 30000 });

        // Get all elements with data-testid
        const els = await page.$$('[data-testid]');
        const dump = {};

        for (const el of els) {
            const id = await el.getAttribute('data-testid');
            const html = await el.evaluate(el => el.outerHTML);
            dump[id] = html;
        }

        console.log(JSON.stringify(dump, null, 2));

        // Also capture page title and URL for verification
        const title = await page.title();
        const url = page.url();
        console.log(JSON.stringify({ meta: { title, url } }, null, 2));

    } catch (error) {
        console.error('Error inspecting DOM:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
})();
"
