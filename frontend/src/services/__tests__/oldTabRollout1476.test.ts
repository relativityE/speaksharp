// @vitest-environment jsdom
/**
 * #1476 PM disposition on 039043877 — AN ALREADY-OPEN PRE-UPGRADE TAB AND NEW-TAB PROGRESS DEBT.
 *
 * A tab still running the bundle from before #1525 reads only the v1 Progress queue, so it cannot see an obligation a new
 * tab recorded in v2 — and the server's `get_progress_obligations` is consulted only by the new bundle. The protection
 * for that old tab is the stale-client guard it ALREADY carries: `staleClientGuard.ts` is unchanged by #1525 (identical
 * to main), and main's Start path runs `checkClientFreshness()` before any recording work. A new-bundle tab can exist only
 * once the origin serves the new release, so whenever a new tab can hold Progress debt, the old tab's Start compares its
 * running release against a newer deployed one and is refused — and if it cannot verify, it is refused too.
 * This pins that rollout contract with the old tab's exact inputs: its own release id and the origin's current HTML.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canRecord, blockedMessage, checkClientFreshness, STALE_CLIENT_MESSAGE, UNVERIFIED_CLIENT_MESSAGE } from '../staleClientGuard';

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const PRE_UPGRADE = 'rel-1319e8b5-pre-1525';
const POST_UPGRADE = 'rel-with-1525';
const html = (id: string) => `<head><script>window.__APP_RELEASE__="${id}";</script></head>`;

beforeEach(() => { (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ = PRE_UPGRADE; });
afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__; });

describe('#1476 rollout — a pre-upgrade tab cannot Start once a new tab can hold v2-only Progress debt', () => {
    it('CASUALTY: the origin serves the new release → the old tab is STALE and its Start is refused with the reload copy', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(html(POST_UPGRADE), { status: 200 })));
        const r = await checkClientFreshness();
        expect(r).toMatchObject({ status: 'stale', running: PRE_UPGRADE, deployed: POST_UPGRADE });
        expect(canRecord(r.status)).toBe(false);
        expect(blockedMessage(r.status)).toBe(STALE_CLIENT_MESSAGE);
    });

    it('CASUALTY: the old tab cannot reach the origin → UNVERIFIED, and a production tab that cannot verify is refused too', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
        let t = 0;
        const r = await checkClientFreshness(() => (t += 1000));
        expect(r.status).toBe('unverified');
        expect(canRecord(r.status)).toBe(false);
        expect(blockedMessage(r.status)).toBe(UNVERIFIED_CLIENT_MESSAGE);
    });

    it('CONTROL: before the new release is served (no new tab can exist yet), the old tab still records normally', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(html(PRE_UPGRADE), { status: 200 })));
        const r = await checkClientFreshness();
        expect(r.status).toBe('fresh');
        expect(canRecord(r.status)).toBe(true);
    });
});
