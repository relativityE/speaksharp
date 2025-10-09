#!/usr/bin/env bash
set -e
echo "===== AUTH DOM INSPECTION START $(date) ====="
timeout 300s pnpm exec playwright eval "
  const { chromium } = require('playwright');
  (async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:5173/auth');
    const els = await page.$$('[data-testid]');
    const dump = {};
    for (const el of els) {
      const id = await el.getAttribute('data-testid');
      const html = await el.evaluate(el => el.outerHTML);
      dump[id] = html;
    }
    console.log(JSON.stringify(dump, null, 2));
    await browser.close();
  })();
" | tee ./logs/auth-dom.json