import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { isolateAuthStorageOncePerTab } from './helpers/authStorageIsolation';
import { TEST_IDS } from '../constants';

const MODEL_REQUEST = /(?:\/models\/|huggingface\.co|cdn-lfs\.huggingface)/i;
const CLOUD_PROVIDER_REQUEST = /(?:assemblyai|api\.openai|speech-to-text|transcribe-audio)/i;

test.describe('#1144 dependency-neutral responsive/accessibility foundation', () => {
  test('stale auth is cleared once while newly seeded auth survives same-tab hard navigation', async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Device qualification requires an explicit baseURL');
    const origin = new URL(baseURL).origin;
    const staleKey = 'sb-stale-auth-token';
    const seededKey = 'sb-seeded-auth-token';
    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{
          origin,
          localStorage: [{ name: staleKey, value: 'stale' }],
        }],
      },
    });

    try {
      await context.addInitScript(isolateAuthStorageOncePerTab);
      const isolatedPage = await context.newPage();
      await isolatedPage.goto(new URL('/private-dropin.html', baseURL).href);
      expect(await isolatedPage.evaluate(key => localStorage.getItem(key), staleKey)).toBeNull();

      await isolatedPage.evaluate(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: seededKey, value: 'seeded-after-isolation' },
      );
      await isolatedPage.goto(new URL('/private-dropin.html?hard-navigation=1', baseURL).href);
      expect(await isolatedPage.evaluate(key => localStorage.getItem(key), seededKey)).toBe('seeded-after-isolation');
    } finally {
      await context.close();
    }
  });

  test('session is idle, named, keyboard reachable, and makes no automatic provider request', async ({ page }, testInfo) => {
    const cloudProviderRequests: string[] = [];
    const cloudProviderSockets: string[] = [];
    page.on('request', request => {
      const url = request.url();
      if (CLOUD_PROVIDER_REQUEST.test(url)) cloudProviderRequests.push(url);
    });
    page.on('websocket', socket => {
      const url = socket.url();
      if (CLOUD_PROVIDER_REQUEST.test(url)) cloudProviderSockets.push(url);
    });

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await page.waitForURL(url => url.pathname === '/practice');
    const authKeysBeforeHardNavigation = await page.evaluate(() =>
      Object.keys(localStorage).filter(key => key.startsWith('sb-')).sort(),
    );
    expect(authKeysBeforeHardNavigation.length).toBeGreaterThan(0);
    await navigateToRoute(page, '/session');
    expect(await page.evaluate(() =>
      Object.keys(localStorage).filter(key => key.startsWith('sb-')).sort(),
    )).toEqual(authKeysBeforeHardNavigation);
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'READY');

    const visibleRecordControl = page.locator(
      `button[data-testid="${TEST_IDS.SESSION_START_STOP_BUTTON}"]:visible, `
      + `button[data-testid="${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile"]:visible`,
    ).first();
    await expect(visibleRecordControl).toBeVisible();
    await expect(visibleRecordControl).toHaveAccessibleName(/start|record|practice/i);
    await expect(visibleRecordControl).not.toHaveAttribute('data-recording', 'true');

    const modeControl = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
    await expect(modeControl).toBeVisible();
    await expect(modeControl).toHaveAccessibleName(/transcription|speech|mode|private|browser|cloud/i);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${testInfo.project.name} must not horizontally overflow`).toBeLessThanOrEqual(1);

    const liveRegions = page.locator('[aria-live], [role="status"], [role="alert"]');
    expect(await liveRegions.count(), 'the session must expose an announcement surface').toBeGreaterThan(0);

    // macOS WebKit follows Safari's keyboard convention: Option+Tab reaches
    // interactive controls when plain Tab is reserved for text inputs. This
    // keeps the assertion keyboard-driven without programmatically focusing the
    // target and weakening the focus-order proof.
    const focusAdvanceKey = testInfo.project.name.startsWith('webkit-') ? 'Alt+Tab' : 'Tab';
    let reachedRecordControl = false;
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press(focusAdvanceKey);
      reachedRecordControl = await visibleRecordControl
        .evaluate(element => element === document.activeElement)
        .catch(() => false);
      if (reachedRecordControl) break;
    }
    expect(reachedRecordControl, 'record control must be reachable by keyboard').toBe(true);

    expect(cloudProviderRequests, 'idle qualification must incur zero provider cost').toEqual([]);
    expect(cloudProviderSockets, 'idle qualification must open no provider WebSocket').toEqual([]);
  });

  test('the real Private engine boundary does not download model bytes before explicit init', async ({ page, baseURL }) => {
    const modelRequests: string[] = [];
    page.on('request', request => {
      if (MODEL_REQUEST.test(request.url())) modelRequests.push(request.url());
    });

    if (!baseURL) throw new Error('Device qualification requires an explicit baseURL');
    const privateBoundaryUrl = new URL('/private-dropin.html', baseURL).href;
    await page.setContent('<a data-testid="open-real-private-boundary">Open real Private boundary</a>');
    await page.getByTestId('open-real-private-boundary').evaluate((link, href) => {
      link.setAttribute('href', href);
    }, privateBoundaryUrl);
    await page.getByTestId('open-real-private-boundary').click();
    await page.waitForURL('**/private-dropin.html');
    await expect(page.getByTestId('dropin-status')).toHaveText('idle');
    await expect(page.locator('#init')).toBeEnabled();
    const state = await page.evaluate(() => {
      const dropin = (window as Window & {
        __PRIVATE_DROPIN__?: { modelReady: boolean; recording: boolean; initModel?: unknown };
      }).__PRIVATE_DROPIN__;
      return {
        installed: !!dropin,
        modelReady: dropin?.modelReady,
        recording: dropin?.recording,
        hasRealInitBoundary: typeof dropin?.initModel === 'function',
      };
    });
    expect(state).toEqual({ installed: true, modelReady: false, recording: false, hasRealInitBoundary: true });
    expect(modelRequests, 'real Private model download requires explicit user intent').toEqual([]);
  });

  test('layout reflows without horizontal overflow, including a CSS 200% zoom simulation', async ({ page }, testInfo) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    const viewport = testInfo.project.use.viewport;
    if (viewport?.width === 1280) {
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('2');
    }

    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyRight: document.body.getBoundingClientRect().right,
    }));
    expect(geometry.scrollWidth - geometry.clientWidth).toBeLessThanOrEqual(1);
    expect(geometry.bodyRight).toBeLessThanOrEqual(geometry.clientWidth + 1);
  });
});
