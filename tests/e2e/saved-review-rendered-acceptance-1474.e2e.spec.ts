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
 * ONE UNMET REQUIREMENT on main, kept as a strict oracle in a `test.fail` (tracking, never acceptance) that flips red the
 * moment the product meets it: ALL FOUR SLOT TOPS identical across saved, pending and terminal states (Sam RETURN
 * 6235391344). Slots A and B hold, but slot B's height follows the review, so the transcript/THIS RUN row (C/D) moves
 * vertically between states.
 *
 * "Count look wrong?", the spec's correction path, is now a passing check (#1474 opener, PR #1649): it renders in THIS
 * RUN and opens the existing Share Feedback dialog, with focus returning to it on close and nothing sent.
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
const PAIR: Pair = {
    version: 'gemini_coaching_v1',
    what_worked: 'You opened with the point.',
    what_to_try_next: 'Pause before the takeaway.',
};
/** The tallest Open Mic pair the server serves: both fields at `COACHING_CHARACTER_CEILING` (240). */
const MAX_PAIR: Pair = {
    version: 'gemini_coaching_v1',
    what_worked: 'You opened with the point and kept it clear. '.repeat(6).slice(0, 240),
    what_to_try_next: 'Pause before the takeaway so it lands with weight. '.repeat(6).slice(0, 240),
};

/**
 * One scripted answer per review request: the persisted pair, an HTTP status, a request that never arrived, or the pair
 * HELD in flight until the spec releases it (`__releaseReview1474__`).
 */
type Answer = 'pair' | 'held-pair' | 'network' | { status: number };

/**
 * Wraps the e2e double's `functions.invoke` for `get-ai-suggestions` only. Each request takes the next scripted answer
 * (the last one repeats); a status rejects the way supabase-js does, a `FunctionsHttpError` with the `Response` on
 * `context`, and `network` the way a dropped request does, a `FunctionsFetchError` with no status. Requests are counted.
 */
async function scriptReview(page: Page, answers: Answer[], pairToServe: Pair = PAIR): Promise<() => Promise<number>> {
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
    }, { script: answers, pair: pairToServe });
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

async function recordSavedTake(page: Page, answers: Answer[], pair: Pair = PAIR): Promise<() => Promise<number>> {
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
async function reviewJourney(page: Page): Promise<Record<ReviewState, Layout>> {
    const consoleGuard = guardConsole(page);
    const isolation = isolateFromExternalNetwork(page);

    // ── SAVED REVIEW ──
    const savedRequests = await recordSavedTake(page, ['pair']);
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

    test('ALL FOUR slot tops identical across saved, pending and terminal states (UNMET: slot C/D tops move with slot B)', async ({ page }) => {
        test.setTimeout(240_000);
        const layouts = await reviewJourney(page);
        // Marked only now, after the whole journey succeeded, so a setup failure can never pass as this known failure.
        // Tracking, not acceptance: the expected failure keeps an UNMET requirement visible and never counts as its PASS.
        test.info().annotations.push({ type: 'unmet-requirement', description: '#1474 G10 slot stability — C/D tops differ between review states on main' });
        test.fail(true, 'UNMET on main: slot C/D tops move with slot B between review states');
        const tops = (l: Layout) => ({ A: l.A.top, B: l.B.top, C: l.C.top, D: l.D.top });
        await test.info().attach('slot-tops-1280x800.json', { body: JSON.stringify(Object.fromEntries(Object.entries(layouts).map(([k, l]) => [k, tops(l)])), null, 2), contentType: 'application/json' });
        for (const state of ['terminal failure', 'scheduled retry', 'terminal after retry'] as const) {
            expect.soft(tops(layouts[state]), `${state}: every slot top matches the saved review`).toEqual(tops(layouts['saved review']));
        }
    });

    test('"Count look wrong?" — the correction path in THIS RUN opens Share Feedback; focus returns; nothing is sent', async ({ page }) => {
        test.setTimeout(120_000);
        const consoleGuard = guardConsole(page);
        const isolation = isolateFromExternalNetwork(page);
        await recordSavedTake(page, ['pair']);
        await expect(page.getByTestId('ai-suggestions-card')).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
        const link = page.getByTestId('this-run-card').getByRole('button', { name: 'Count look wrong?' });
        await expect(link, 'the correction path renders in THIS RUN').toBeVisible({ timeout: 5_000 });
        // Keyboard: the link opens exactly one Share Feedback dialog — the Navigation-owned one, not a second form.
        await link.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: 'Share feedback' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(page.getByTestId('issue-report-submit'), 'opening sends nothing on its own').toBeVisible();
        // Escape closes it without sending; focus returns to the link that asked.
        await page.keyboard.press('Escape');
        await expect(page.getByRole('heading', { name: 'Share feedback' })).toHaveCount(0);
        await expect(link).toBeFocused();
        await expect(page.getByText('Thanks — we’ve got it.'), 'no report was sent').toHaveCount(0);
        expect(consoleGuard.unexpected(), 'no unexpected console error').toEqual([]);
        await expectIsolated(isolation);
    });
});

// ── #1474 γ — natural growth, useful feedback at eye level (Sam 6240521998) ─────────────────────────────────────────────
//
// Natural growth is accepted: section identity and order are stable, and the C/D row may move with the review's height.
// What replaces the strict all-four-tops oracle (which stays above as `test.fail` until this is reviewed):
//   1. USEFUL COACHING AT EYE LEVEL — at the TOP OF THE PAGE (the spec scrolls there; that observation is not proof of the
//      page's own automatic placement), the actual prescription ("Try this next run") is fully visible above any fixed
//      bar; in pending and terminal states the truthful headline is. A card header sliver does not count. The exact
//      maximum coaching text, message and saved evidence are asserted to have rendered BEFORE anything is measured.
//   2. THE REPEAT/RETRY ACTION — Open Mic "Practice again", Focus "Retry this set" — is FULLY unobscured once brought into
//      view: after PROGRAMMATIC FOCUS (the browser's focus-scroll — not sequential Tab navigation) and after being scrolled
//      to the middle of the screen, clear of the fixed bottom bar. Whether it is visible at the top of the page is
//      recorded separately (discoverability is distinct evidence from clearance).
//   3. SECONDARY COUNTS — intact, readable and scroll-reachable; above or below the fold is REPORTED, never asserted visible.
// Every state is measured at each supported viewport with the server's maximum coaching length and real saved evidence.

const MAX_FOCUS_PAIR: Pair = { ...MAX_PAIR, version: 'gemini_coaching_focus_v1' };
const FOCUS_POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline', 'Mention the warranty', 'Offer the discount',
    'Compare the competitors', 'Invite questions'] as const;
const FOCUS_SPEECH = 'First I will name the price clearly. Then I state the guarantee we offer. Next I explain the timeline for delivery. '
    + 'I also mention the warranty on every unit. Finally I offer the discount for early orders.';
const DESKTOP_VIEWPORTS = [
    { name: 'desktop 1280×800', width: 1280, height: 800 },
    { name: 'desktop 1024×800', width: 1024, height: 800 },
    { name: 'tablet 768×800', width: 768, height: 800 },
] as const;
const MOBILE_VIEWPORTS = [{ name: 'mobile 375×812', width: 375, height: 812 }] as const;
type Viewport = (typeof DESKTOP_VIEWPORTS)[number] | (typeof MOBILE_VIEWPORTS)[number];
/**
 * Measured mobile gaps (OPEN, Sam 6240521998): each keeps its strict assertions in a test marked as an expected failure only
 * after the take saved and was measured, annotated `unmet-requirement`, and flips red the moment the product meets it.
 */
const MOBILE_UNMET: Partial<Record<string, { gap: Gap; text: string }>> = {
    'open_mic · full': { gap: 'coaching-visible', text: 'the full "Try this next run" box ends under the fixed bottom bar at the top of the page' },
    'open_mic · partial': { gap: 'action-focus-clear', text: 'programmatic focus leaves Practice again partly under the fixed bottom bar (the browser treats it as already in view)' },
    'focus_points · full': { gap: 'coaching-visible', text: 'the full "Try this next run" box ends under the fixed bottom bar at the top of the page' },
};
type Product = 'open_mic' | 'focus_points';
type GammaState = 'full' | 'partial' | 'pending' | 'terminal';

/** A saved Focus Points take on a full (7-point) brief whose speech covers five points, so the saved evidence is real. */
async function focusSavedTake(page: Page, answers: Answer[], pair: Pair): Promise<void> {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    for (let i = 3; i < FOCUS_POINTS.length; i++) await page.getByTestId('objective-add-point').click();
    for (let i = 0; i < FOCUS_POINTS.length; i++) await page.getByTestId(`objective-point-label-${i}`).fill(FOCUS_POINTS[i]);
    await page.getByTestId('objective-setup-submit').click();
    await page.waitForURL('**/session');
    await scriptReview(page, answers, pair);
    await startRecording(page);
    await simulateTranscription(page, FOCUS_SPEECH, true);
    await page.waitForTimeout(TAKE_MS);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
}

type ViewportResult = {
    viewport: string;
    coaching: { which: string; top: number; bottom: number; usableBottom: number; fullyVisible: boolean } | null;
    action: { label: string; initiallyFullyVisible: boolean; afterFocus: Clearance; afterScroll: Clearance; enabled: boolean } | null;
    counts: Array<{ row: string; bottom: number; aboveFold: boolean; reachable: boolean }>;
};
type Clearance = { top: number; bottom: number; usableBottom: number; fullyUnobscured: boolean; hitsItself: boolean; focused?: boolean };

/**
 * Where the element sits now, and whether it is FULLY unobscured: entirely inside the usable viewport — the window, or
 * down to the top of a visible fixed bottom bar — with its centre hit-testing to itself (nothing drawn over it).
 */
async function clearance(locator: Locator): Promise<Clearance> {
    return locator.evaluate((el) => {
        const bar = document.querySelector('[data-testid="session-start-stop-button-mobile"]')?.closest('.fixed');
        const barRect = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect() : null;
        const usableBottom = barRect && barRect.height > 0 && barRect.top < window.innerHeight
            ? Math.min(window.innerHeight, barRect.top) : window.innerHeight;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
            top: Math.round(r.top), bottom: Math.round(r.bottom), usableBottom: Math.round(usableBottom),
            fullyUnobscured: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= usableBottom,
            hitsItself: Boolean(hit && (el === hit || el.contains(hit))),
            focused: document.activeElement === el,
        };
    });
}

/** Waits until the page stops scrolling (smooth scrolling animates), so a measurement is never taken mid-scroll. */
async function settleScroll(page: Page): Promise<void> {
    await page.waitForFunction(() => new Promise<boolean>((resolve) => {
        const y = window.scrollY;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY === y)));
    }), undefined, { timeout: 3_000, polling: 50 });
}

async function measureViewport(page: Page, product: Product, state: GammaState, vp: Viewport): Promise<ViewportResult> {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await settleScroll(page);
    const prescription = page.getByTestId('review-try-next');
    const headline = page.getByTestId('ai-suggestions-headline');
    const coachingLocator = state === 'full' || state === 'partial' ? prescription : headline;
    let coaching: ViewportResult['coaching'] = null;
    if (await coachingLocator.count()) {
        const c = await clearance(coachingLocator.first());
        coaching = { which: state === 'full' || state === 'partial' ? 'Try this next run' : 'review headline', top: c.top, bottom: c.bottom,
            usableBottom: c.usableBottom, fullyVisible: c.fullyUnobscured };
    }
    const action = product === 'open_mic' ? page.getByTestId('verdict-practice-again') : page.getByRole('button', { name: /Retry this set/ });
    let actionResult: ViewportResult['action'] = null;
    if (await action.count()) {
        const el = action.first();
        const initial = await clearance(el);
        // Keyboard: focus moves the page to the control (the browser's own focus scroll), then it must be clear of the bar.
        // Blur first: focusing an element that is ALREADY focused (from the previous viewport) does not scroll at all.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleScroll(page);
        await el.focus();
        await settleScroll(page);
        const afterFocus = await clearance(el);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleScroll(page);
        // A person scrolls the control into view; Playwright's scrollIntoViewIfNeeded leaves a PARTLY visible element where
        // it is, so the page is scrolled the way a person would bring it to the middle of the screen.
        await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await settleScroll(page);
        const afterScroll = await clearance(el);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
        actionResult = { label: product === 'open_mic' ? 'Practice again' : 'Retry this set', initiallyFullyVisible: initial.fullyUnobscured,
            afterFocus, afterScroll, enabled: await el.isEnabled() };
    }
    const rowIds = product === 'open_mic'
        ? ['this-run-card-fillers', 'this-run-card-pace', 'this-run-card-words']
        : ['coverage-pace-count', 'coverage-pace-bar', 'coverage-pace-projection'];
    const counts: ViewportResult['counts'] = [];
    for (const id of rowIds) {
        const row = page.getByTestId(id);
        if (!(await row.count())) continue;
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleScroll(page);
        const atTop = await clearance(row.first());
        await row.first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await settleScroll(page);
        const reached = await clearance(row.first());
        counts.push({ row: id, bottom: atTop.bottom, aboveFold: atTop.fullyUnobscured, reachable: reached.fullyUnobscured && reached.hitsItself });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return { viewport: vp.name, coaching, action: actionResult, counts };
}

const GAMMA_CASES: Array<{ product: Product; state: GammaState }> = (['open_mic', 'focus_points'] as const)
    .flatMap((product) => (['full', 'partial', 'pending', 'terminal'] as const).map((state) => ({ product, state })));

/** One saved take in the given review state, measured at each viewport, with every γ criterion asserted. */
async function gammaCase(page: Page, product: Product, state: GammaState, viewports: readonly Viewport[], label: string) {
    const consoleGuard = guardConsole(page);
    const isolation = isolateFromExternalNetwork(page);
    const answers: Answer[] = state === 'terminal' ? [{ status: 429 }] : state === 'pending' ? ['held-pair'] : ['pair'];
    const pair = product === 'open_mic' ? (state === 'partial' ? PAIR : MAX_PAIR) : (state === 'partial' ? { ...PAIR, version: 'gemini_coaching_focus_v1' } : MAX_FOCUS_PAIR);
    if (product === 'open_mic') await recordSavedTake(page, answers, pair);
    else await focusSavedTake(page, answers, pair);
    const lifecycle = state === 'terminal' ? 'terminal' : state === 'pending' ? 'pending' : 'complete';
    await expect(page.getByTestId('ai-suggestions-card')).toHaveAttribute('data-lifecycle', lifecycle, { timeout: 30_000 });
    // Sam 6240941568: what is measured must be the INTENDED content — the exact coaching (maximum length for `full`), the
    // truthful message, and the saved fixture evidence — or a shortened or wrong paragraph could flatter the layout.
    if (lifecycle === 'complete') {
        await expect(page.getByTestId('review-what-went-well'), 'the exact saved "What went well" rendered').toHaveText(pair.what_worked, { timeout: 10_000 });
        await expect(page.getByTestId('review-try-next'), 'the exact saved prescription rendered').toHaveText(pair.what_to_try_next);
        const evidence = page.getByTestId('review-evidence');
        await expect(evidence, 'the saved "From this session" evidence rendered').toBeVisible({ timeout: 15_000 });
        await expect(evidence, 'the evidence is this product\'s real saved evidence').toContainText(
            product === 'open_mic' ? /(filler words|words) a minute/ : /Detected: point 1 at \d+:\d{2}, point 2 at[\s\S]*Not detected: point 6, point 7\.[\s\S]*Recorded for \d+:\d{2}\./);
    } else if (lifecycle === 'pending') {
        await expect(page.getByTestId('ai-suggestions-headline'), 'the truthful pending message').toHaveText('Your review is on its way.');
    } else {
        await expect(page.getByTestId('ai-suggestions-headline'), 'the truthful terminal message').toHaveText(/Review requests are temporarily limited\. Your session is saved; please try again later\./);
    }

    const results: ViewportResult[] = [];
    for (const vp of viewports) results.push(await measureViewport(page, product, state, vp));
    await test.info().attach(`gamma-${label}-${product}-${state}.json`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    if (state === 'pending') await page.evaluate(() => (window as unknown as { __releaseReview1474__?: () => void }).__releaseReview1474__?.());
    expect(consoleGuard.unexpected(), 'no unexpected console error').toEqual([]);
    await expectIsolated(isolation);
    return results;
}

/** The one measured gap a mobile tracker isolates; every OTHER criterion keeps failing normally on regression. */
type Gap = 'coaching-visible' | 'action-focus-clear';

function expectGamma(results: ViewportResult[], excluded: Gap | null = null) {
    for (const r of results) {
        expect.soft(r.coaching, `${r.viewport}: the coaching element rendered`).not.toBeNull();
        if (excluded !== 'coaching-visible') {
            expect.soft(r.coaching?.fullyVisible, `${r.viewport}: ${r.coaching?.which} is fully readable at the top of the page`).toBe(true);
        }
        expect.soft(r.action, `${r.viewport}: the repeat/retry action rendered`).not.toBeNull();
        expect.soft(r.action?.enabled, `${r.viewport}: the action is enabled`).toBe(true);
        if (excluded !== 'action-focus-clear') {
            expect.soft(r.action?.afterFocus.focused && r.action?.afterFocus.fullyUnobscured && r.action?.afterFocus.hitsItself,
                `${r.viewport}: programmatic focus (focus-scroll) leaves the action fully clear of any fixed bar`).toBe(true);
        }
        expect.soft(r.action?.afterScroll.fullyUnobscured && r.action?.afterScroll.hitsItself,
            `${r.viewport}: scrolled into view, the action is fully clear of any fixed bar`).toBe(true);
        expect.soft(r.counts.length, `${r.viewport}: all three count rows render`).toBe(3);
        for (const c of r.counts) expect.soft(c.reachable, `${r.viewport}: ${c.row} is scroll-reachable and unobscured`).toBe(true);
    }
}

test.describe('#1474 γ desktop — natural growth: useful coaching at eye level, an unobscured repeat action, reachable counts', () => {
    for (const { product, state } of GAMMA_CASES) {
        test(`${product} · ${state} at 1280×800, 1024×800 and 768×800`, async ({ page }) => {
            test.setTimeout(200_000);
            expectGamma(await gammaCase(page, product, state, DESKTOP_VIEWPORTS, 'desktop'));
        });
    }
});

test.describe('#1474 γ mobile 375×812 — the same criteria; every non-gap criterion must pass', () => {
    for (const { product, state } of GAMMA_CASES) {
        const key = `${product} · ${state}`;
        const unmet = MOBILE_UNMET[key];
        test(`${key} at 375×812${unmet ? ` (all criteria except the isolated gap: ${unmet.gap})` : ''}`, async ({ page }) => {
            test.setTimeout(200_000);
            expectGamma(await gammaCase(page, product, state, MOBILE_VIEWPORTS, 'mobile'), unmet?.gap ?? null);
        });
    }
});

/*
 * Sam 6240939196 — each measured mobile gap is its OWN narrow tracker: it asserts ONLY the documented gap, marked as an
 * expected failure only after the take saved, rendered its intended content and was measured. Every other criterion for
 * the same case is asserted in the ordinary test above, so an unrelated regression fails normally instead of hiding here.
 */
test.describe('#1474 γ mobile 375×812 — measured gaps (OPEN, unmet requirements)', () => {
    for (const [key, unmet] of Object.entries(MOBILE_UNMET)) {
        if (!unmet) continue;
        const [product, state] = key.split(' · ') as [Product, GammaState];
        test(`UNMET ${key} at 375×812: ${unmet.text}`, async ({ page }) => {
            test.setTimeout(200_000);
            const [r] = await gammaCase(page, product, state, MOBILE_VIEWPORTS, 'mobile-gap');
            // Marked only now, after setup succeeded, so a setup failure cannot pass as this gap.
            // Tracking, not acceptance: the expected failure keeps an UNMET requirement visible and never counts as its PASS.
            test.info().annotations.push({ type: 'unmet-requirement', description: `#1474 mobile 375×812 ${key}: ${unmet.text}` });
            test.fail(true, `UNMET on main: ${unmet.text}`);
            if (unmet.gap === 'coaching-visible') {
                expect(r.coaching?.fullyVisible, `${r.viewport}: ${r.coaching?.which} is fully readable at the top of the page`).toBe(true);
            } else {
                expect(r.action?.afterFocus.focused && r.action?.afterFocus.fullyUnobscured && r.action?.afterFocus.hitsItself,
                    `${r.viewport}: programmatic focus (focus-scroll) leaves the action fully clear of any fixed bar`).toBe(true);
            }
        });
    }
});
