/**
 * #1474 G10 — the saved-review page as a person meets it at 1280×800 (Sam disposition 2026-10-17 14:32 UTC).
 *
 * One Open Mic take, saved through the e2e double, then the review answered three ways by a scripted
 * `get-ai-suggestions` (localhost only; no provider, persistence or production call):
 *   SAVED REVIEW: the pair renders;
 *   TERMINAL FAILURE: 429 — the lifecycle has ended, so nothing may promise an incoming review and no futile Try again;
 *   SCHEDULED RETRY → TERMINAL: a lost request schedules the ONE automatic retry ("Trying again…", disabled), and a
 *   second loss ends the lifecycle with a real Try again.
 * Every state must keep: the review card's TOP EDGE above the fold (that narrow criterion only — not whole-card or CTA
 * containment), fillers/pace/words in THIS RUN only (PM 6045315752 removed counts from every review-band state),
 * Practice again enabled, the microphone, and no playback transport.
 *
 * SLOT STABILITY (spec "every slot's top is unchanged between `after` and `after · review failed`"; §5b "nothing below
 * it may move when the review arrives"): the review card reserves the tallest completed review's height at each desktop
 * range (`AISuggestions.tsx`, #1474 layout fix, Sam GO 6236271597). Proven three ways, all strict:
 *   - ALL FOUR slot tops identical across saved, terminal, scheduled-retry and terminal-after-retry at 1280×800, with a
 *     short pair AND a maximum-length (240 + 240 character, the server ceiling) pair;
 *   - pending → complete: the C/D row does not move when a held review arrives;
 *   - at the narrowest width of every desktop range, the tallest completed review fits inside the reservation — Open
 *     Mic's maximum as rendered; a REAL Focus Points completed review (seven-point brief, its saved evidence, its
 *     disclosure) as rendered; and, as an upper bound on that real card, `focusPointsEvidence`'s longest output written
 *     into its evidence lines. Practice again stays enabled, keyboard-focusable and unclipped at every width; the
 *     card-top check proves the TOP EDGE only — no whole-card or CTA above-the-fold claim.
 * Mobile (below `md`) is not covered and stays OPEN.
 *
 * ONE UNMET REQUIREMENT on main, kept as a strict oracle in a `test.fail` (tracking, never acceptance) that flips red the
 * moment the product meets it: "Count look wrong?", the spec's correction path — no caller gives `ThisRunCard` an opener.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, simulateTranscription, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';

test.use({ viewport: { width: 1280, height: 800 } });

const FOLD = 800;
/** Spoken fillers, so THIS RUN can state a filler count rather than withhold it. */
const SPEECH = ['So um I think we should start with the main point.', 'Uh and then we close on the next step, um, today.'];
/** Pace is stated only from 15 s of speech (MIN_LIVE_PACE_SECONDS), so each take runs past it. */
const TAKE_MS = 16_500;
type Pair = { version: string; what_worked: string; what_to_try_next: string };
const SHORT_PAIR: Pair = {
    version: 'gemini_coaching_v1',
    what_worked: 'You opened with the point.',
    what_to_try_next: 'Pause before the takeaway.',
};
/** The tallest pair the server will serve: both fields at `COACHING_CHARACTER_CEILING` (240). */
const MAX_PAIR: Pair = {
    version: 'gemini_coaching_v1',
    what_worked: 'You opened with the point and kept it clear. '.repeat(6).slice(0, 240),
    what_to_try_next: 'Pause before the takeaway so it lands with weight. '.repeat(6).slice(0, 240),
};

/** The tallest Focus Points pair: the Focus version, both fields at the ceiling. */
const MAX_FOCUS_PAIR: Pair = { ...MAX_PAIR, version: 'gemini_coaching_focus_v1' };
/** A full Focus brief (OBJECTIVE_MAX_POINTS = 7), of which the take below covers the first five. */
const FOCUS_POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline', 'Mention the warranty', 'Offer the discount',
    'Compare the competitors', 'Invite questions'] as const;
const FOCUS_SPEECH = 'First I will name the price clearly. Then I state the guarantee we offer. Next I explain the timeline for delivery. '
    + 'I also mention the warranty on every unit. Finally I offer the discount for early orders.';

/**
 * One scripted answer per review request: the persisted pair, an HTTP status, a request that never arrived, or the pair
 * HELD in flight until the spec releases it (`releaseHeldReview`).
 */
type Answer = 'pair' | 'held-pair' | 'network' | { status: number };

/**
 * Wraps the e2e double's `functions.invoke` for `get-ai-suggestions` only. Each request takes the next scripted answer
 * (the last one repeats); a status rejects the way supabase-js does, a `FunctionsHttpError` with the `Response` on
 * `context`, and `network` the way a dropped request does, a `FunctionsFetchError` with no status. Requests are counted.
 */
async function scriptReview(page: Page, answers: Answer[], pair: Pair = SHORT_PAIR): Promise<() => Promise<number>> {
    await page.waitForFunction(() => Boolean((window as unknown as { supabase?: unknown }).supabase));
    await page.evaluate(({ script, pair }) => {
        type Invoke = (name: string, options?: unknown) => Promise<unknown>;
        const w = window as unknown as { supabase: { functions: { invoke: Invoke } }; __reviewRequests1474__: number };
        w.__reviewRequests1474__ = 0;
        const original: Invoke = w.supabase.functions.invoke.bind(w.supabase.functions);
        w.supabase.functions.invoke = (name, options) => {
            if (name !== 'get-ai-suggestions') return original(name, options);
            const answer = script[Math.min(w.__reviewRequests1474__, script.length - 1)];
            w.__reviewRequests1474__ += 1;
            if (answer === 'pair') return Promise.resolve({ data: { suggestions: pair }, error: null });
            if (answer === 'held-pair') {
                return new Promise((resolve) => {
                    (window as unknown as { __releaseReview1474__?: () => void }).__releaseReview1474__ = () => resolve({ data: { suggestions: pair }, error: null });
                });
            }
            if (answer === 'network') {
                return Promise.resolve({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } });
            }
            const context = new Response(JSON.stringify({ error: 'scripted' }), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
            return Promise.resolve({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context } });
        };
    }, { script: answers, pair });
    return () => page.evaluate(() => (window as unknown as { __reviewRequests1474__: number }).__reviewRequests1474__);
}

/**
 * A failed review is reported by ONE authored diagnostic per failed attempt. The shared fixture treats every unlisted
 * console error as fatal, so this spec counts that exact line and requires every other console error to be absent.
 */
const REVIEW_FAILED = /^\{err: [\s\S]*\} Error fetching AI suggestions:$/;
function guardConsole(page: Page): { reviewFailures: () => number; unexpected: () => string[] } {
    page.removeAllListeners('console');
    let reviewFailures = 0;
    const unexpected: string[] = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (REVIEW_FAILED.test(text)) reviewFailures += 1;
        else unexpected.push(text.slice(0, 200));
    });
    return { reviewFailures: () => reviewFailures, unexpected: () => [...unexpected] };
}

const isLocal = (url: string): boolean => {
    try {
        const u = new URL(url);
        return u.protocol === 'data:' || u.protocol === 'blob:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    } catch { return false; }
};
const originOf = (url: string): string => { try { return new URL(url).origin; } catch { return 'unparseable'; } };

/**
 * Strict localhost isolation (Sam 6235397901 / 6235656382, Codex P2 r4303190151). EGRESS IS PREVENTED BEFORE THE FIRST
 * NAVIGATION. The shared mocks end in a catch-all that lets every non-Supabase request through to the network, and
 * Playwright checks the LAST-registered route first, so a guard registered before login would sit behind that catch-all
 * and never run. Login's helper registers all its routes and THEN navigates (`page.goto('/')`), with none after. So the
 * blocking guard is armed INSIDE that first `goto`, after the helper's routes and before any request: it is checked
 * first and aborts every non-local request at the request stage — nothing leaves the browser, response or not.
 * Records, origins only, all of which must stay empty in an ordinary journey:
 *   ATTEMPTED from the outset: every non-local request the page issues, whatever then happens to it;
 *   REJECTED: what the guard blocked;
 *   REACHED from the outset: a non-local response with a server address (a mock fulfilment has none).
 * `armedBeforeAnyRequest` proves the ordering: no request of any kind was issued before the guard was armed.
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

async function expectIsolated(isolation: Isolation) {
    expect(isolation.armedBeforeAnyRequest(), 'the egress guard was armed before the first request').toBe(true);
    expect(isolation.attempted(), 'the page never issued a request off localhost, mocked or not').toEqual([]);
    expect(isolation.rejected(), 'nothing off localhost had to be blocked').toEqual([]);
    expect(isolation.reached(), 'no response came from a server off localhost').toEqual([]);
}

async function recordSavedTake(page: Page, answers: Answer[], pair: Pair = SHORT_PAIR): Promise<() => Promise<number>> {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    const requests = await scriptReview(page, answers, pair);
    await startRecording(page);
    await mockLiveTranscript(page, SPEECH);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(TAKE_MS); // a saved take long enough to state its pace
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    return requests;
}

type Box = { x: number; top: number; width: number };
type Layout = { A: Box; B: Box; C: Box; D: Box; cardTop: number };

/** Document coordinates (independent of any scroll the page applied) of the four slots and the review card. */
async function layout(page: Page): Promise<Layout> {
    return page.evaluate(() => {
        const at = (sel: string) => {
            const el = document.querySelector(sel);
            if (!el) throw new Error(`missing ${sel}`);
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + window.scrollX), top: Math.round(r.top + window.scrollY), width: Math.round(r.width) };
        };
        return {
            A: at('[data-testid="session-slot-a"]'),
            B: at('[data-testid="session-slot-b"]'),
            C: at('[data-testid="session-slot-c"]'),
            D: at('[data-testid="session-slot-d"]'),
            cardTop: at('[data-testid="ai-suggestions-card"]').top,
        };
    });
}

/** What every review state must keep, whatever the review says. Returns the layout for cross-state comparison. */
async function assertReviewStateInvariants(page: Page, state: string): Promise<Layout> {
    const main = page.getByRole('main');
    const card: Locator = page.getByTestId('ai-suggestions-card');
    await expect(card, `${state}: the review card renders`).toBeVisible();
    const shape = await layout(page);
    // The narrow top-position criterion only; whole-card and CTA viewport containment are not claimed here.
    expect(shape.cardTop, `${state}: the review card's top edge is above the fold at 1280×800`).toBeLessThan(FOLD);

    // THIS RUN carries the counts — in slot D, as bare numbers.
    const thisRun = page.getByTestId('session-slot-d').getByTestId('this-run-card');
    await expect(thisRun, `${state}: THIS RUN is in slot D`).toBeVisible();
    for (const metric of ['fillers', 'pace', 'words'] as const) {
        await expect(thisRun.getByTestId(`this-run-card-${metric}`), `${state}: THIS RUN shows ${metric}`).toHaveText(/^\d+$/);
    }
    // ...and the review band repeats none of them (PM 6045315752: removed from ALL review-band states).
    await expect(card.locator('[data-testid^="this-run-card"], [data-testid*="count"]'), `${state}: no counts panel in the review band`).toHaveCount(0);
    // The structural check above holds in EVERY state, the completed one included (Sam 2026-10-17 14:44 UTC). While the
    // review is pending or has failed, the band also states no measurement at all; a COMPLETED pair may quote one saved
    // measurement inside its coaching sentence as "From this session" evidence (#1258 G20), which is allowed.
    if (!(await card.getAttribute('data-lifecycle') === 'complete')) {
        // Either order: "3 fillers" / "120 wpm" and "Fillers: 3" / "Pace (wpm) 120" / "Words 24" (Codex P2 r4303136275).
        await expect(card, `${state}: no filler/pace/word count in the review band`)
            .not.toContainText(/\d[\d.,]*\s*(fillers?|filler words?|wpm|words?)\b|\b(fillers?|pace|wpm|words?)\b(\s*\(wpm\))?\s*[:=]?\s*\d/i);
    }

    const again = page.getByTestId('verdict-practice-again');
    await expect(again, `${state}: Practice again is offered`).toBeVisible();
    await expect(again, `${state}: Practice again is usable`).toBeEnabled();
    const mic = page.getByTestId('run-shape-mic');
    await expect(mic, `${state}: the microphone is back`).toBeVisible();
    await expect(mic).toBeEnabled();

    // Transcript-only review: there is no audio, so no transport of any kind (S-11).
    await expect(main.locator('audio, video'), `${state}: no media element`).toHaveCount(0);
    await expect(main.locator('[data-testid*="playback"], [data-testid*="scrubber"], [data-testid*="transport"]'), `${state}: no transport control`).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^(play|pause|replay|listen)\b/i }), `${state}: no play/pause button`).toHaveCount(0);
    return shape;
}

/**
 * What main meets against the saved review's slot map: slots A and B in place, and C and D in the same columns. This is
 * NOT the slot-stability criterion — that compares all four TOPS, and is the strict oracle of the unmet-requirement test.
 */
function expectSameColumns(actual: Layout, reference: Layout, state: string) {
    const columns = (l: Layout) => ({ A: l.A, B: l.B, C: { x: l.C.x, width: l.C.width }, D: { x: l.D.x, width: l.D.width } });
    expect(columns(actual), `${state}: A and B in place, C and D in their columns`).toEqual(columns(reference));
}

type ReviewState = 'saved review' | 'terminal failure' | 'scheduled retry' | 'terminal after retry';

/**
 * The three review answers, one take each, asserting every state's invariants. Returns each state's layout. The
 * acceptance test and the slot-top tracking test both run it, so the tracking test's ONLY extra claim is the tops.
 */
async function reviewJourney(page: Page, pair: Pair = SHORT_PAIR): Promise<Record<ReviewState, Layout>> {
    const consoleGuard = guardConsole(page);
    const isolation = isolateFromExternalNetwork(page);

    // ── SAVED REVIEW ──
    const savedRequests = await recordSavedTake(page, ['pair'], pair);
    const card = page.getByTestId('ai-suggestions-card');
    await expect(card).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
    await expect(page.getByTestId('ai-suggestions-pair'), 'saved review: the pair renders').toBeVisible();
    await expect(page.getByTestId('ai-suggestions-disclosure')).toBeVisible();
    const reference = await assertReviewStateInvariants(page, 'saved review');
    const layouts = { 'saved review': reference } as Record<ReviewState, Layout>;
    expect(await savedRequests(), 'saved review: one request').toBe(1);

    // ── TERMINAL FAILURE: 429 ends the lifecycle ──
    await page.getByTestId('verdict-practice-again').click();
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    const terminalRequests = await scriptReview(page, [{ status: 429 }]);
    await mockLiveTranscript(page, SPEECH);
    await page.waitForTimeout(TAKE_MS);
    await stopRecording(page);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute('data-lifecycle', 'terminal', { timeout: 20_000 });
    await expect(card, 'terminal: no retry is scheduled').toHaveAttribute('data-retry-scheduled', 'false');
    await expect(page.getByTestId('ai-suggestions-retrying'), 'terminal: no RETRYING chip').toHaveCount(0);
    await expect(page.getByTestId('ai-suggestions-headline'), 'terminal: the reason, in product language').toHaveText(/temporarily limited/);
    await expect(card, 'terminal: nothing promises an incoming review').not.toContainText(/on its way|still coming|Trying again/i);
    await expect(page.getByTestId('ai-suggestions-retry'), 'terminal 429: no futile Try again').toHaveCount(0);
    await expect(page.getByTestId('ai-suggestions-pair')).toHaveCount(0);
    await expect(page.getByTestId('ai-suggestions-disclosure'), 'terminal: the disclosure stays').toBeVisible();
    layouts['terminal failure'] = await assertReviewStateInvariants(page, 'terminal failure');
    expectSameColumns(layouts['terminal failure'], reference, 'terminal failure');
    expect(await terminalRequests(), 'terminal: no automatic retry of a 429').toBe(1);

    // ── SCHEDULED RETRY, then TERMINAL: two lost requests ──
    await page.getByTestId('verdict-practice-again').click();
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    const retryRequests = await scriptReview(page, ['network', 'network']);
    await mockLiveTranscript(page, SPEECH);
    await page.waitForTimeout(TAKE_MS);
    await stopRecording(page);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 20_000 });
    // The backoff window: the one automatic retry is scheduled and says so, without a usable button.
    await expect(card, 'scheduled: the automatic retry is scheduled').toHaveAttribute('data-retry-scheduled', 'true', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-lifecycle', 'pending');
    await expect(page.getByTestId('ai-suggestions-retrying'), 'scheduled: the RETRYING chip').toBeVisible();
    await expect(page.getByTestId('ai-suggestions-retry'), 'scheduled: "Trying again…" is not pressable').toBeDisabled();
    layouts['scheduled retry'] = await assertReviewStateInvariants(page, 'scheduled retry');
    expectSameColumns(layouts['scheduled retry'], reference, 'scheduled retry');
    // The second loss ends the lifecycle: no promise, a real Try again.
    await expect(card).toHaveAttribute('data-lifecycle', 'terminal', { timeout: 20_000 });
    await expect(card).toHaveAttribute('data-retry-scheduled', 'false');
    await expect(page.getByTestId('ai-suggestions-retrying')).toHaveCount(0);
    await expect(card, 'terminal after retry: nothing promises an incoming review').not.toContainText(/on its way|still coming|Trying again/i);
    const tryAgain = page.getByTestId('ai-suggestions-retry');
    await expect(tryAgain, 'terminal network: a real Try again').toHaveText('Try again');
    await expect(tryAgain).toBeEnabled();
    layouts['terminal after retry'] = await assertReviewStateInvariants(page, 'terminal after retry');
    expectSameColumns(layouts['terminal after retry'], reference, 'terminal after retry');
    expect(await retryRequests(), 'exactly one automatic retry').toBe(2);

    expect(consoleGuard.unexpected(), 'no console error other than the review failures\' own diagnostic').toEqual([]);
    expect(consoleGuard.reviewFailures(), 'one diagnostic per failed attempt: 429, then two lost requests').toBe(3);
    await expectIsolated(isolation);
    return layouts;
}

test.describe('#1474 G10 — the saved review, rendered, at 1280×800', () => {
    test('isolation guard: an external request issued during the initial login is blocked before it leaves the browser', async ({ page }) => {
        test.setTimeout(60_000);
        const PROBE = 'https://isolation-probe.invalid';
        const isolation = isolateFromExternalNetwork(page);
        // The blocked probe's own console line is the only console error this test may see.
        page.removeAllListeners('console');
        const consoleErrors: string[] = [];
        page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)); });
        const failed: string[] = [];
        page.on('requestfailed', (request) => {
            if (!isLocal(request.url())) failed.push(`${originOf(request.url())} ${request.failure()?.errorText ?? ''}`);
        });
        // Fired by the page itself during login's FIRST navigation, before the app has rendered anything.
        await page.addInitScript((probe) => { void fetch(`${probe}/login`).catch(() => null); }, PROBE);
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await expect.poll(() => failed, { message: 'the probe failed in the browser' }).not.toEqual([]);

        expect(isolation.armedBeforeAnyRequest(), 'armed before the first request').toBe(true);
        expect(isolation.attempted(), 'the page did issue the probe').toContain(PROBE);
        expect(isolation.rejected(), 'the guard blocked it').toContain(PROBE);
        // Blocked by this guard at the request stage — not a DNS failure, and no response ever arrived.
        // (Chromium reports a route abort as `net::ERR_BLOCKED_BY_CLIENT.Inspector`.)
        expect(failed.every((f) => f.startsWith(`${PROBE} net::ERR_BLOCKED_BY_CLIENT`)), failed.join(' | ')).toBe(true);
        expect(isolation.reached(), 'no response from off localhost').toEqual([]);
        expect(consoleErrors.filter((e) => !/ERR_BLOCKED_BY_CLIENT/.test(e)), 'no other console error').toEqual([]);
    });

    test('saved review vs terminal failure vs scheduled retry: counts only in THIS RUN, a next action in every state', async ({ page }) => {
        test.setTimeout(240_000);
        const layouts = await reviewJourney(page);
        await test.info().attach('slot-layouts-1280x800.json', { body: JSON.stringify(layouts, null, 2), contentType: 'application/json' });
    });

    const tops = (l: Layout) => ({ A: l.A.top, B: l.B.top, C: l.C.top, D: l.D.top });

    for (const [label, pair] of [['short pair', SHORT_PAIR], ['maximum-length pair', MAX_PAIR]] as const) {
        test(`slot stability (${label}): ALL FOUR slot tops identical across saved, terminal and scheduled-retry states`, async ({ page }) => {
            test.setTimeout(240_000);
            const layouts = await reviewJourney(page, pair);
            await test.info().attach('slot-tops-1280x800.json', { body: JSON.stringify(Object.fromEntries(Object.entries(layouts).map(([k, l]) => [k, tops(l)])), null, 2), contentType: 'application/json' });
            for (const state of ['terminal failure', 'scheduled retry', 'terminal after retry'] as const) {
                expect.soft(tops(layouts[state]), `${state}: every slot top matches the saved review`).toEqual(tops(layouts['saved review']));
            }
        });
    }

    test('slot stability: nothing below the review moves when a held review arrives (pending → complete, maximum-length pair)', async ({ page }) => {
        test.setTimeout(120_000);
        const consoleGuard = guardConsole(page);
        const isolation = isolateFromExternalNetwork(page);
        await recordSavedTake(page, ['held-pair'], MAX_PAIR);
        const card = page.getByTestId('ai-suggestions-card');
        await expect(card).toHaveAttribute('data-lifecycle', 'pending', { timeout: 20_000 });
        const pending = await layout(page);
        await page.evaluate(() => (window as unknown as { __releaseReview1474__: () => void }).__releaseReview1474__());
        await expect(card).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
        await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible();
        const complete = await layout(page);
        expect(tops(complete), 'the review arrived without moving any slot').toEqual(tops(pending));
        expect(consoleGuard.unexpected()).toEqual([]);
        await expectIsolated(isolation);
    });

    test('slot stability at every desktop range: the tallest completed review fits the reservation; THIS RUN and Practice again stay usable', async ({ page }) => {
        test.setTimeout(120_000);
        const consoleGuard = guardConsole(page);
        const isolation = isolateFromExternalNetwork(page);
        await recordSavedTake(page, ['pair'], MAX_PAIR);
        const card = page.getByTestId('ai-suggestions-card');
        await expect(card).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
        await expect(page.getByTestId('review-evidence'), 'the saved evidence line rendered').toBeVisible({ timeout: 10_000 });
        const measured: Record<number, unknown> = {};
        // The narrowest and widest width of each Tailwind range the rule covers (md 768–1023, lg 1024–1279, xl 1280+).
        for (const width of [768, 1023, 1024, 1279, 1280, 1440]) {
            await page.setViewportSize({ width, height: 800 });
            const m = await page.evaluate(() => {
                const c = document.querySelector('[data-testid="ai-suggestions-card"]') as HTMLElement;
                const reserved = parseFloat(getComputedStyle(c).minHeight) || 0;
                // Natural heights: the reservation lifted for the measurement only, then restored.
                c.style.minHeight = '0px';
                const openMic = Math.ceil(c.getBoundingClientRect().height);
                // Focus Points' worst evidence (OBJECTIVE_MAX_POINTS = 7: five detected with mm:ss, one not detected, one
                // not checked, and the recorded length — `focusPointsEvidence`'s four lines) in the same rendered markup.
                const ev = document.querySelector('[data-testid="review-evidence"]') as HTMLElement;
                const line = ev.querySelector('p:last-child') as HTMLElement;
                const original = line.textContent;
                line.textContent = 'Detected: point 1 at 10:12, point 2 at 10:41, point 3 at 11:05, point 4 at 11:30, point 5 at 12:00.';
                const extra = ['Not detected: point 6.', 'Not checked: point 7.', 'Recorded for 15:00.'].map((t) => {
                    const n = line.cloneNode() as HTMLElement;
                    n.textContent = t;
                    ev.appendChild(n);
                    return n;
                });
                const focusWorst = Math.ceil(c.getBoundingClientRect().height);
                extra.forEach((n) => n.remove());
                line.textContent = original;
                c.style.minHeight = '';
                return { reserved, openMic, focusWorst, scrollable: c.scrollHeight <= Math.ceil(c.getBoundingClientRect().height) };
            });
            measured[width] = m;
            expect(m.reserved, `${width}px: the card reserves a height`).toBeGreaterThan(0);
            expect(m.openMic, `${width}px: Open Mic's tallest review fits the reservation`).toBeLessThanOrEqual(m.reserved);
            expect(m.focusWorst, `${width}px: Focus Points' tallest review fits the reservation`).toBeLessThanOrEqual(m.reserved);
            expect(m.scrollable, `${width}px: nothing inside the card is clipped`).toBe(true);
            // Still usable at every width: THIS RUN's counts and the primary action can be reached and used.
            const thisRun = page.getByTestId('this-run-card');
            await thisRun.scrollIntoViewIfNeeded();
            await expect(thisRun.getByTestId('this-run-card-words'), `${width}px: THIS RUN readable`).toBeVisible();
            const again = page.getByTestId('verdict-practice-again');
            await again.scrollIntoViewIfNeeded();
            await expect(again, `${width}px: Practice again reachable`).toBeVisible();
            await expect(again).toBeEnabled();
            // Keyboard-reachable and unclipped: it takes focus, and its own centre hit-tests to it (nothing covers it).
            await again.focus();
            await expect(again, `${width}px: Practice again takes keyboard focus`).toBeFocused();
            expect(await again.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
            }), `${width}px: Practice again is not clipped or covered`).toBe(true);
        }
        await test.info().attach('review-reservation-by-width.json', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
        expect(consoleGuard.unexpected()).toEqual([]);
        await expectIsolated(isolation);
    });

    test('slot stability, Focus Points: the REAL completed review (7-point brief, its saved evidence, disclosure) fits the reservation at every desktop range', async ({ page }) => {
        test.setTimeout(180_000);
        const consoleGuard = guardConsole(page);
        const isolation = isolateFromExternalNetwork(page);
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/practice');
        await page.getByTestId('practice-card-objective').click();
        await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
        await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
        // OBJECTIVE_MAX_POINTS = 7: the form opens with three, so add four.
        for (let i = 3; i < FOCUS_POINTS.length; i++) await page.getByTestId('objective-add-point').click();
        for (let i = 0; i < FOCUS_POINTS.length; i++) await page.getByTestId(`objective-point-label-${i}`).fill(FOCUS_POINTS[i]);
        await page.getByTestId('objective-setup-submit').click();
        await page.waitForURL('**/session');
        await scriptReview(page, ['pair'], MAX_FOCUS_PAIR);
        await startRecording(page);
        await simulateTranscription(page, FOCUS_SPEECH, true);
        await page.waitForTimeout(TAKE_MS);
        await stopRecording(page);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
        const card = page.getByTestId('ai-suggestions-card');
        await expect(card).toHaveAttribute('data-lifecycle', 'complete', { timeout: 30_000 });
        const evidence = page.getByTestId('review-evidence');
        await expect(evidence, 'the saved Focus evidence rendered').toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('ai-suggestions-disclosure')).toContainText('saved Focus Points topic, points and results');
        const realLines = await evidence.locator('p').allInnerTexts();
        expect(realLines.some((l) => l.startsWith('Detected:')), `real evidence: ${realLines.join(' | ')}`).toBe(true);

        const measured: Record<number, unknown> = {};
        for (const width of [768, 1023, 1024, 1279, 1280, 1440]) {
            await page.setViewportSize({ width, height: 800 });
            const m = await page.evaluate(() => {
                const c = document.querySelector('[data-testid="ai-suggestions-card"]') as HTMLElement;
                const reserved = parseFloat(getComputedStyle(c).minHeight) || 0;
                c.style.minHeight = '0px';
                // The real completed Focus card, as saved and rendered.
                const real = Math.ceil(c.getBoundingClientRect().height);
                // Upper bound on the same real card: `focusPointsEvidence`'s longest output (7 points: five detected with
                // mm:ss, one not detected, one not checked, and the recorded length) replacing the saved lines.
                const ev = document.querySelector('[data-testid="review-evidence"]') as HTMLElement;
                const lines = Array.from(ev.querySelectorAll('p')).slice(1) as HTMLElement[];
                const template = lines[lines.length - 1];
                const originals = lines.map((l) => l.textContent);
                const worst = ['Detected: point 1 at 10:12, point 2 at 10:41, point 3 at 11:05, point 4 at 11:30, point 5 at 12:00.',
                    'Not detected: point 6.', 'Not checked: point 7.', 'Recorded for 15:00.'];
                const added: HTMLElement[] = [];
                worst.forEach((text, i) => {
                    if (lines[i]) { lines[i].textContent = text; return; }
                    const n = template.cloneNode() as HTMLElement;
                    n.textContent = text;
                    ev.appendChild(n);
                    added.push(n);
                });
                const extraLines = lines.slice(worst.length);
                extraLines.forEach((l) => { l.style.display = 'none'; });
                const worstCase = Math.ceil(c.getBoundingClientRect().height);
                extraLines.forEach((l) => { l.style.display = ''; });
                added.forEach((n) => n.remove());
                lines.forEach((l, i) => { l.textContent = originals[i]; });
                c.style.minHeight = '';
                return { reserved, real, worstCase, unclipped: c.scrollHeight <= Math.ceil(c.getBoundingClientRect().height) };
            });
            measured[width] = m;
        }
        // Attached BEFORE the assertions, so a failing width still leaves its measurements behind.
        await test.info().attach('focus-review-reservation-by-width.json', { body: JSON.stringify({ realLines, measured }, null, 2), contentType: 'application/json' });
        for (const [width, m] of Object.entries(measured) as Array<[string, { reserved: number; real: number; worstCase: number; unclipped: boolean }]>) {
            expect.soft(m.real, `${width}px: the real Focus review fits the reservation`).toBeLessThanOrEqual(m.reserved);
            expect.soft(m.worstCase, `${width}px: Focus's longest evidence fits the reservation`).toBeLessThanOrEqual(m.reserved);
            expect.soft(m.unclipped, `${width}px: nothing inside the card is clipped`).toBe(true);
        }
        expect(consoleGuard.unexpected()).toEqual([]);
        await expectIsolated(isolation);
    });

    test('"Count look wrong?" — the correction path in THIS RUN (UNMET: no caller wires ThisRunCard.onCountLookWrong)', async ({ page }) => {
        test.setTimeout(120_000);
        const consoleGuard = guardConsole(page);
        const isolation = isolateFromExternalNetwork(page);
        await recordSavedTake(page, ['pair']);
        await expect(page.getByTestId('ai-suggestions-card')).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
        await expect(page.getByTestId('this-run-card'), 'setup: THIS RUN rendered').toBeVisible();
        expect(consoleGuard.unexpected(), 'setup: no unexpected console error').toEqual([]);
        await expectIsolated(isolation);
        // Marked only now, after the saved review rendered, so a setup failure can never pass as this known failure.
        // Tracking, not acceptance: the expected failure keeps an UNMET requirement visible and never counts as its PASS.
        test.info().annotations.push({ type: 'unmet-requirement', description: '#1474 G10 "Count look wrong?" — not rendered on main' });
        test.fail(true, 'UNMET on main: "Count look wrong?" is never rendered');
        await expect(page.getByTestId('this-run-card').getByRole('button', { name: 'Count look wrong?' })).toBeVisible({ timeout: 5_000 });
    });
});
