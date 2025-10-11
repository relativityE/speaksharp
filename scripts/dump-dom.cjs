#!/usr/bin/env node

/**
 * Diagnostic script to dump DOM state after authentication attempt
 * This will help identify if the issue is with the environment or the test logic
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function dumpDOM() {
    console.log('=== DOM Dump Diagnostic Script (With Auth) ===');
    console.log('Starting at:', new Date().toISOString());

    // Load environment variables from .env.test if it exists
    const dotenvPath = path.join(process.cwd(), '.env.test');
    if (fs.existsSync(dotenvPath)) {
        require('dotenv').config({ path: dotenvPath });
        console.log('✓ Loaded .env.test');
    } else {
        console.log('ℹ️  No .env.test found (this is normal)');
    }

    // Use environment variables or fallback to mock values for local testing
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'mock-password';
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'mock-anon-key';

    console.log('\n[ENV CHECK]');
    console.log('  TEST_USER_EMAIL:', process.env.TEST_USER_EMAIL ? '✓ Set from env' : 'ℹ️  Using mock value');
    console.log('  TEST_USER_PASSWORD:', process.env.TEST_USER_PASSWORD ? '✓ Set from env' : 'ℹ️  Using mock value');
    console.log('  VITE_SUPABASE_URL:', process.env.VITE_SUPABASE_URL ? '✓ Set from env' : 'ℹ️  Using mock value');
    console.log('  VITE_SUPABASE_ANON_KEY:', process.env.VITE_SUPABASE_ANON_KEY ? '✓ Set from env' : 'ℹ️  Using mock value');
    console.log('\n  Note: Mock values are fine for DOM inspection. Real auth not required.');

    let browser;
    try {
        console.log('\n[1/6] Launching browser...');
        browser = await chromium.launch({
            headless: true,
            timeout: 30000
        });
        console.log('✓ Browser launched successfully');

        console.log('\n[2/6] Creating new page...');
        const page = await browser.newPage();
        console.log('✓ Page created');

        console.log('\n[3/6] Performing programmatic login simulation...');

        // Create a mock auth session (simulating what programmaticLogin does)
        const mockSession = {
            access_token: 'mock-token-' + Date.now(),
            refresh_token: 'mock-refresh-' + Date.now(),
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
            user: {
                id: 'test-user-id',
                email: testEmail,
                aud: 'authenticated',
                role: 'authenticated',
                email_confirmed_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            }
        };

        // Set localStorage with the auth session
        await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });

        await page.evaluate(({ session, supabaseUrl }) => {
            // Try multiple localStorage key patterns that Supabase might use
            const urlParts = supabaseUrl.split('//')[1]?.split('.') || ['local'];
            const projectRef = urlParts[0];

            const possibleKeys = [
                `sb-${projectRef}-auth-token`,
                `sb-auth-token`,
                `supabase.auth.token`
            ];

            possibleKeys.forEach(key => {
                localStorage.setItem(key, JSON.stringify(session));
                console.log('Set localStorage key:', key);
            });

            // Also set as separate access/refresh tokens (older Supabase format)
            localStorage.setItem('supabase.auth.access_token', session.access_token);
            localStorage.setItem('supabase.auth.refresh_token', session.refresh_token);

        }, { session: mockSession, supabaseUrl });

        console.log('✓ Mock session set in localStorage (multiple key formats)');

        console.log('\n[4/6] Navigating to homepage (should be authenticated)...');
        await page.goto('http://localhost:5173', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        console.log('✓ Navigation complete');
        console.log('  Current URL:', page.url());
        console.log('  Page title:', await page.title());

        console.log('\n[5/6] Extracting DOM data...');

        // Check for Sign Out button specifically
        const signOutButton = await page.$('[data-testid="sign-out-button"]');
        console.log('  Sign Out button found:', !!signOutButton);

        // Get all elements with data-testid
        const testIds = await page.$$eval('[data-testid]', elements =>
            elements.map(el => ({
                testId: el.getAttribute('data-testid'),
                tagName: el.tagName,
                text: el.textContent?.trim().substring(0, 100),
                visible: el.offsetParent !== null
            }))
        );

        // Get authentication state from the page
        const authState = await page.evaluate(() => {
            // Check localStorage for auth tokens
            const keys = Object.keys(localStorage);
            const authKeys = keys.filter(k => k.includes('auth'));
            const authData = {};
            authKeys.forEach(k => {
                try {
                    authData[k] = JSON.parse(localStorage.getItem(k));
                } catch {
                    authData[k] = localStorage.getItem(k);
                }
            });

            return {
                localStorageKeys: keys,
                authKeys: authKeys,
                authData: authData,
                hasAuthProvider: !!window.authProvider,
                isAuthenticated: window.isAuthenticated,
                currentUser: window.currentUser
            };
        });

        console.log('  Auth state:', JSON.stringify(authState, null, 2));

        // Get page structure
        const structure = await page.evaluate(() => ({
            bodyClasses: document.body.className,
            hasAuthForm: !!document.querySelector('form'),
            hasSignOutButton: !!document.querySelector('[data-testid="sign-out-button"]'),
            allButtons: Array.from(document.querySelectorAll('button')).map(b => ({
                type: b.type,
                text: b.textContent?.trim(),
                testId: b.getAttribute('data-testid'),
                visible: b.offsetParent !== null
            })),
            navigationElements: Array.from(document.querySelectorAll('nav a, nav button')).map(el => ({
                tag: el.tagName,
                text: el.textContent?.trim(),
                href: el.href,
                testId: el.getAttribute('data-testid')
            }))
        }));

        // Get full HTML (sanitized)
        const fullHTML = await page.content();

        const report = {
            timestamp: new Date().toISOString(),
            url: page.url(),
            title: await page.title(),
            authState: authState,
            testIds: testIds,
            structure: structure,
            viewport: await page.viewportSize()
        };

        console.log('✓ DOM data extracted');
        console.log('\n  Test IDs found:', testIds.length);
        console.log('  Has Sign Out button:', structure.hasSignOutButton);
        console.log('  Visible buttons:', structure.allButtons.filter(b => b.visible).length);

        console.log('\n[6/6] Saving reports...');

        // Ensure logs directory exists
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // Save JSON report
        const jsonPath = path.join(logsDir, 'dom-dump-report.json');
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
        console.log('✓ JSON report saved:', jsonPath);

        // Save full HTML
        const htmlPath = path.join(logsDir, 'dom-dump-full.html');
        fs.writeFileSync(htmlPath, fullHTML);
        console.log('✓ Full HTML saved:', htmlPath);

        // Take screenshot
        const screenshotPath = path.join(logsDir, 'dom-dump-screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('✓ Screenshot saved:', screenshotPath);

        console.log('\n=== SUCCESS ===');
        console.log('All diagnostic data captured successfully!');
        console.log('\nReview files:');
        console.log('  -', jsonPath);
        console.log('  -', htmlPath);
        console.log('  -', screenshotPath);

    } catch (error) {
        console.error('\n❌ FAILURE');
        console.error('Error:', error.message);
        console.error('\nFull error details:');
        console.error(error);

        // Check if this is the browser binary issue
        if (error.message.includes("Executable doesn't exist")) {
            console.error('\n⚠️  DIAGNOSIS: Playwright browser binaries not accessible');
            console.error('This confirms the environment is blocking browser access.');
            console.error('\nExpected browser location:', error.message.match(/\/home\/.*?(?=\s|$)/)?.[0]);

            // Try to check what browsers are installed
            try {
                const { execSync } = require('child_process');
                console.error('\nAttempting to list installed browsers:');
                const result = execSync('pnpm exec playwright list-browsers', { encoding: 'utf8' });
                console.error(result);
            } catch (listError) {
                console.error('Could not list browsers:', listError.message);
            }
        }

        process.exit(1);

    } finally {
        if (browser) {
            await browser.close();
            console.log('\nBrowser closed');
        }
    }
}

// Run the diagnostic
dumpDOM();