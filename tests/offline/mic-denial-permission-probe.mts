/**
 * Isolated case-12a harness probe. Localhost is a secure context for getUserMedia;
 * no SpeakSharp page, Production origin, account, key, or RWT dispatch is used.
 * Run: node scripts/host-interlock.mjs hold local -- pnpm exec tsx tests/offline/mic-denial-permission-probe.mts
 */
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { loadRwtFixture, rwtLaunchArgs } from '../live/helpers/rwtJourney';

type Setting = 'denied' | 'granted';
type Scenario = { name: string; fakeUi: boolean; contextGrant: boolean; cdpSetting: Setting | null; captureFile: boolean; keepCdpSession?: boolean; fakeUiDeny?: boolean };
const scenarios: Scenario[] = [
  { name: 'pinned_grant_no_cdp', fakeUi: true, contextGrant: true, cdpSetting: null, captureFile: true },
  { name: 'pinned_grant_cdp_deny', fakeUi: true, contextGrant: true, cdpSetting: 'denied', captureFile: true },
  { name: 'pinned_grant_cdp_deny_keep_session', fakeUi: true, contextGrant: true, cdpSetting: 'denied', captureFile: true, keepCdpSession: true },
  { name: 'pinned_grant_cdp_grant', fakeUi: true, contextGrant: true, cdpSetting: 'granted', captureFile: true },
  { name: 'pinned_no_grant_cdp_deny', fakeUi: true, contextGrant: false, cdpSetting: 'denied', captureFile: true },
  { name: 'pinned_no_grant_cdp_deny_keep_session', fakeUi: true, contextGrant: false, cdpSetting: 'denied', captureFile: true, keepCdpSession: true },
  { name: 'fake_ui_deny_cdp_deny_keep_session', fakeUi: true, fakeUiDeny: true, contextGrant: true, cdpSetting: 'denied', captureFile: true, keepCdpSession: true },
  { name: 'fake_ui_deny_cdp_grant_keep_session', fakeUi: true, fakeUiDeny: true, contextGrant: true, cdpSetting: 'granted', captureFile: true, keepCdpSession: true },
  { name: 'fake_ui_deny_no_cdp', fakeUi: true, fakeUiDeny: true, contextGrant: true, cdpSetting: null, captureFile: true },
  { name: 'no_fake_ui_grant_cdp_deny', fakeUi: false, contextGrant: true, cdpSetting: 'denied', captureFile: true },
  { name: 'no_fake_ui_grant_cdp_grant', fakeUi: false, contextGrant: true, cdpSetting: 'granted', captureFile: true },
  { name: 'dummy_device_grant_no_cdp', fakeUi: false, contextGrant: true, cdpSetting: null, captureFile: false },
  { name: 'dummy_device_grant_cdp_deny', fakeUi: false, contextGrant: true, cdpSetting: 'denied', captureFile: false },
  { name: 'dummy_device_grant_cdp_deny_keep_session', fakeUi: false, contextGrant: true, cdpSetting: 'denied', captureFile: false, keepCdpSession: true },
  { name: 'dummy_device_grant_cdp_grant', fakeUi: false, contextGrant: true, cdpSetting: 'granted', captureFile: false },
];

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end('<!doctype html><html><head><title>Local microphone permission probe</title></head><body>Local fixture</body></html>');
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('local probe server has no TCP port');
const origin = `http://127.0.0.1:${address.port}`;
const pinnedArgs = rwtLaunchArgs(loadRwtFixture('open_mic_tts'), { webgpu: false });
const results: unknown[] = [];
let browserVersion = '';

try {
  for (const scenario of scenarios) {
    const args = pinnedArgs.filter((arg) =>
      (scenario.fakeUi || arg !== '--use-fake-ui-for-media-stream')
      && (scenario.captureFile || !arg.startsWith('--use-file-for-fake-audio-capture=')))
      .map((arg) => scenario.fakeUiDeny && arg === '--use-fake-ui-for-media-stream'
        ? '--use-fake-ui-for-media-stream=deny' : arg);
    const browser = await chromium.launch({ headless: true, args });
    try {
      if (!browserVersion) browserVersion = browser.version();
      const context = await browser.newContext({ permissions: scenario.contextGrant ? ['microphone'] : [] });
      const page = await context.newPage();
      await page.goto(origin);
      const queriedBefore = await page.evaluate(async () =>
        (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state);
      const pageSession = await context.newCDPSession(page);
      const { targetInfo } = await pageSession.send('Target.getTargetInfo');
      await pageSession.detach();
      const browserSession = scenario.cdpSetting ? await browser.newBrowserCDPSession() : null;
      try {
        if (scenario.cdpSetting) {
          await browserSession!.send('Browser.setPermission', {
            permission: { name: 'microphone' }, setting: scenario.cdpSetting, origin,
            browserContextId: targetInfo.browserContextId,
          });
        }
        if (browserSession && !scenario.keepCdpSession) await browserSession.detach();
        const observed = await page.evaluate(async () => {
          const queried = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const stream = await Promise.race([
              navigator.mediaDevices.getUserMedia({ audio: true }),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('acquisition_timeout')), 5_000); }),
            ]);
            const tracks = stream.getAudioTracks();
            const trackStates = tracks.map((track) => track.readyState);
            stream.getTracks().forEach((track) => track.stop());
            return { queried, acquisition: 'resolved', audioTracks: tracks.length, trackStates };
          } catch (error) {
            return { queried, acquisition: 'rejected', errorName: error instanceof Error ? error.name : 'unknown' };
          } finally {
            if (timer) clearTimeout(timer);
          }
        });
        results.push({
          scenario: scenario.name,
          requested: { contextGrant: scenario.contextGrant, cdpSetting: scenario.cdpSetting, fakeUi: scenario.fakeUi, fakeUiDeny: Boolean(scenario.fakeUiDeny), captureFile: scenario.captureFile },
          keptCdpSession: Boolean(scenario.keepCdpSession),
          queriedBefore,
          contextIdPresent: Boolean(targetInfo.browserContextId),
          effective: observed,
        });
      } finally {
        if (browserSession && scenario.keepCdpSession) await browserSession.detach();
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
process.stdout.write(`${JSON.stringify({ source: '7163f00d', originKind: 'localhost', platform: process.platform, browserVersion, nodeVersion: process.version, scenarios: results }, null, 2)}\n`);
