#!/usr/bin/env node

/**
 * Node script that uses Playwright's library to dump [data-testid] elements on /auth.
 * ENHANCED: Captures console logs, errors, and full diagnostic info
 *
 * FIXED: Uses timeout and domcontentloaded instead of networkidle to prevent hangs
 */

import { chromium } from 'playwright';

(async () => {
  let browser;
  const timeout = 30000; // 30 second timeout
  const consoleLogs = [];
  const consoleErrors = [];
  const pageErrors = [];

  try {
    console.error('[Inspector] Launching browser...');
    browser = await chromium.launch({
      headless: true,
      timeout: timeout
    });

    const page = await browser.newPage();

    // Set a default timeout for all operations
    page.setDefaultTimeout(timeout);

    // CAPTURE CONSOLE LOGS
    page.on('console', msg => {
      const logEntry = {
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString()
      };

      consoleLogs.push(logEntry);

      if (msg.type() === 'error') {
        consoleErrors.push(logEntry);
        console.error(`[Browser Console Error] ${msg.text()}`);
      } else {
        console.error(`[Browser Console ${msg.type()}] ${msg.text()}`);
      }
    });

    // CAPTURE PAGE ERRORS (uncaught exceptions)
    page.on('pageerror', error => {
      const errorInfo = {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      };

      pageErrors.push(errorInfo);
      console.error('[Browser Page Error] ❌', error.message);
      console.error('[Stack]', error.stack);
    });

    // CAPTURE FAILED REQUESTS
    const failedRequests = [];
    page.on('requestfailed', request => {
      const failInfo = {
        url: request.url(),
        method: request.method(),
        failure: request.failure(),
        timestamp: new Date().toISOString()
      };

      failedRequests.push(failInfo);
      console.error('[Failed Request]', request.url(), request.failure()?.errorText);
    });

    console.error('[Inspector] Navigating to /auth...');

    // Use 'domcontentloaded' instead of 'networkidle' - much more reliable
    await page.goto('http://localhost:5175/auth', {
      waitUntil: 'domcontentloaded',
      timeout: timeout
    });

    console.error('[Inspector] Page loaded, waiting for potential React hydration...');

    // Give React a moment to hydrate and potentially error
    await page.waitForTimeout(3000);

    console.error('[Inspector] Extracting [data-testid] elements...');

    const els = await page.$$('[data-testid]');

    console.error(`[Inspector] Found ${els.length} elements with data-testid`);

    // Extract data-testid elements
    const testIdDump = {};
    for (const el of els) {
      const id = await el.getAttribute('data-testid');
      const html = await el.evaluate(e => e.outerHTML);
      testIdDump[id] = html;
    }

    // Get page state
    const pageState = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      hasRoot: !!document.getElementById('root'),
      rootHTML: document.getElementById('root')?.innerHTML || '(empty)',
      bodyHTML: document.body.innerHTML.substring(0, 1000), // First 1000 chars
      readyState: document.readyState,
      scriptTags: Array.from(document.querySelectorAll('script')).map(s => ({
        src: s.src,
        type: s.type,
        hasContent: s.textContent.length > 0
      })),
      // Check for common React/Vite globals
      hasReact: typeof window.React !== 'undefined',
      hasReactDOM: typeof window.ReactDOM !== 'undefined',
      hasVite: '__VITE_PRELOAD_' in window || '__vite__' in window,
      // Check for MSW
      mswReady: window.mswReady,
      // Check for errors stored by app
      appErrors: window.__APP_ERRORS__ || [],
      // LocalStorage
      localStorageKeys: Object.keys(localStorage)
    }));

    console.error('[Inspector] Extraction complete, generating report...');

    // Build comprehensive report
    const report = {
      timestamp: new Date().toISOString(),
      success: pageErrors.length === 0 && consoleErrors.length === 0,
      pageState,
      testIdElements: testIdDump,
      testIdCount: Object.keys(testIdDump).length,
      diagnostics: {
        consoleLogs,
        consoleErrors,
        pageErrors,
        failedRequests
      },
      analysis: {
        hasPageErrors: pageErrors.length > 0,
        hasConsoleErrors: consoleErrors.length > 0,
        hasFailedRequests: failedRequests.length > 0,
        rootIsEmpty: pageState.rootHTML === '(empty)',
        reactLoaded: pageState.hasReact,
        mswReady: pageState.mswReady
      }
    };

    // Output to stdout (console.log)
    console.log(JSON.stringify(report, null, 2));

    console.error('\n========== DIAGNOSTIC SUMMARY ==========');
    console.error('Page Errors:', pageErrors.length);
    console.error('Console Errors:', consoleErrors.length);
    console.error('Failed Requests:', failedRequests.length);
    console.error('Test IDs Found:', Object.keys(testIdDump).length);
    console.error('Root Element Empty:', report.analysis.rootIsEmpty);
    console.error('React Loaded:', pageState.hasReact);
    console.error('MSW Ready:', pageState.mswReady);

    if (pageErrors.length > 0) {
      console.error('\n❌ CRITICAL: Page has JavaScript errors!');
      console.error('These errors prevent the app from rendering.');
      pageErrors.forEach((err, i) => {
        console.error(`\nError ${i + 1}:`);
        console.error('  Message:', err.message);
        console.error('  Stack:', err.stack);
      });
    }

    if (consoleErrors.length > 0) {
      console.error('\n⚠️  Console errors detected:');
      consoleErrors.forEach((err, i) => {
        console.error(`  ${i + 1}. [${err.type}] ${err.text}`);
      });
    }

    if (report.analysis.rootIsEmpty) {
      console.error('\n⚠️  WARNING: Root element is empty - React did not mount!');
    }

    console.error('========================================\n');
    console.error('[Inspector] Done!');

    process.exit(pageErrors.length > 0 ? 1 : 0);

  } catch (error) {
    console.error('[Inspector] FATAL ERROR:', error.message);
    console.error('[Inspector] Stack:', error.stack);
    process.exit(1);

  } finally {
    if (browser) {
      console.error('[Inspector] Closing browser...');
      await browser.close();
    }
  }
})();
