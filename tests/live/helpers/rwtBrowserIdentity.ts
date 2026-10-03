import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * RWT browser identity (#1258 PM 5932744381, Option A): the RWT Production browser is the real Chromium build on the real
 * platform, minus the three HEADLESS/AUTOMATION signals that make posthog-js's bot filter silently discard every event a
 * run sends. posthog-js 1.298.1 treats a browser as a bot if ANY of these is true:
 *   1. `navigator.userAgent` carries a blocked token (`HeadlessChrome`);
 *   2. `navigator.userAgentData.brands` carries one (the `HeadlessChrome` brand);
 *   3. `navigator.webdriver` is true.
 * So the RWT journeys' telemetry rows could never pass: nothing they sent was ever received.
 *
 * Scope: the RWT Playwright fixture only. Product code, PostHog configuration (the bot filter stays ON for real traffic),
 * traffic classification and the canary claim are untouched. Everything else about the browser — version, platform,
 * architecture, the other brands — is read from the browser itself and passed through unchanged.
 */

/** Turns `navigator.webdriver` off. Chromium reads it at launch only, so it is a launch argument (signal 3). */
export const RWT_BROWSER_IDENTITY_ARGS = ['--disable-blink-features=AutomationControlled'] as const;

/** Signal 1: only the headless product token changes; every other byte of the UA is the browser's own. */
export function withoutHeadlessUa(userAgent: string): string {
    return userAgent.replace(/HeadlessChrome\//g, 'Chrome/');
}

type Brand = { brand: string; version: string };
export type UaMetadata = {
    brands: Brand[];
    fullVersionList: Brand[];
    fullVersion: string;
    platform: string;
    platformVersion: string;
    architecture: string;
    model: string;
    mobile: boolean;
    bitness: string;
    wow64: boolean;
};

/** Signal 2: drops only the headless brand; the GREASE brand, Chromium and every metadata field pass through. */
export function withoutHeadlessBrands(meta: UaMetadata): UaMetadata {
    const keep = (list: Brand[]) => list.filter((b) => !/headless/i.test(b.brand));
    return { ...meta, brands: keep(meta.brands), fullVersionList: keep(meta.fullVersionList) };
}

export type RwtIdentity = { userAgent: string; userAgentMetadata: UaMetadata };

/** The page a probe context serves to read client hints (a secure origin is required; nothing leaves the process). */
const PROBE_ORIGIN = 'https://rwt-identity.probe';
const identities = new WeakMap<Browser, Promise<RwtIdentity>>();

/**
 * Reads the browser's OWN user agent and client-hint metadata once per browser, from a throwaway context on a locally
 * fulfilled origin, and returns it with only the headless signals removed.
 */
export function rwtIdentityFor(browser: Browser): Promise<RwtIdentity> {
    let identity = identities.get(browser);
    if (!identity) {
        identity = (async () => {
            const probe = await browser.newContext();
            try {
                await probe.route(`${PROBE_ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
                const page = await probe.newPage();
                await page.goto(`${PROBE_ORIGIN}/`);
                const real = await page.evaluate(async () => {
                    const data = (navigator as Navigator & { userAgentData?: {
                        getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
                    } }).userAgentData;
                    if (!data) throw new Error('client hints unavailable in the RWT browser');
                    const hi = await data.getHighEntropyValues(['architecture', 'bitness', 'brands', 'fullVersionList', 'mobile', 'model', 'platform', 'platformVersion', 'wow64']);
                    return { userAgent: navigator.userAgent, hi };
                });
                const hi = real.hi as Partial<UaMetadata> & { fullVersionList?: Brand[] };
                const chromium = (hi.fullVersionList ?? []).find((b) => b.brand === 'Chromium');
                return {
                    userAgent: withoutHeadlessUa(real.userAgent),
                    userAgentMetadata: withoutHeadlessBrands({
                        brands: hi.brands ?? [],
                        fullVersionList: hi.fullVersionList ?? [],
                        fullVersion: chromium?.version ?? '',
                        platform: hi.platform ?? '',
                        platformVersion: hi.platformVersion ?? '',
                        architecture: hi.architecture ?? '',
                        model: hi.model ?? '',
                        mobile: hi.mobile ?? false,
                        bitness: hi.bitness ?? '',
                        wow64: hi.wow64 ?? false,
                    }),
                };
            } finally {
                await probe.close();
            }
        })();
        identities.set(browser, identity);
    }
    return identity;
}

/**
 * Applies the identity to one page before it navigates. The CDP session stays attached for the page's life: the override
 * persists across navigations and reaches the page's dedicated workers.
 */
export async function applyRwtIdentity(context: BrowserContext, page: Page, identity: RwtIdentity): Promise<void> {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', identity);
}

/** The three signals as the page reports them (for the receipt and the regressions). */
export async function botSignals(page: Page): Promise<{ userAgent: string; brands: string[]; webdriver: boolean }> {
    return page.evaluate(() => ({
        userAgent: navigator.userAgent,
        brands: ((navigator as Navigator & { userAgentData?: { brands?: Brand[] } }).userAgentData?.brands ?? []).map((b) => b.brand),
        webdriver: navigator.webdriver === true,
    }));
}
