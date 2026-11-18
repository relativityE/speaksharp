/**
 * #1897 review 4 (Sam, Nov 18): on a #1835 build whose run settled coaching OFF (saving on, AI coaching off) or saving OFF,
 * the Focus journey's coaching, Back/reload and Analytics checks expected coaching or a transcript. Those could only hold or
 * fail, never pass. Each mode is routed here to AFFIRMATIVE evidence of what the product must do instead:
 *   - after Stop: the coaching-off band for that mode, no review phrases, no coaching request in a settle window, and no
 *     coaching saved on the row;
 *   - Back from Progress and a reload: the same saved session read-only, microphone off, the restored review band for that
 *     mode, the saved transcript (coaching off) or the "not captured" notice and no transcript (saving off), the saved Focus
 *     results matching the first take's rail, the saved verdicts unchanged, and nothing requested;
 *   - Analytics: opened through the person's own controls, the transcript per mode before and after a reload, no AI
 *     suggestions (the saved review reads `none`), and the saved Focus results matching the rail.
 * Only booleans, closed-set labels and digests leave the page; the transcript itself is never returned or logged.
 */
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { PracticeChoice, PrivacyBuild } from './rwtPracticeConsent';

/** The after-Stop row an off mode writes in place of the coaching-on rows. */
export const FOCUS_COACHING_OFF_ROW = 'Focus coaching off: no review requested';

export type ReviewMode = 'coaching_on' | 'coaching_off_saved' | 'saving_off';
export type OffMode = Exclude<ReviewMode, 'coaching_on'>;
type Verdict = 'PASS' | 'FAIL' | 'HOLD';

/**
 * Pure. Which review the run must check. A verified pre-#1835 build always saved and coached; a #1835 build follows the
 * run's recorded choice. An unknown build, or a #1835 build without a recorded choice, is null: nothing is assumed.
 */
export function reviewModeOf(consent: { build: PrivacyBuild; choice: PracticeChoice | null }): ReviewMode | null {
    if (consent.build === 'predates_1835') return 'coaching_on';
    if (consent.build !== 'includes_1835' || !consent.choice) return null;
    if (!consent.choice.transcriptSave) return 'saving_off';
    return consent.choice.aiCoaching ? 'coaching_on' : 'coaching_off_saved';
}

/** The band each off mode must show (AISuggestions `data-coaching-off`) and the restored review it must restore to. */
/**
 * Rendered only by #1835 (not yet on main), so named here as the consent helper names #1835's prompt ids. These checks run
 * only on a #1835 build: without #1835, `consent.choice` is null and `reviewModeOf` is `coaching_on`, so none is reached.
 */
const PR1835_IDS = Object.freeze({ coachingOffBand: 'ai-suggestions-coaching-off' });
export const OFF_BAND: Readonly<Record<OffMode, 'ai_off' | 'save_off'>> = Object.freeze({ coaching_off_saved: 'ai_off', saving_off: 'save_off' });
export const OFF_RESTORED_REVIEW: Readonly<Record<OffMode, 'coaching_off' | 'unavailable'>> = Object.freeze({
    // Saving on, coaching off: the transcript is kept, so the band says coaching is off (never a Try again).
    coaching_off_saved: 'coaching_off',
    // Saving off: no transcript to review, so the band is terminal (never a Try again, never coaching).
    saving_off: 'unavailable',
});

/** Pure. The saved Focus status each rail status must persist as: the product saves covered OR partial as detected. */
export function expectedSavedFocus(rail: readonly (string | null)[]): (string | null)[] {
    return rail.map((s) => (s === 'covered' || s === 'partial' ? 'covered' : s === 'missing' ? 'missing' : null));
}

/** Pure. The saved Focus results shown equal the first take's rail, point for point, with every point settled. */
export function savedFocusMatches(shown: readonly (string | null)[] | null, rail: readonly (string | null)[]): boolean {
    const expected = expectedSavedFocus(rail);
    return shown !== null && expected.length > 0 && expected.every((e) => e !== null)
        && shown.length === expected.length && shown.every((s, i) => s === expected[i]);
}

// ── After Stop ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface CoachingOffObservation {
    bandShown: boolean;
    /** The band's `data-coaching-off` at the end of the settle window. */
    bandMode: string | null;
    /** Either review phrase was visible with text. */
    reviewPhrasesShown: boolean;
    /** The card's `data-review-state` at the end of the settle window. */
    reviewState: string | null;
    /** Coaching requests this run made, from the journey's start through the settle window (none is allowed while off). */
    coachingRequests: number;
    /** The saved row's `ai_suggestions`: none (null), present, or the read failed. */
    savedSuggestions: 'none' | 'present' | 'read_failed';
}

export interface OffVerdict { verdict: Verdict; reason: string; detail: string }

/** Pure. PASS only on affirmative proof that this mode requested, showed and saved no coaching. */
export function coachingOffVerdict(mode: OffMode, o: CoachingOffObservation): OffVerdict {
    const fail = (reason: string, detail: string): OffVerdict => ({ verdict: 'FAIL', reason, detail });
    if (!o.bandShown) return fail('band_missing', 'the coaching-off band was not shown after Stop');
    if (o.bandMode !== OFF_BAND[mode]) return fail('band_wrong_mode', `the coaching-off band reads ${o.bandMode ?? 'nothing'}, expected ${OFF_BAND[mode]}`);
    if (o.reviewPhrasesShown) return fail('review_shown_while_off', 'review phrases were shown while coaching is off');
    if (o.reviewState === 'loading' || o.reviewState === 'ready' || o.reviewState === 'error') {
        return fail('review_requested_state', `the review card reached ${o.reviewState}, which only a request produces`);
    }
    if (o.coachingRequests !== 0) return fail('coaching_requested_while_off', 'a coaching request was made while coaching is off');
    if (o.savedSuggestions === 'read_failed') return { verdict: 'HOLD', reason: 'saved_unreadable', detail: 'the saved row could not be read' };
    if (o.savedSuggestions === 'present') return fail('coaching_saved_while_off', 'coaching was saved on the row while coaching is off');
    return { verdict: 'PASS', reason: 'no_review_requested', detail: 'coaching is off: the band for this choice was shown, no review was requested, shown or saved' };
}

// ── Back from Progress and reload ─────────────────────────────────────────────────────────────────────────────────

export type TranscriptShown = 'matches' | 'differs' | 'not_captured' | 'missing';

export interface OffRestoredView {
    /** The restored review band's `data-retry`, after the owner's choice settled; null when no band was shown. */
    review: string | null;
    reviewPhrasesShown: boolean;
    transcript: TranscriptShown;
    /** The saved Focus results' statuses on the restored view; null when not shown. */
    focus: (string | null)[] | null;
}

export interface OffBackReloadObservation {
    leftForProgress: boolean;
    restoredAfterBack: boolean;
    liveMicTracksAfterBack: number | null;
    restoredAfterReload: boolean;
    sameSessionAfterReload: boolean;
    idleRecorderShown: boolean;
    liveMicTracks: number | null;
    afterBack: OffRestoredView | null;
    afterReload: OffRestoredView | null;
    firstTakeRail: readonly (string | null)[];
    verdictsBefore: readonly string[];
    verdictsAfter: readonly string[];
    coachingRequestsBefore: number;
    coachingRequestsAfter: number;
}

const expectedTranscript = (mode: OffMode): TranscriptShown => (mode === 'coaching_off_saved' ? 'matches' : 'not_captured');

/** Pure. The same checks as the coaching-on Back/reload verdict, with each mode's own review, transcript and results. */
export function offBackReloadVerdict(mode: OffMode, o: OffBackReloadObservation): OffVerdict {
    const fail = (reason: string, detail: string): OffVerdict => ({ verdict: 'FAIL', reason, detail });
    if (!o.leftForProgress) return fail('progress_not_opened', 'the header Progress link did not open Progress');
    if (!o.restoredAfterBack) return fail('not_restored_after_back', 'browser Back did not restore this saved session');
    if (o.idleRecorderShown) return fail('idle_recorder_shown', 'the idle recorder was shown instead of the saved session');
    if (o.liveMicTracksAfterBack !== 0) return fail('mic_live_after_back', 'a microphone was live (or unreadable) right after Back');
    if (!o.restoredAfterReload || !o.sameSessionAfterReload) return fail('not_restored_after_reload', 'a reload did not restore the same saved session');
    if (o.liveMicTracks !== 0) return fail('mic_live_after_reload', 'a microphone was live on the restored session');
    for (const [when, view] of [['Back', o.afterBack], ['the reload', o.afterReload]] as const) {
        if (!view) return fail('view_unread', `the restored view after ${when} could not be read`);
        if (view.review !== OFF_RESTORED_REVIEW[mode]) {
            return fail('review_wrong', `after ${when} the review band was ${view.review ?? 'missing'}, expected ${OFF_RESTORED_REVIEW[mode]}`);
        }
        if (view.reviewPhrasesShown) return fail('review_shown_while_off', `after ${when} review phrases were shown while coaching is off`);
        if (view.transcript !== expectedTranscript(mode)) {
            return fail('transcript_wrong', `after ${when} the transcript read ${view.transcript}, expected ${expectedTranscript(mode)}`);
        }
        if (!savedFocusMatches(view.focus, o.firstTakeRail)) return fail('focus_results_wrong', `after ${when} the saved Focus results differ from the first take's rail`);
    }
    if (o.verdictsBefore.length === 0 || o.verdictsBefore.join(',') !== o.verdictsAfter.join(',')) return fail('verdicts_changed', 'the saved point verdicts were unreadable or changed');
    if (o.coachingRequestsAfter !== o.coachingRequestsBefore) return fail('coaching_requested', 'Progress, Back or the reload requested coaching');
    return { verdict: 'PASS', reason: 'restored_read_only', detail: mode === 'coaching_off_saved'
        ? 'Progress → Back and a reload restored the same saved Focus session read-only, with its saved transcript and results, coaching off, and requested nothing'
        : 'Progress → Back and a reload restored the same saved Focus session read-only, with no transcript and its saved results, and requested nothing' };
}

// ── Analytics ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OffAnalyticsObservation {
    actionClicked: boolean;
    listed: boolean;
    detailOpened: boolean;
    transcriptBefore: TranscriptShown;
    transcriptAfterReload: TranscriptShown;
    /** The saved review's `data-review-state` before and after the reload (`none` when nothing was saved). */
    reviewBefore: string | null;
    reviewAfterReload: string | null;
    reviewPhrasesShown: boolean;
    focusBefore: (string | null)[] | null;
    focusAfterReload: (string | null)[] | null;
}

export interface OffRow { step: string; verdict: Verdict; detail: string; evidence: Record<string, string | number | boolean | null> }

/** Pure. The Analytics rows for an off mode: the same row names as coaching on where the check is mode-neutral. */
export function offAnalyticsRows(mode: OffMode, a: OffAnalyticsObservation, firstTakeRail: readonly (string | null)[]): OffRow[] {
    const want = expectedTranscript(mode);
    const reachedList = a.actionClicked && a.listed;
    const detailOk = a.detailOpened && a.transcriptBefore === want;
    const reloadOk = a.detailOpened && a.transcriptAfterReload === want;
    const noReview = a.reviewBefore === 'none' && a.reviewAfterReload === 'none' && !a.reviewPhrasesShown;
    const focusOk = savedFocusMatches(a.focusBefore, firstTakeRail) && savedFocusMatches(a.focusAfterReload, firstTakeRail);
    return [
        { step: 'Analytics action', verdict: reachedList ? 'PASS' : 'FAIL', evidence: { actionClicked: a.actionClicked, listed: a.listed },
            detail: a.actionClicked ? (a.listed ? 'the on-screen Analytics action opened Analytics and it lists this session' : 'Analytics opened but does not list this session')
                : 'the post-save Analytics action was not shown or did not open Analytics' },
        { step: 'analytics session detail', verdict: detailOk ? 'PASS' : 'FAIL', evidence: { detailOpened: a.detailOpened, transcript: a.transcriptBefore, expected: want },
            detail: !a.detailOpened ? 'the session detail did not open from its control'
                : detailOk ? (mode === 'coaching_off_saved' ? 'the session opened from its own control with the saved transcript (digest equal)'
                    : 'the session opened from its own control with no transcript, as saving is off')
                    : `the session detail transcript read ${a.transcriptBefore}, expected ${want}` },
        { step: 'reopen after reload', verdict: reloadOk ? 'PASS' : 'FAIL', evidence: { transcript: a.transcriptAfterReload, expected: want },
            detail: reloadOk ? 'after a hard reload the detail still shows the same saved state' : `after reload the detail transcript read ${a.transcriptAfterReload}, expected ${want}` },
        { step: 'Analytics shows no AI suggestions while coaching is off', verdict: noReview ? 'PASS' : 'FAIL',
            evidence: { reviewBefore: a.reviewBefore, reviewAfterReload: a.reviewAfterReload, reviewPhrasesShown: a.reviewPhrasesShown },
            detail: noReview ? 'the saved review reads none before and after reload, and no suggestion is shown'
                : 'the Analytics detail showed a review, or its saved review state was not none' },
        { step: 'analytics point detail', verdict: focusOk ? 'PASS' : 'FAIL',
            evidence: { focusBefore: a.focusBefore?.join(',') ?? null, focusAfterReload: a.focusAfterReload?.join(',') ?? null, rail: firstTakeRail.join(',') },
            detail: focusOk ? 'the saved Focus results on the detail match the first take\'s rail, before and after reload'
                : 'the saved Focus results on the detail were missing or differ from the first take\'s rail' },
    ];
}

// ── Page readers (only labels, booleans and digests leave) ────────────────────────────────────────────────────────

const digestOf = (value: unknown): string => createHash('sha256').update(String(value ?? '')).digest('hex');
const visible = (page: Page, testId: string, timeout: number) => page.getByTestId(testId).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

async function phrasesShown(page: Page): Promise<boolean> {
    for (const id of ['review-what-went-well', 'review-try-next']) {
        const loc = page.getByTestId(id);
        const n = await loc.count().catch(() => 0);
        for (let i = 0; i < n; i += 1) {
            const el = loc.nth(i);
            if (await el.isVisible().catch(() => false) && (await el.innerText().catch(() => '')).trim() !== '') return true;
        }
    }
    return false;
}

/** The saved Focus results' statuses inside `saved-focus-points`; null when it is not shown. */
export async function readSavedFocusStatuses(page: Page, timeoutMs = 45_000): Promise<(string | null)[] | null> {
    if (!(await visible(page, 'saved-focus-points', timeoutMs))) return null;
    return page.getByTestId('saved-focus-points').first().evaluate((root) => Array.from(root.querySelectorAll('li[data-testid^="focus-point-"]'))
        .filter((li) => /^focus-point-\d+$/.test(li.getAttribute('data-testid') ?? ''))
        .map((li) => li.getAttribute('data-status'))).catch(() => null);
}

/** Which transcript a view shows: the saved one (by digest), another, the "not captured" notice, or nothing. */
async function transcriptShown(page: Page, textId: string, notCapturedId: string, savedDigest: string): Promise<TranscriptShown> {
    const text = page.getByTestId(textId).first();
    const notice = page.getByTestId(notCapturedId).first();
    await text.or(notice).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
    if (await text.isVisible().catch(() => false)) {
        return savedDigest !== '' && digestOf(await text.innerText().catch(() => null)) === savedDigest ? 'matches' : 'differs';
    }
    return (await notice.isVisible().catch(() => false)) ? 'not_captured' : 'missing';
}

/** After Stop: the band, the card's state and phrases, read again at the end of a settle window. */
export async function readCoachingOffAfterStop(page: Page, settleMs = 10_000): Promise<Omit<CoachingOffObservation, 'coachingRequests' | 'savedSuggestions'>> {
    const band = page.getByTestId(PR1835_IDS.coachingOffBand);
    await band.first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(settleMs);
    const bandShown = await band.first().isVisible().catch(() => false);
    return {
        bandShown,
        bandMode: bandShown ? await band.first().getAttribute('data-coaching-off').catch(() => null) : null,
        reviewPhrasesShown: await phrasesShown(page),
        reviewState: await page.getByTestId('ai-suggestions-card').first().getAttribute('data-review-state').catch(() => null),
    };
}

/** A restored saved session (after Back or a reload): its review band once settled, phrases, transcript and Focus results. */
export async function readOffRestoredView(page: Page, savedDigest: string): Promise<OffRestoredView> {
    const band = page.getByTestId('restored-review-retry').first();
    let review: string | null = null;
    if (await band.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)) {
        const deadline = Date.now() + 20_000;
        review = await band.getAttribute('data-retry').catch(() => null);
        while (review === 'checking' && Date.now() < deadline) {
            await page.waitForTimeout(250);
            review = await band.getAttribute('data-retry').catch(() => null);
        }
    }
    return {
        review,
        reviewPhrasesShown: await phrasesShown(page),
        transcript: await transcriptShown(page, 'review-transcript', 'saved-session-return-transcript-not_captured', savedDigest),
        focus: await readSavedFocusStatuses(page),
    };
}

async function readSavedReviewState(page: Page): Promise<string | null> {
    const block = page.getByTestId('saved-review').first();
    if (!(await block.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false))) return null;
    const deadline = Date.now() + 30_000;
    let state = await block.getAttribute('data-review-state').catch(() => null);
    while (state === 'loading' && Date.now() < deadline) {
        await page.waitForTimeout(250);
        state = await block.getAttribute('data-review-state').catch(() => null);
    }
    return state;
}

/**
 * Analytics through the controls the person uses (the same path as `analyticsThroughActions`): the on-screen Analytics
 * action, this session's own control, then a reload. No direct URL navigation into the detail.
 */
export async function analyticsOffThroughActions(page: Page, sessionId: string, savedDigest: string): Promise<OffAnalyticsObservation> {
    const result: OffAnalyticsObservation = {
        actionClicked: false, listed: false, detailOpened: false, transcriptBefore: 'missing', transcriptAfterReload: 'missing',
        reviewBefore: null, reviewAfterReload: null, reviewPhrasesShown: false, focusBefore: null, focusAfterReload: null,
    };
    const action = page.getByTestId('post-save-review-session-link').or(page.getByTestId('saved-session-return-see-all')).first();
    if (!(await action.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false))) return result;
    await action.click();
    result.actionClicked = await page.waitForURL((url) => {
        const p = url.pathname.replace(/\/$/, '');
        return p === '/progress' || p === '/analytics';
    }, { timeout: 30_000 }).then(() => true).catch(() => false);
    const open = page.getByTestId(`open-session-detail-${sessionId}`).or(page.getByTestId(`open-session-detail-mobile-${sessionId}`)).first();
    result.listed = await open.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    if (!result.listed) return result;
    await open.click();
    result.detailOpened = await page.waitForURL((url) => {
        const p = url.pathname.replace(/\/$/, '');
        return p === `/progress/${sessionId}` || p === `/analytics/${sessionId}`;
    }, { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!result.detailOpened) return result;
    const read = async () => ({
        transcript: await transcriptShown(page, 'session-detail-transcript', 'session-detail-transcript-not_captured', savedDigest),
        review: await readSavedReviewState(page),
        phrases: await phrasesShown(page),
        focus: await readSavedFocusStatuses(page),
    });
    const before = await read();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const after = await read();
    return {
        ...result, transcriptBefore: before.transcript, transcriptAfterReload: after.transcript, reviewBefore: before.review,
        reviewAfterReload: after.review, reviewPhrasesShown: before.phrases || after.phrases, focusBefore: before.focus, focusAfterReload: after.focus,
    };
}
