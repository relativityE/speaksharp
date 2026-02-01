#!/usr/bin/env node
/**
 * Phase 7: Visual Homepage Verification
 * - Headless Chromium
 * - Takes screenshot, logs base64, optionally saves .png
 * - Uses environment variables from .env.test via dotenv
 */

import 'dotenv/config';
import fs from 'fs';
import { chromium } from 'playwright';
import { PORTS } from './build.config.js';

const LOG_DIR = './logs';
const PNG_FILE = `${LOG_DIR}/homepage.png`;
const BASE64_LOG_FILE = `${LOG_DIR}/homepage-base64.log`;

(async () => {
  console.log(`[${new Date().toISOString()}] Starting homepage screenshot...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const baseUrl = process.env.VITE_BASE_URL || `http://localhost:${PORTS.DEV}`;
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Capture screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    fs.writeFileSync(PNG_FILE, screenshotBuffer);
    console.log(`[${new Date().toISOString()}] Screenshot saved as ${PNG_FILE}`);

    // Log base64 for agent inspection
    const base64Data = screenshotBuffer.toString('base64');
    fs.writeFileSync(BASE64_LOG_FILE, base64Data);
    console.log(`[${new Date().toISOString()}] Base64 screenshot logged to ${BASE64_LOG_FILE}`);
  } catch (err) {
    console.error('❌ Error capturing homepage screenshot:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
