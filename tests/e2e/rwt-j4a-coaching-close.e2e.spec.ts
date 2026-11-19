/**
 * J4.a coaching block at the final boundary, in a real browser (Sam, Nov 19 on 2b57bd47).
 *
 * The J4.a journey (tests/live/rwt-save-retry-recovery.live.spec.ts) blocks every coaching request in the browser and writes
 * the required row `J4.a: no coaching request left the browser`. That row used to be read BEFORE the journey's pages closed,
 * so a coaching attempt made between that read and the close was blocked but escaped the verdict. The row is now written by
 * `j4aCoachingBlockedRow` only after `HarnessParityTap.ownedPagesClosedRow` proves every page closed, and HOLDs otherwise.
 *
 * This control drives the same guard, the same route pattern, the same parity tap and the same row writer the journey uses,
 * against a local server that stands in for the coaching endpoint and counts what actually reaches it. No production, no
 * account, no provider: everything is on 127.0.0.1.
 */
import { createServer, type Server } from 'node:http';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { HarnessParityTap } from '../live/helpers/rwtHarnessParity';
import {
    J4A_COACHING_BLOCKED_ROW, J4A_COACHING_ROUTE, j4aCoachingBlockedRow, j4aCoachingGuard, type J4aRowSink,
} from '../live/helpers/rwtJ4aEvidence';
import { goToApp } from './helpers';

const COACHING_PATH = '/functions/v1/get-ai-suggestions';
let server: Server;
let origin = '';
/** Requests that actually reached the stand-in coaching endpoint (upstream sends). */
let upstreamCoaching = 0;

const serve = async () => {
    server = createServer((req, reply) => {
        if ((req.url ?? '').startsWith(COACHING_PATH)) {
            upstreamCoaching += 1;
            reply.writeHead(200, { 'content-type': 'application/json' });
            reply.end('{"suggestions":[]}');
            return;
        }
        reply.writeHead(200, { 'content-type': 'text/html' });
        reply.end('<!doctype html><html data-app-ready="true" data-app-visible-ready="true"><title>SpeakSharp</title><main>x</main></html>');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
};
const stop = () => new Promise<void>((res) => server.close(() => res()));

/** The page asks for coaching itself, as the product would; resolves to 'sent' or 'blocked'. */
const pageAsksForCoaching = (page: Page) => page.evaluate(async (path) => {
    try {
        await fetch(`${path}?take=late`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        return 'sent';
    } catch {
        return 'blocked';
    }
}, COACHING_PATH);

function sink() {
    const rows: Array<{ step: string; verdict: string; evidence?: Record<string, string | number | boolean | null> }> = [];
    const receipt: J4aRowSink = { row: (step, verdict, _detail, evidence) => { rows.push({ step, verdict, evidence }); } };
    return { rows, receipt };
}

/** The journey's arming, in its order: parity tap first, then the context-wide coaching route, before the first page. */
async function armLikeTheJourney(context: BrowserContext) {
    const parity = new HarnessParityTap();
    await parity.attach(context);
    const guard = j4aCoachingGuard();
    await context.route(J4A_COACHING_ROUTE, (route) => guard.handler(route));
    guard.armed = true;
    return { parity, guard };
}

test.describe('J4.a: the coaching verdict is read only after every page is proven closed', () => {
    test.describe.configure({ mode: 'serial' });
    test.beforeAll(serve);
    test.afterAll(stop);
    test.beforeEach(() => { upstreamCoaching = 0; });

    test('instrument control: with no block, the page\'s coaching call does reach the stand-in endpoint', async ({ page }) => {
        await goToApp(page, `${origin}/`);
        expect(await pageAsksForCoaching(page)).toBe('sent');
        expect(upstreamCoaching).toBe(1);
    });

    test('an attempt between the old read point and the close: zero upstream sends and a FAIL row', async ({ context, page }) => {
        const { parity, guard } = await armLikeTheJourney(context);
        await goToApp(page, `${origin}/`);
        // The old read point (before the close): nothing counted yet, and the pages are not closed, so it HOLDs now.
        const early = sink();
        expect(guard.blocked).toBe(0);
        expect(j4aCoachingBlockedRow(early.receipt, J4A_COACHING_BLOCKED_ROW, guard, parity.ownedPagesClosedAt).reason).toBe('closure_unproved');
        // The interval the old order missed: the page asks for coaching after that read and before the close.
        expect(await pageAsksForCoaching(page)).toBe('blocked');
        // The journey's close step, then its required row.
        const final = sink();
        await parity.ownedPagesClosedRow(final.receipt);
        expect(final.rows[0]).toMatchObject({ step: 'owned pages closed', verdict: 'PASS' });
        expect(parity.ownedPagesClosedAt).not.toBeNull();
        const v = j4aCoachingBlockedRow(final.receipt, J4A_COACHING_BLOCKED_ROW, guard, parity.ownedPagesClosedAt);
        expect(v).toMatchObject({ status: 'FAIL', reason: 'coaching_requested' });
        expect(final.rows[1]).toMatchObject({ step: J4A_COACHING_BLOCKED_ROW, verdict: 'FAIL', evidence: { blocked: 1, pagesClosedProved: true } });
        expect(upstreamCoaching).toBe(0);
    });

    test('closure not proven: zero counted HOLDs, never PASS', async ({ context, page }) => {
        const { parity, guard } = await armLikeTheJourney(context);
        await goToApp(page, `${origin}/`);
        // Closed outside the journey's close step: no close proof is recorded.
        await page.close();
        const { rows, receipt } = sink();
        expect(j4aCoachingBlockedRow(receipt, J4A_COACHING_BLOCKED_ROW, guard, parity.ownedPagesClosedAt)).toMatchObject({ status: 'HOLD', reason: 'closure_unproved' });
        expect(rows[0]).toMatchObject({ verdict: 'HOLD', evidence: { pagesClosedProved: false } });
        expect(upstreamCoaching).toBe(0);
    });

    test('positive control: no coaching asked, every page proven closed, PASS', async ({ context, page }) => {
        const { parity, guard } = await armLikeTheJourney(context);
        await goToApp(page, `${origin}/`);
        const { rows, receipt } = sink();
        await parity.ownedPagesClosedRow(receipt);
        expect(j4aCoachingBlockedRow(receipt, J4A_COACHING_BLOCKED_ROW, guard, parity.ownedPagesClosedAt)).toMatchObject({ status: 'PASS', reason: 'none_requested' });
        expect(rows.map((r) => r.verdict)).toEqual(['PASS', 'PASS']);
        expect(upstreamCoaching).toBe(0);
    });
});
