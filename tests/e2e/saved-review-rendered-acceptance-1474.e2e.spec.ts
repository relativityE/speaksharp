/**
 * #1474 G10 — the saved-review page as a person meets it at 1280×800 (Sam disposition 2026-10-17 14:32 UTC).
 *
 * One Open Mic take, saved through the e2e double, then the review answered three ways by a scripted
 * `get-ai-suggestions` (localhost only; no provider, persistence or production call):
 *   SAVED REVIEW: the pair renders;
 *   TERMINAL FAILURE: 429 — the lifecycle has ended, so nothing may promise an incoming review and no futile Try again;
 *   SCHEDULED RETRY → TERMINAL: a lost request schedules the ONE automatic retry ("Trying again…", disabled), and a
 *   second loss ends the lifecycle with a real Try again.
 * Every state must keep: the review card's top above the fold, the four slots where the saved review puts them,
 * fillers/pace/words in THIS RUN only (PM 6045315752 removed counts from every review-band state), Practice again
 * enabled, the microphone, and no playback transport.
 *
 * "Count look wrong?" is the spec's correction path. On main no caller gives `ThisRunCard` an opener, so it never
 * renders. It is an UNMET requirement: the check is `test.fail` (tracking, never acceptance) until a product slice wires
 * it, and flips red the moment it ships.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';

test.use({ viewport: { width: 1280, height: 800 } });

const FOLD = 800;
/** Spoken fillers, so THIS RUN can state a filler count rather than withhold it. */
const SPEECH = ['So um I think we should start with the main point.', 'Uh and then we close on the next step, um, today.'];
/** Pace is stated only from 15 s of speech (MIN_LIVE_PACE_SECONDS), so each take runs past it. */
const TAKE_MS = 16_500;
const PAIR = {
    version: 'gemini_coaching_v1',
    what_worked: 'You opened with the point.',
    what_to_try_next: 'Pause before the takeaway.',
};

/** One scripted answer per review request: the persisted pair, an HTTP status, or a request that never arrived. */
type Answer = 'pair' | 'network' | { status: number };

/**
 * Wraps the e2e double's `functions.invoke` for `get-ai-suggestions` only. Each request takes the next scripted answer
 * (the last one repeats); a status rejects the way supabase-js does, a `FunctionsHttpError` with the `Response` on
 * `context`, and `network` the way a dropped request does, a `FunctionsFetchError` with no status. Requests are counted.
 */
async function scriptReview(page: Page, answers: Answer[]): Promise<() => Promise<number>> {
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
            if (answer === 'network') {
                return Promise.resolve({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } });
            }
            const context = new Response(JSON.stringify({ error: 'scripted' }), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
            return Promise.resolve({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context } });
        };
    }, { script: answers, pair: PAIR });
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

async function recordSavedTake(page: Page, answers: Answer[]): Promise<() => Promise<number>> {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    const requests = await scriptReview(page, answers);
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
    expect(shape.cardTop, `${state}: the review card's top is above the fold at 1280×800`).toBeLessThan(FOLD);

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
        await expect(card, `${state}: no filler/pace/word count in the review band`).not.toContainText(/\d+\s*(fillers?|wpm|words?)\b/i);
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
 * The saved review's slot map is the reference. Slot B is full width and its height follows the review, so the C/D row
 * below it moves down with it; what may never move is where A and B start, which column C and D occupy, and that they
 * remain one row under B.
 */
function expectSameSlots(actual: Layout, reference: Layout, state: string) {
    const fixed = (l: Layout) => ({ A: l.A, B: l.B, C: { x: l.C.x, width: l.C.width }, D: { x: l.D.x, width: l.D.width } });
    expect(fixed(actual), `${state}: slots stay where the saved review puts them`).toEqual(fixed(reference));
    expect(actual.D.top, `${state}: THIS RUN stays level with the transcript`).toBe(actual.C.top);
    expect(actual.C.top, `${state}: the C/D row stays under the review`).toBeGreaterThan(actual.B.top);
}

test.describe('#1474 G10 — the saved review, rendered, at 1280×800', () => {
    test('saved review vs terminal failure vs scheduled retry: same slots, counts only in THIS RUN, a next action in every state', async ({ page }) => {
        test.setTimeout(240_000);
        const consoleGuard = guardConsole(page);

        // ── SAVED REVIEW ──
        const savedRequests = await recordSavedTake(page, ['pair']);
        const card = page.getByTestId('ai-suggestions-card');
        await expect(card).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
        await expect(page.getByTestId('ai-suggestions-pair'), 'saved review: the pair renders').toBeVisible();
        await expect(page.getByTestId('ai-suggestions-disclosure')).toBeVisible();
        const reference = await assertReviewStateInvariants(page, 'saved review');
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
        expectSameSlots(await assertReviewStateInvariants(page, 'terminal failure'), reference, 'terminal failure');
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
        expectSameSlots(await assertReviewStateInvariants(page, 'scheduled retry'), reference, 'scheduled retry');
        // The second loss ends the lifecycle: no promise, a real Try again.
        await expect(card).toHaveAttribute('data-lifecycle', 'terminal', { timeout: 20_000 });
        await expect(card).toHaveAttribute('data-retry-scheduled', 'false');
        await expect(page.getByTestId('ai-suggestions-retrying')).toHaveCount(0);
        await expect(card, 'terminal after retry: nothing promises an incoming review').not.toContainText(/on its way|still coming|Trying again/i);
        const tryAgain = page.getByTestId('ai-suggestions-retry');
        await expect(tryAgain, 'terminal network: a real Try again').toHaveText('Try again');
        await expect(tryAgain).toBeEnabled();
        expectSameSlots(await assertReviewStateInvariants(page, 'terminal after retry'), reference, 'terminal after retry');
        expect(await retryRequests(), 'exactly one automatic retry').toBe(2);

        expect(consoleGuard.unexpected(), 'no console error other than the review failures\' own diagnostic').toEqual([]);
        expect(consoleGuard.reviewFailures(), 'one diagnostic per failed attempt: 429, then two lost requests').toBe(3);
    });

    test.fail('"Count look wrong?" — the correction path in THIS RUN (KNOWN GAP: no caller wires ThisRunCard.onCountLookWrong)', async ({ page }) => {
        test.setTimeout(120_000);
        // Tracking, not acceptance: this expected failure keeps an UNMET requirement visible and never counts as its PASS.
        test.info().annotations.push({ type: 'unmet-requirement', description: '#1474 G10 "Count look wrong?" — not rendered on main' });
        guardConsole(page);
        await recordSavedTake(page, ['pair']);
        await expect(page.getByTestId('ai-suggestions-card')).toHaveAttribute('data-lifecycle', 'complete', { timeout: 20_000 });
        await expect(page.getByTestId('this-run-card').getByRole('button', { name: 'Count look wrong?' })).toBeVisible({ timeout: 5_000 });
    });
});
