// @vitest-environment jsdom
/**
 * #1897 review 4 (Sam, Nov 18): with coaching off (saving on) or saving off on a #1835 build, the Focus journey's coaching,
 * Back/reload and Analytics checks expected coaching or a transcript, so they could only hold or fail. They are routed to
 * affirmative evidence (rwtCoachingOff.ts). Each control below must trip its own reason, never a setup error.
 *
 * The page readers run against a model of #1835's DOM (the testids and attributes of AISuggestions, RestoredReviewRetry,
 * SavedSessionReturn, SavedPracticeLoopReview, SavedFocusPointsCoverage and the Analytics detail) on a real jsdom document.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
    FOCUS_COACHING_OFF_ROW, analyticsOffThroughActions, coachingOffVerdict, expectedSavedFocus, offAnalyticsRows, offBackReloadVerdict,
    readCoachingOffAfterStop, readOffRestoredView, readSavedFocusStatuses, reviewModeOf, savedFocusMatches,
    type CoachingOffObservation, type OffAnalyticsObservation, type OffBackReloadObservation, type OffRestoredView,
} from '../live/helpers/rwtCoachingOff';
import { focusBackReloadVerdict } from '../live/helpers/rwtOracles';
import { CONSENT_MODES } from '../live/helpers/rwtPracticeConsent';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const TRANSCRIPT = 'first I will set the scene then the budget then the risks';
const RAIL = ['covered', 'partial', 'missing', 'covered'] as const;
const SAVED = ['covered', 'covered', 'missing', 'covered'];

// ── A minimal Playwright Page over the jsdom document ────────────────────────────────────────────────────────────

type Hook = { onWait?: () => void; onClick?: (testId: string) => void; onReload?: () => void };
const isShown = (el: Element) => !el.closest('[hidden]');

class FakeLocator {
    constructor(private readonly pick: () => Element[], private readonly hooks: Hook) {}
    private el(): Element | null { return this.pick()[0] ?? null; }
    first(): FakeLocator { return new FakeLocator(() => this.pick().slice(0, 1), this.hooks); }
    nth(i: number): FakeLocator { return new FakeLocator(() => this.pick().slice(i, i + 1), this.hooks); }
    or(other: FakeLocator): FakeLocator {
        return new FakeLocator(() => {
            const all = new Set([...this.pick(), ...(other as unknown as { pick: () => Element[] }).pick()]);
            return Array.from(document.querySelectorAll('*')).filter((e) => all.has(e));
        }, this.hooks);
    }
    async count() { return this.pick().length; }
    async isVisible() { const e = this.el(); return Boolean(e && isShown(e)); }
    async waitFor(o: { state: 'visible' }) { if (o.state === 'visible' && !(await this.isVisible())) throw new Error('timeout'); }
    async getAttribute(name: string) { const e = this.el(); if (!e) throw new Error('detached'); return e.getAttribute(name); }
    async innerText() { const e = this.el(); if (!e) throw new Error('detached'); return (e.textContent ?? '').trim(); }
    async click() { const e = this.el(); if (!e) throw new Error('detached'); this.hooks.onClick?.(e.getAttribute('data-testid') ?? ''); }
    async evaluate<R>(fn: (el: Element) => R) { const e = this.el(); if (!e) throw new Error('detached'); return fn(e); }
}

function fakePage(hooks: Hook, url: { path: string }): Page {
    return {
        getByTestId: (id: string) => new FakeLocator(() => Array.from(document.querySelectorAll(`[data-testid="${id}"]`)), hooks),
        waitForTimeout: async (ms: number) => { vi.setSystemTime(Date.now() + ms); hooks.onWait?.(); },
        waitForURL: async (pred: (u: URL) => boolean) => { if (!pred(new URL(`https://app.test${url.path}`))) throw new Error('timeout'); },
        reload: async () => { hooks.onReload?.(); },
    } as unknown as Page;
}

/** SavedFocusPointsCoverage (#1835): `saved-focus-points`, one `focus-point-${i}` li per point with data-status. */
const savedFocusHtml = (statuses: readonly string[]) => `<section data-testid="saved-focus-points"><p data-testid="saved-coverage-total">x</p><ol>${
    statuses.map((s, i) => `<li data-testid="focus-point-${i}" data-status="${s}"><p>point ${i}</p><p data-testid="focus-point-${i}-verdict">v</p></li>`).join('')}</ol></section>`;

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-18T15:00:00Z')); document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('#1897 review 4 — which review the run checks', () => {
    it('reviewModeOf: pre-#1835 coaches; #1835 follows the recorded choice; anything unknown is null', () => {
        expect(reviewModeOf({ build: 'predates_1835', choice: null })).toBe('coaching_on');
        expect(reviewModeOf({ build: 'includes_1835', choice: CONSENT_MODES.save_on_coaching_on })).toBe('coaching_on');
        expect(reviewModeOf({ build: 'includes_1835', choice: CONSENT_MODES.save_on })).toBe('coaching_off_saved');
        expect(reviewModeOf({ build: 'includes_1835', choice: CONSENT_MODES.save_off })).toBe('saving_off');
        expect(reviewModeOf({ build: 'includes_1835', choice: null })).toBeNull();
        expect(reviewModeOf({ build: 'unknown', choice: CONSENT_MODES.save_on })).toBeNull();
        expect(FOCUS_COACHING_OFF_ROW).toBe('Focus coaching off: no review requested');
    });

    it('the saved Focus results must equal the rail, partial saved as detected, every point settled', () => {
        expect(expectedSavedFocus(RAIL)).toEqual(SAVED);
        expect(expectedSavedFocus(['pending', null])).toEqual([null, null]);
        expect(savedFocusMatches(SAVED, RAIL)).toBe(true);
        expect(savedFocusMatches(['covered', 'partial', 'missing', 'covered'], RAIL)).toBe(false);
        expect(savedFocusMatches(SAVED.slice(0, 3), RAIL)).toBe(false);
        expect(savedFocusMatches(null, RAIL)).toBe(false);
        expect(savedFocusMatches([], [])).toBe(false);
        expect(savedFocusMatches(['covered'], ['pending'])).toBe(false);
    });
});

describe('#1897 review 4 — MECHANISM: the coaching-on checks could never pass with coaching off', () => {
    it('the coaching-on Back/reload verdict FAILs the correct coaching-off and saving-off product', () => {
        const ok = { leftForProgress: true, restoredAfterBack: true, liveMicTracksAfterBack: 0, restoredAfterReload: true, sameSessionAfterReload: true,
            idleRecorderShown: false, liveMicTracks: 0, coachingSaved: false, verdictsBefore: ['a:detected'], verdictsAfter: ['a:detected'],
            coachingRequestsBefore: 0, coachingRequestsAfter: 0 };
        // Coaching off: RestoredReviewRetry shows data-retry="coaching_off", which the shared reader can only call not_available.
        expect(focusBackReloadVerdict({ ...ok, transcriptMatchesSaved: true, reviewAfterBack: 'not_available', reviewAfterReload: 'not_available' }).verdict).toBe('FAIL');
        // Saving off: there is no transcript to match, by design.
        expect(focusBackReloadVerdict({ ...ok, transcriptMatchesSaved: false, reviewAfterBack: 'not_available', reviewAfterReload: 'not_available' }).verdict).toBe('FAIL');
    });
});

describe('#1897 review 4 — after Stop: no review requested, shown or saved', () => {
    const good = (mode: 'coaching_off_saved' | 'saving_off'): CoachingOffObservation => ({
        bandShown: true, bandMode: mode === 'coaching_off_saved' ? 'ai_off' : 'save_off', reviewPhrasesShown: false, reviewState: 'pending',
        coachingRequests: 0, savedSuggestions: 'none',
    });

    it('PASS on the affirmative evidence for each mode', () => {
        expect(coachingOffVerdict('coaching_off_saved', good('coaching_off_saved'))).toMatchObject({ verdict: 'PASS', reason: 'no_review_requested' });
        expect(coachingOffVerdict('saving_off', good('saving_off'))).toMatchObject({ verdict: 'PASS', reason: 'no_review_requested' });
    });

    it.each([
        ['band_missing', { bandShown: false, bandMode: null }],
        ['band_wrong_mode', { bandMode: 'save_off' }],
        ['band_wrong_mode', { bandMode: 'stopped' }],
        ['review_shown_while_off', { reviewPhrasesShown: true }],
        ['review_requested_state', { reviewState: 'ready' }],
        ['review_requested_state', { reviewState: 'loading' }],
        ['review_requested_state', { reviewState: 'error' }],
        ['coaching_requested_while_off', { coachingRequests: 1 }],
        ['coaching_saved_while_off', { savedSuggestions: 'present' }],
    ] as const)('control %s FAILs', (reason, change) => {
        expect(coachingOffVerdict('coaching_off_saved', { ...good('coaching_off_saved'), ...change })).toMatchObject({ verdict: 'FAIL', reason });
    });

    it('an unreadable saved row is HOLD, never PASS', () => {
        expect(coachingOffVerdict('saving_off', { ...good('saving_off'), savedSuggestions: 'read_failed' })).toMatchObject({ verdict: 'HOLD', reason: 'saved_unreadable' });
    });

    it('reads the band, the card state and the phrases at the end of the settle window', async () => {
        document.body.innerHTML = `<div data-testid="ai-suggestions-card" data-review-state="pending"><div data-testid="ai-suggestions-coaching-off" data-coaching-off="ai_off"><p>off</p></div></div>`;
        const page = fakePage({}, { path: '/session' });
        expect(await readCoachingOffAfterStop(page, 1_000)).toEqual({ bandShown: true, bandMode: 'ai_off', reviewPhrasesShown: false, reviewState: 'pending' });
        // Control: a review that arrived during the window (the band gone, the phrases shown) is read as such.
        const late = fakePage({ onWait: () => {
            document.body.innerHTML = `<div data-testid="ai-suggestions-card" data-review-state="ready"><h4>w</h4><p data-testid="review-what-went-well">Clear opening</p><p data-testid="review-try-next">Slow down</p></div>`;
        } }, { path: '/session' });
        const seen = await readCoachingOffAfterStop(late, 1_000);
        expect(seen).toEqual({ bandShown: false, bandMode: null, reviewPhrasesShown: true, reviewState: 'ready' });
        expect(coachingOffVerdict('coaching_off_saved', { ...seen, coachingRequests: 0, savedSuggestions: 'none' }).verdict).toBe('FAIL');
    });
});

describe('#1897 review 4 — Back from Progress and reload', () => {
    const view = (mode: 'coaching_off_saved' | 'saving_off'): OffRestoredView => ({
        review: mode === 'coaching_off_saved' ? 'coaching_off' : 'unavailable', reviewPhrasesShown: false,
        transcript: mode === 'coaching_off_saved' ? 'matches' : 'not_captured', focus: [...SAVED],
    });
    const obs = (mode: 'coaching_off_saved' | 'saving_off'): OffBackReloadObservation => ({
        leftForProgress: true, restoredAfterBack: true, liveMicTracksAfterBack: 0, restoredAfterReload: true, sameSessionAfterReload: true,
        idleRecorderShown: false, liveMicTracks: 0, afterBack: view(mode), afterReload: view(mode), firstTakeRail: RAIL,
        verdictsBefore: ['p1:detected'], verdictsAfter: ['p1:detected'], coachingRequestsBefore: 0, coachingRequestsAfter: 0,
    });

    it('PASS for each mode on its own band, transcript and saved results', () => {
        expect(offBackReloadVerdict('coaching_off_saved', obs('coaching_off_saved'))).toMatchObject({ verdict: 'PASS', reason: 'restored_read_only' });
        expect(offBackReloadVerdict('saving_off', obs('saving_off'))).toMatchObject({ verdict: 'PASS', reason: 'restored_read_only' });
    });

    it.each([
        ['progress_not_opened', { leftForProgress: false }],
        ['not_restored_after_back', { restoredAfterBack: false }],
        ['idle_recorder_shown', { idleRecorderShown: true }],
        ['mic_live_after_back', { liveMicTracksAfterBack: null }],
        ['not_restored_after_reload', { sameSessionAfterReload: false }],
        ['mic_live_after_reload', { liveMicTracks: 1 }],
        ['view_unread', { afterReload: null }],
        ['verdicts_changed', { verdictsAfter: ['p1:not_detected'] }],
        ['verdicts_changed', { verdictsBefore: [], verdictsAfter: [] }],
        ['coaching_requested', { coachingRequestsAfter: 1 }],
    ] as const)('control %s FAILs', (reason, change) => {
        expect(offBackReloadVerdict('coaching_off_saved', { ...obs('coaching_off_saved'), ...change })).toMatchObject({ verdict: 'FAIL', reason });
    });

    it.each([
        ['review_wrong', 'coaching_off_saved', { review: 'available' }],
        ['review_wrong', 'coaching_off_saved', { review: 'unavailable' }],
        ['review_wrong', 'saving_off', { review: 'coaching_off' }],
        ['review_shown_while_off', 'saving_off', { reviewPhrasesShown: true }],
        ['transcript_wrong', 'coaching_off_saved', { transcript: 'differs' }],
        ['transcript_wrong', 'saving_off', { transcript: 'matches' }],
        ['transcript_wrong', 'saving_off', { transcript: 'missing' }],
        ['focus_results_wrong', 'coaching_off_saved', { focus: ['covered', 'partial', 'missing', 'covered'] }],
        ['focus_results_wrong', 'saving_off', { focus: null }],
    ] as const)('control %s (%s) FAILs after Back and after the reload', (reason, mode, change) => {
        expect(offBackReloadVerdict(mode, { ...obs(mode), afterBack: { ...view(mode), ...change } })).toMatchObject({ verdict: 'FAIL', reason });
        expect(offBackReloadVerdict(mode, { ...obs(mode), afterReload: { ...view(mode), ...change } })).toMatchObject({ verdict: 'FAIL', reason });
    });

    it('reads the restored view once the owner\'s choice settled: band, transcript by digest, saved results only', async () => {
        const restored = (retry: string, transcript: string) => `<section data-testid="saved-session-return" data-session-id="s1">
            <section data-testid="restored-review-retry" data-retry="${retry}"><div data-testid="restored-review-coaching-off"><p>off</p></div></section>
            <div data-testid="saved-session-return-transcript">${transcript}</div>${savedFocusHtml(SAVED)}</section>
            <ol hidden><li data-testid="focus-point-0" data-status="pending"></li></ol>`;
        document.body.innerHTML = restored('checking', `<p data-testid="review-transcript">${TRANSCRIPT}</p>`);
        const page = fakePage({ onWait: () => document.querySelector('[data-testid="restored-review-retry"]')!.setAttribute('data-retry', 'coaching_off') }, { path: '/session' });
        expect(await readOffRestoredView(page, digest(TRANSCRIPT))).toEqual({ review: 'coaching_off', reviewPhrasesShown: false, transcript: 'matches', focus: SAVED });
        expect((await readOffRestoredView(page, digest('another transcript'))).transcript).toBe('differs');
        expect((await readOffRestoredView(page, '')).transcript).toBe('differs');
        document.body.innerHTML = restored('unavailable', '<p data-testid="saved-session-return-transcript-not_captured">No transcript was captured</p>');
        expect(await readOffRestoredView(page, digest(''))).toEqual({ review: 'unavailable', reviewPhrasesShown: false, transcript: 'not_captured', focus: SAVED });
        document.body.innerHTML = '<p>nothing</p>';
        expect(await readOffRestoredView(page, digest(TRANSCRIPT))).toEqual({ review: null, reviewPhrasesShown: false, transcript: 'missing', focus: null });
        // A band stuck at checking stays checking, never a mode's value.
        document.body.innerHTML = restored('checking', '');
        expect((await readOffRestoredView(fakePage({}, { path: '/session' }), '')).review).toBe('checking');
    });

    it('reads only the saved results list, never the live rail\'s rows elsewhere on the page', async () => {
        document.body.innerHTML = `<ol data-testid="focus-points-rail"><li data-testid="focus-point-0" data-status="pending"></li></ol>${savedFocusHtml(['missing', 'covered'])}`;
        expect(await readSavedFocusStatuses(fakePage({}, { path: '/x' }), 1)).toEqual(['missing', 'covered']);
        document.body.innerHTML = '<ol data-testid="focus-points-rail"><li data-testid="focus-point-0" data-status="covered"></li></ol>';
        expect(await readSavedFocusStatuses(fakePage({}, { path: '/x' }), 1)).toBeNull();
    });
});

describe('#1897 review 4 — Analytics', () => {
    const seen = (mode: 'coaching_off_saved' | 'saving_off'): OffAnalyticsObservation => ({
        actionClicked: true, listed: true, detailOpened: true,
        transcriptBefore: mode === 'coaching_off_saved' ? 'matches' : 'not_captured', transcriptAfterReload: mode === 'coaching_off_saved' ? 'matches' : 'not_captured',
        reviewBefore: 'none', reviewAfterReload: 'none', reviewPhrasesShown: false, focusBefore: [...SAVED], focusAfterReload: [...SAVED],
    });
    const verdicts = (rows: ReturnType<typeof offAnalyticsRows>) => Object.fromEntries(rows.map((r) => [r.step, r.verdict]));

    it('PASS rows for each mode, under the mode-neutral names plus the no-suggestions row', () => {
        for (const mode of ['coaching_off_saved', 'saving_off'] as const) {
            expect(verdicts(offAnalyticsRows(mode, seen(mode), RAIL))).toEqual({
                'Analytics action': 'PASS', 'analytics session detail': 'PASS', 'reopen after reload': 'PASS',
                'Analytics shows no AI suggestions while coaching is off': 'PASS', 'analytics point detail': 'PASS',
            });
        }
    });

    it.each([
        ['Analytics action', 'coaching_off_saved', { listed: false }],
        ['analytics session detail', 'coaching_off_saved', { transcriptBefore: 'differs' }],
        ['analytics session detail', 'saving_off', { transcriptBefore: 'matches' }],
        ['analytics session detail', 'saving_off', { detailOpened: false }],
        ['reopen after reload', 'coaching_off_saved', { transcriptAfterReload: 'missing' }],
        ['Analytics shows no AI suggestions while coaching is off', 'coaching_off_saved', { reviewBefore: 'review' }],
        ['Analytics shows no AI suggestions while coaching is off', 'saving_off', { reviewAfterReload: null }],
        ['Analytics shows no AI suggestions while coaching is off', 'saving_off', { reviewPhrasesShown: true }],
        ['analytics point detail', 'coaching_off_saved', { focusAfterReload: null }],
        ['analytics point detail', 'saving_off', { focusBefore: ['missing', 'covered', 'missing', 'covered'] }],
    ] as const)('control: %s FAILs (%s)', (step, mode, change) => {
        expect(verdicts(offAnalyticsRows(mode, { ...seen(mode), ...change }, RAIL))[step]).toBe('FAIL');
    });

    /** The Analytics list and detail as #1835 renders them, for one saved session. */
    function analyticsApp(opts: { transcript: string | null; review: 'none' | 'review'; listed?: boolean }) {
        const url = { path: '/session' };
        const render = () => {
            if (url.path === '/session') document.body.innerHTML = '<a data-testid="post-save-review-session-link">Analytics</a>';
            else if (url.path === '/progress') document.body.innerHTML = opts.listed === false ? '<p>empty</p>' : '<button data-testid="open-session-detail-s1">open</button>';
            else document.body.innerHTML = `<section data-testid="saved-review" data-review-state="${opts.review}">${opts.review === 'review'
                ? '<p data-testid="review-what-went-well">Clear opening</p><p data-testid="review-try-next">Slow down</p>' : '<p data-testid="saved-review-none">none</p>'}</section>
                ${opts.transcript === null ? '<div data-testid="session-detail-transcript-not_captured">No transcript was captured</div>'
                    : `<div data-testid="session-detail-transcript">${opts.transcript}</div>`}${savedFocusHtml(SAVED)}`;
        };
        let reloads = 0;
        const page = fakePage({
            onClick: (id) => { url.path = id === 'post-save-review-session-link' ? '/progress' : id === 'open-session-detail-s1' ? '/progress/s1' : url.path; render(); },
            onReload: () => { reloads += 1; render(); },
        }, url);
        render();
        return { page, reloads: () => reloads };
    }

    it('goes through the person\'s own controls and reads each mode before and after a reload', async () => {
        const kept = analyticsApp({ transcript: TRANSCRIPT, review: 'none' });
        const a = await analyticsOffThroughActions(kept.page, 's1', digest(TRANSCRIPT));
        expect(a).toEqual({ actionClicked: true, listed: true, detailOpened: true, transcriptBefore: 'matches', transcriptAfterReload: 'matches',
            reviewBefore: 'none', reviewAfterReload: 'none', reviewPhrasesShown: false, focusBefore: SAVED, focusAfterReload: SAVED });
        expect(kept.reloads()).toBe(1);
        const off = analyticsApp({ transcript: null, review: 'none' });
        const b = await analyticsOffThroughActions(off.page, 's1', digest(''));
        expect(b).toMatchObject({ transcriptBefore: 'not_captured', transcriptAfterReload: 'not_captured', reviewBefore: 'none' });
        expect(offAnalyticsRows('saving_off', b, RAIL).every((r) => r.verdict === 'PASS')).toBe(true);
        // Controls: a detail that shows a review, or a list without this session, is read as such and FAILs its row.
        const coached = await analyticsOffThroughActions(analyticsApp({ transcript: TRANSCRIPT, review: 'review' }).page, 's1', digest(TRANSCRIPT));
        expect(coached).toMatchObject({ reviewBefore: 'review', reviewPhrasesShown: true });
        expect(verdicts(offAnalyticsRows('coaching_off_saved', coached, RAIL))['Analytics shows no AI suggestions while coaching is off']).toBe('FAIL');
        const unlisted = await analyticsOffThroughActions(analyticsApp({ transcript: TRANSCRIPT, review: 'none', listed: false }).page, 's1', digest(TRANSCRIPT));
        expect(unlisted).toMatchObject({ actionClicked: true, listed: false, detailOpened: false });
        document.body.innerHTML = '';
        const none = await analyticsOffThroughActions(fakePage({}, { path: '/session' }), 's1', digest(TRANSCRIPT));
        expect(none.actionClicked).toBe(false);
    });
});
