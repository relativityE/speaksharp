#!/usr/bin/env node
/**
 * Phase 2: DOM Dump
 * - Headless Chromium
 * - Dumps main page DOM to JSON file
 * - Uses environment variables from .env.test via dotenv
 */

import 'dotenv/config';
import fs from 'fs';
import { chromium } from 'playwright';

const LOG_PATH = './logs/auth-dom.json';

(async () => {
  console.log(`[${new Date().toISOString()}] Starting DOM dump...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const baseUrl = process.env.VITE_BASE_URL || 'http://localhost:5173';
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const domContent = await page.evaluate(() => document.documentElement.outerHTML);

    fs.writeFileSync(LOG_PATH, JSON.stringify({ timestamp: new Date(), dom: domContent }, null, 2));
    console.log(`[${new Date().toISOString()}] DOM dumped to ${LOG_PATH}`);
  } catch (err) {
    console.error('❌ Error dumping DOM:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
