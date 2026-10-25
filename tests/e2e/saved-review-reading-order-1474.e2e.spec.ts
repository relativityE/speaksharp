/**
 * #1474 A2.3 — the saved review's reading order, keyboard path and narrow reflow (Sam 1792885019, proposal 1792880017 with
 * the scrolling correction 1792880124).
 *
 * Three separate contracts, kept separate on purpose:
 *   A. STATIC READING ORDER — DOM/semantic order only. Static content is never given a tabindex to satisfy this.
 *   B. SEQUENTIAL KEYBOARD — real Tab presses over the controls that are focusable anyway (programmatic .focus() is not
 *      sequential-Tab evidence).
 *   C. NARROW REFLOW + REDUCED MOTION — at 320 CSS px with prefers-reduced-motion: reduce, no horizontal scroll, and the
 *      prescription and Practice again are fully on screen and uncovered once scrolled to (ordinary scrolling of long coaching
 *      is fine; nothing has to fit the first viewport).
 *
 * Limits, stated so nothing here is over-read: 320 CSS px is narrow-reflow evidence, NOT an executed 400% browser zoom; C shows
 * the content stays visible under reduce, NOT that motion is suppressed; there is no real screen reader and no physical-phone
 * Tab; this does not close #1474/G10.
 *
 * The saved take is recorded through the e2e double with a localhost-only scripted review (no provider, persistence or
 * production call) and the longest pair the server serves (both fields at the 240-character ceiling).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';

const SPEECH = ['So um I think we should start with the main point.', 'Uh and then we close on the next step, um, today.'];
/** Pace is stated only from 15 s of speech, so the take runs past it. */
const TAKE_MS = 16_500;
const MAX_PAIR = {
    version: 'gemini_coaching_v1',
    what_worked: 'You opened with the point and kept it clear. '.repeat(6).slice(0, 240),
    what_to_try_next: 'Pause before the takeaway so it lands with weight. '.repeat(6).slice(0, 240),
};

const isLocal = (url: string): boolean => {
    try {
        const u = new URL(url);
        return u.protocol === 'data:' || u.protocol === 'blob:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    } catch { return false; }
};
const originOf = (url: string): string => { try { return new URL(url).origin; } catch { return 'unparseable'; } };

/**
 * Strict localhost isolation, the same mechanism as saved-review-rendered-acceptance-1474 (copied, not imported, so that
 * spec stays untouched). The shared mocks end in a catch-all that lets non-Supabase requests through, and Playwright checks
 * the LAST-registered route first, so a guard registered before login would sit behind it and never run. The blocking guard
 * is therefore armed inside the first `page.goto` (after the login helper's routes, before any request). Requests are
 * OBSERVED independently of the guard (`page.on('request'/'response')`), so an empty record is evidence, not an artifact of
 * a handler that never ran:
 *   ATTEMPTED: every non-local request the page issued; REJECTED: what the guard blocked; REACHED: a non-local response with a
 *   server address (a mock fulfilment has none). `armedBeforeAnyRequest` proves no request preceded the guard.
 */
type Isolation = { attempted: () => string[]; rejected: () => string[]; reached: () => string[]; armedBeforeAnyRequest: () => boolean };
function isolateFromExternalNetwork(page: Page): Isolation {
    const attempted: string[] = [];
    const rejected: string[] = [];
    const reached: string[] = [];
    let armed = false;
    let requestBeforeArm = false;
    page.on('request', (request) => {
        if (!armed) requestBeforeArm = true;
        if (!isLocal(request.url())) attempted.push(originOf(request.url()));
    });
    page.on('response', (response) => {
        if (isLocal(response.url())) return;
        void response.serverAddr().then((addr) => { if (addr) reached.push(originOf(response.url())); }, () => {});
    });
    const navigate = page.goto.bind(page);
    page.goto = (async (...args: Parameters<Page['goto']>) => {
        if (!armed) {
            await page.route('**/*', async (route) => {
                const url = route.request().url();
                if (isLocal(url)) { await route.fallback(); return; }
                rejected.push(originOf(url));
                await route.abort('blockedbyclient');
            });
            armed = true;
        }
        return navigate(...args);
    }) as Page['goto'];
    return {
        attempted: () => [...attempted],
        rejected: () => [...rejected],
        reached: () => [...reached],
        armedBeforeAnyRequest: () => armed && !requestBeforeArm,
    };
}

function expectIsolated(isolation: Isolation) {
    expect(isolation.armedBeforeAnyRequest(), 'the egress guard was armed before the first request').toBe(true);
    expect(isolation.attempted(), 'the page never issued a request off localhost').toEqual([]);
    expect(isolation.rejected(), 'nothing off localhost had to be blocked').toEqual([]);
    expect(isolation.reached(), 'no response came from a server off localhost').toEqual([]);
}

/** A saved Open Mic take whose review is answered once, on localhost, with the longest pair. */
async function recordSavedTake(page: Page): Promise<void> {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForFunction(() => Boolean((window as unknown as { supabase?: unknown }).supabase));
    await page.evaluate((pair) => {
        type Invoke = (name: string, options?: unknown) => Promise<unknown>;
        const w = window as unknown as { supabase: { functions: { invoke: Invoke } } };
        const original: Invoke = w.supabase.functions.invoke.bind(w.supabase.functions);
        w.supabase.functions.invoke = (name, options) => (name === 'get-ai-suggestions'
            ? Promise.resolve({ data: { suggestions: pair }, error: null })
            : original(name, options));
    }, MAX_PAIR);
    await startRecording(page);
    await mockLiveTranscript(page, SPEECH);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(TAKE_MS);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('ai-suggestions-card')).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
    await expect(page.getByTestId('review-try-next')).toBeVisible();
}

/** True when `a` comes before `b` in document order. */
async function precedes(a: Locator, b: Locator): Promise<boolean> {
    const first = await a.elementHandle();
    const second = await b.elementHandle();
    if (!first || !second) throw new Error('precedes: both elements must exist');
    return first.evaluate((x, y) => Boolean(x.compareDocumentPosition(y as Node) & Node.DOCUMENT_POSITION_FOLLOWING), second);
}

/** Whether the element is fully inside the viewport and is the topmost element at its own centre (nothing covers it). */
async function unobscured(locator: Locator): Promise<{ inViewport: boolean; topmost: boolean }> {
    return locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const inViewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { inViewport, topmost: !!hit && (hit === el || el.contains(hit)) };
    });
}

const SLOT_ORDER = ['Recorder', 'Coaching', 'Transcript', 'This run'];

for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    test.describe(`#1474 A2.3 saved review at ${viewport.width}×${viewport.height}`, () => {
        test.use({ viewport });

        test('A: static reading order — coaching before the transcript and THIS RUN (DOM/semantics only)', async ({ page }) => {
            test.setTimeout(120_000);
            const isolation = isolateFromExternalNetwork(page);
            await recordSavedTake(page);
            const main = page.getByRole('main');

            // A1. The four SHELL slots (scoped to SessionShell's `section[data-slot]`, so ThisRunCard's own nested "This run"
            // section is not double-counted), in DOM order, each exposed as a named region landmark.
            const slots = main.locator('section[data-slot]');
            await expect(slots).toHaveCount(4);
            expect(await slots.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '')), 'shell slots in reading order').toEqual(SLOT_ORDER);
            for (const name of SLOT_ORDER) {
                await expect(main.locator(`section[data-slot][aria-label="${name}"]`), `${name} slot is a region landmark`).toHaveRole('region');
            }

            // A2. The prescription precedes the transcript slot and the THIS RUN card.
            const prescription = page.getByTestId('review-try-next');
            expect(await precedes(prescription, page.getByTestId('session-slot-c')), 'prescription before the transcript').toBe(true);
            expect(await precedes(prescription, page.getByTestId('this-run-card')), 'prescription before THIS RUN').toBe(true);

            // A3. The coaching slot's first heading precedes what titles the later sections. ThisRunCard's visible title "This
            // run" is a PARAGRAPH, not a heading (production semantics unchanged here), so its DOM order is asserted as a title
            // paragraph; this is not a heading-order claim for THIS RUN.
            const coachingHeading = page.getByTestId('session-slot-b').getByRole('heading').first();
            await expect(coachingHeading).toHaveCount(1);
            const thisRunTitle = page.getByTestId('this-run-card').locator('p').filter({ hasText: /^This run$/ }).first();
            await expect(thisRunTitle).toHaveCount(1);
            expect(await precedes(coachingHeading, thisRunTitle), 'coaching heading before the THIS RUN title paragraph').toBe(true);
            // The saved (ended) TranscriptCard renders an h2 "Transcript": exactly one, visible, and after the coaching heading.
            // Unconditional, so removing or reordering that heading fails here.
            const transcriptHeading = page.getByTestId('session-slot-c').getByRole('heading', { level: 2, name: 'Transcript', exact: true });
            await expect(transcriptHeading).toHaveCount(1);
            await expect(transcriptHeading).toBeVisible();
            expect(await precedes(coachingHeading, transcriptHeading), 'coaching heading before the Transcript heading').toBe(true);
            expectIsolated(isolation);
        });

        test('B: sequential Tab reaches Practice again before any transcript / THIS RUN control; no static content was made focusable', async ({ page }) => {
            test.setTimeout(120_000);
            const isolation = isolateFromExternalNetwork(page);
            await recordSavedTake(page);

            // B3 first: inside the review, transcript and THIS RUN slots no non-interactive element is in the tab order.
            const staticTabStops = await page.evaluate(() => {
                const interactive = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="menuitem"]';
                return ['session-slot-b', 'session-slot-c', 'session-slot-d'].flatMap((id) =>
                    [...(document.querySelector(`[data-testid="${id}"]`)?.querySelectorAll('[tabindex]') ?? [])]
                        .filter((el) => Number(el.getAttribute('tabindex')) >= 0 && !el.matches(interactive))
                        .map((el) => `${id}:${el.tagName.toLowerCase()}`));
            });
            expect(staticTabStops, 'no tabindex on static content').toEqual([]);

            // B1/B2: real Tab presses from the top of the document.
            await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
            const stops: Array<{ testid: string | null; slot: string | null }> = [];
            for (let i = 0; i < 60; i += 1) {
                await page.keyboard.press('Tab');
                stops.push(await page.evaluate(() => {
                    const el = document.activeElement as HTMLElement | null;
                    return { testid: el?.getAttribute('data-testid') ?? null, slot: el?.closest('[data-slot]')?.getAttribute('data-slot') ?? null };
                }));
                if (stops[stops.length - 1].testid === 'verdict-practice-again') break;
            }
            const practiceAt = stops.findIndex((s) => s.testid === 'verdict-practice-again');
            expect(practiceAt, 'Practice again is reachable by sequential Tab').toBeGreaterThanOrEqual(0);
            const laterSlotStop = stops.slice(0, practiceAt).find((s) => s.slot === 'C' || s.slot === 'D');
            expect(laterSlotStop ?? null, 'no transcript / THIS RUN control is reached before Practice again').toBeNull();
            expectIsolated(isolation);
        });
    });
}

test.describe('#1474 A2.3 saved review at 320×800, prefers-reduced-motion: reduce', () => {
    test.use({ viewport: { width: 320, height: 800 } });

    test('C: no horizontal scroll; the prescription and Practice again are fully on screen and uncovered once reached', async ({ page }) => {
        test.setTimeout(120_000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const isolation = isolateFromExternalNetwork(page);
        await recordSavedTake(page);

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, 'no horizontal scroll at 320 CSS px (narrow reflow, not 400% zoom)').toBeLessThanOrEqual(320);

        for (const testid of ['review-try-next', 'verdict-practice-again']) {
            const target = page.getByTestId(testid);
            await target.scrollIntoViewIfNeeded();
            await expect(target).toBeVisible();
            expect(await unobscured(target), `${testid}: fully on screen and not covered (e.g. by the fixed bar)`).toEqual({ inViewport: true, topmost: true });
        }
        expectIsolated(isolation);
    });
});
