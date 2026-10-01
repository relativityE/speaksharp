// @vitest-environment node
/**
 * #1258 PM 5932744381 (Option A): the RWT-only browser identity correction is complete, confined to the RWT fixture, and
 * leaves the product's PostHog bot filter and the canary attribution exactly as they were.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RWT_BROWSER_IDENTITY_ARGS, withoutHeadlessBrands, withoutHeadlessUa, type UaMetadata } from '../live/helpers/rwtBrowserIdentity';
import { rwtLaunchArgs } from '../live/helpers/rwtJourney';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const RWT_SPECS = readdirSync(path.join(ROOT, 'tests/live')).filter((f) => /^rwt-.*\.live\.spec\.ts$/.test(f));

/** Product source only: no tests, mocks or type declarations. */
const productSources = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = path.join(dir, e.name);
  if (e.isDirectory()) return /(__tests__|__mocks__|mocks|test)$/.test(e.name) ? [] : productSources(rel);
  return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(e.name) ? [rel] : [];
});

describe('#1258 RWT identity: only the headless signals change', () => {
  it('signal 1: only the HeadlessChrome token changes in the UA', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36';
    expect(withoutHeadlessUa(ua)).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36');
    const real = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    expect(withoutHeadlessUa(real)).toBe(real);
  });

  it('signal 2: only the headless brand is dropped; Chromium, the GREASE brand and every metadata field pass through', () => {
    const meta: UaMetadata = {
      brands: [{ brand: 'HeadlessChrome', version: '143' }, { brand: 'Chromium', version: '143' }, { brand: 'Not A(Brand', version: '24' }],
      fullVersionList: [{ brand: 'HeadlessChrome', version: '143.0.7499.4' }, { brand: 'Chromium', version: '143.0.7499.4' }, { brand: 'Not A(Brand', version: '24.0.0.0' }],
      fullVersion: '143.0.7499.4', platform: 'Linux', platformVersion: '6.8.0', architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false,
    };
    expect(withoutHeadlessBrands(meta)).toEqual({
      ...meta,
      brands: [{ brand: 'Chromium', version: '143' }, { brand: 'Not A(Brand', version: '24' }],
      fullVersionList: [{ brand: 'Chromium', version: '143.0.7499.4' }, { brand: 'Not A(Brand', version: '24.0.0.0' }],
    });
  });

  it('signal 3: the launch argument is exactly the automation-control switch, nothing broader', () => {
    expect([...RWT_BROWSER_IDENTITY_ARGS]).toEqual(['--disable-blink-features=AutomationControlled']);
  });
});

describe('#1258 RWT identity: applied to every RWT journey, and only there', () => {
  it('every RWT spec runs on the RWT fixture and launches with the identity argument', () => {
    expect(RWT_SPECS.length).toBeGreaterThanOrEqual(4);
    for (const spec of RWT_SPECS) {
      const src = read(`tests/live/${spec}`);
      expect({ spec, rwtFixture: /from '\.\/helpers\/rwtProductionTest'/.test(src), identityArgs: src.includes('rwtLaunchArgs(') || src.includes('RWT_BROWSER_IDENTITY_ARGS') })
        .toEqual({ spec, rwtFixture: true, identityArgs: true });
    }
    expect(rwtLaunchArgs({ path: '/fixtures/take.wav' } as never, { webgpu: false })).toEqual(expect.arrayContaining([...RWT_BROWSER_IDENTITY_ARGS]));
  });

  it('the RWT fixture applies the identity to its page and to every page its context opens', () => {
    const fixture = read('tests/live/helpers/rwtProductionTest.ts');
    expect(fixture).toMatch(/context\.on\('page', \(page\) => \{ void applyRwtIdentity\(context, page, identity\)/);
    expect(fixture).toMatch(/page: async \(\{ context, browser, page \}, use\) => \{\s*\/\/[^\n]*\n\s*await applyRwtIdentity\(context, page, await rwtIdentityFor\(browser\)\);/);
    // The non-RWT deployed fixture is untouched.
    expect(read('tests/live/helpers/deployedLiveTest.ts')).not.toMatch(/rwtBrowserIdentity|applyRwtIdentity/);
  });
});

describe('#1258 RWT identity: the product is unchanged', () => {
  const sources = productSources('frontend/src');

  it('the product never opts out of PostHog bot filtering', () => {
    expect(sources.length).toBeGreaterThan(100);
    for (const file of sources) {
      const src = read(file);
      expect({ file, optsOut: /opt_out_useragent_filter|__preview_capture_bot_pageviews|custom_blocked_useragents/.test(src) }).toEqual({ file, optsOut: false });
    }
    expect(read('frontend/src/services/productionRum.ts')).not.toMatch(/useragent/i);
  });

  it('no product code depends on navigator.webdriver', () => {
    for (const file of sources) expect({ file, webdriver: /\bwebdriver\b/.test(read(file)) }).toEqual({ file, webdriver: false });
  });

  it('canary attribution is still required by the recording journeys', () => {
    for (const spec of ['rwt-open-mic-first-session.live.spec.ts', 'rwt-focus-points-session.live.spec.ts']) {
      const src = read(`tests/live/${spec}`) + read('tests/live/helpers/rwtFocusPointsJourney.ts');
      expect({ spec, canaryClaim: /markRunOwnedAccountCanary\(/.test(src), telemetryClass: /telemetryClassRows\(/.test(src) })
        .toEqual({ spec, canaryClaim: true, telemetryClass: true });
    }
  });
});
