// @vitest-environment node
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { analyticsThroughActions, backFromProgressRestoresSession } from '../live/helpers/rwtJourney';

/** Execute the production waitForURL arguments, with no browser, wall-clock wait or network. */
function fakePage(destinations: string[]) {
    const seen: (string | RegExp | ((url: URL) => boolean))[] = [];
    const locator = {
        first: () => locator, or: () => locator,
        waitFor: async () => undefined, click: async () => undefined,
        innerText: async () => 'saved transcript', count: async () => 0,
        getAttribute: async () => 'different-session',
    };
    const page = {
        getByTestId: () => locator,
        waitForURL: async (matcher: string | RegExp | ((url: URL) => boolean)) => {
            seen.push(matcher);
            const url = new URL(destinations.shift() ?? 'https://app.example/unexpected');
            const matches = typeof matcher === 'function' ? matcher(url)
                : matcher instanceof RegExp ? matcher.test(url.href) : matcher === url.href;
            if (!matches) throw new Error('destination did not match');
        },
        reload: async () => undefined, waitForTimeout: async () => undefined,
        goBack: async () => undefined, evaluate: async () => 0,
    };
    return { page: page as unknown as Page, seen };
}

const digest = createHash('sha256').update('saved transcript').digest('hex');
describe.each(['/progress', '/analytics'])('actual journey URL callbacks: %s', (route) => {
    it.each(['', '/'])('accepts exact index/detail, suffix %j, with query and fragment', async (suffix) => {
        const { page, seen } = fakePage([
            `https://app.example${route}${suffix}?filter=recent#top`,
            `https://app.example${route}/s-1${suffix}?view=detail#quote`,
        ]);
        const result = await analyticsThroughActions(page, 's-1', digest);
        expect(result).toMatchObject({ actionClicked: true, listed: true, detailOpened: true, detailMatches: true, reloadMatches: true });
        expect(seen).toHaveLength(2);
    });

    it.each(['s-1-extra', 's-1/extra', 's-10'])('rejects a different detail ID/path %s', async (wrongId) => {
        const { page } = fakePage([`https://app.example${route}`, `https://app.example${route}/${wrongId}`]);
        expect((await analyticsThroughActions(page, 's-1', digest)).detailOpened).toBe(false);
    });

    it('treats metacharacters in the expected session ID literally', async () => {
        const exact = fakePage([`https://app.example${route}`, `https://app.example${route}/s.1`]);
        expect((await analyticsThroughActions(exact.page, 's.1', digest)).detailOpened).toBe(true);
        const wrong = fakePage([`https://app.example${route}`, `https://app.example${route}/sx1`]);
        expect((await analyticsThroughActions(wrong.page, 's.1', digest)).detailOpened).toBe(false);
    });

    it.each([`/session?next=${route}`, `${route}ive`, `${route}/s-1`, `${route}/extra/path`])('rejects non-index %s in both real index waits', async (pathname) => {
        const destination = `https://app.example${pathname}`;
        const analytics = fakePage([destination, `https://app.example${route}/s-1`]);
        expect((await analyticsThroughActions(analytics.page, 's-1', digest)).actionClicked).toBe(false);
        const back = fakePage([destination]);
        expect((await backFromProgressRestoresSession(back.page, 's-1')).left).toBe(false);
    });

    it('accepts the Back journey’s index without falsely claiming the saved session restored', async () => {
        const { page, seen } = fakePage([`https://app.example${route}/?view=recent#top`]);
        const result = await backFromProgressRestoresSession(page, 's-1');
        expect(result.left).toBe(true);
        expect(result.restored).toBe(false);
        expect(seen).toHaveLength(1);
    });
});
