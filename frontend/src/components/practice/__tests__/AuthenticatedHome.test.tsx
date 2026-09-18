/**
 * Design Correction Brief H-1…H-5 — the authenticated Home surface.
 *
 * The assertions that matter here are not cosmetic. Each one pins a rule whose breach is what the
 * brief was commissioned to fix:
 *   - **H-1** both product CTAs are the same signature fill at the same size; no outlined twin, because
 *     an outline beside a fill reads as "secondary or unavailable";
 *   - **H-2** the two cards are ONE component with two content sets — they may differ in exactly two
 *     rendered colours (top rule, eyebrow) and in nothing else;
 *   - **H-3** slot C carries no numbers and no em-dash placeholders: a card must not promise data this
 *     page has no source for;
 *   - **H-4** the resume band is slot B, full width on ink, above the cards — and ABSENT (not empty, not
 *     disabled) when there is nothing to resume;
 *   - **H-5** yellow is the action colour: the card CTAs count as one use, the resume CTA is the other.
 * Plus the surviving evidence rules: loading / failed / empty / present stay four distinct renderings,
 * and no missing value ever degrades to a `0`.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '../../../../tests/support/test-utils';
import { AuthenticatedHome } from '../AuthenticatedHome';
import { lastSessionView, streakLabel, type RecentSession, type PracticeStreak } from '../homeEvidence';
import { PRODUCT_NAMES } from '@/constants/productNames';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SESSION: RecentSession = {
    id: 'sess-1',
    created_at: '2026-07-20T10:00:00.000Z',
    duration: 305,
    status: 'completed',
};

function renderHome(overrides: Partial<React.ComponentProps<typeof AuthenticatedHome>> = {}) {
    const props = {
        lastSession: SESSION,
        recentLoading: false,
        recentFailed: false,
        streak: { state: 'active', count: 4, lastQualifyingDate: '2026-07-30', timezone: 'America/New_York' } as PracticeStreak,
        streakLoading: false,
        onStartFreeform: vi.fn(),
        onStartObjective: vi.fn(),
        onReviewLastSession: vi.fn(),
        onViewAnalytics: vi.fn(),
        ...overrides,
    };
    // The tokens live under `.practice-root`; the wrapper mirrors the real mount point.
    const utils = render(<div className="practice-root"><AuthenticatedHome {...props} /></div>);
    return { ...utils, props };
}

const surface = () => screen.getByTestId('practice-welcome-authed');
const cards = () => [screen.getByTestId('practice-card-freeform-card'), screen.getByTestId('practice-card-objective-card')];

describe('AuthenticatedHome — the page asks one question and offers two answers', () => {
    it('asks "what would you like to do?" and offers exactly two answers', () => {
        renderHome();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/what would you like to do\?/i);
        expect(screen.getByRole('heading', { name: new RegExp(`^${PRODUCT_NAMES.freeform}$`) })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /^Focus Points$/ })).toBeInTheDocument();
        expect(screen.getByTestId('practice-card-freeform')).toHaveAccessibleName(/start your session/i);
        expect(screen.getByTestId('practice-card-objective')).toHaveAccessibleName(/start focus points/i);
    });

    it('carries NO marketing copy — no tagline, no peach hero, no bullet pitch', () => {
        renderHome();
        const text = surface().textContent ?? '';
        expect(text).not.toMatch(/Public Impact/i);
        expect(text).not.toMatch(/Private Practice\./);
        expect(text).not.toMatch(/Ready for your next practice/i);
        expect(screen.queryByTestId('practice-support-heading')).not.toBeInTheDocument();
    });

    it('each card is eyebrow · title · ONE sentence · CTA', () => {
        renderHome();
        expect(screen.getByTestId('practice-card-freeform-sentence'))
            .toHaveTextContent('Just speak. Your transcript, fillers and pace, live.');
        expect(screen.getByTestId('practice-card-objective-sentence'))
            .toHaveTextContent('Name the points that must land, then check which ones did.');
        for (const card of cards()) {
            // Exactly one sentence-bearing paragraph per card: no second paragraph of body copy.
            expect(card.querySelectorAll('p')).toHaveLength(1);
        }
    });

    it('routes each choice to its own handler', () => {
        const { props } = renderHome();
        fireEvent.click(screen.getByTestId('practice-card-freeform'));
        expect(props.onStartFreeform).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('practice-card-objective'));
        expect(props.onStartObjective).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('home-analytics'));
        expect(props.onViewAnalytics).toHaveBeenCalledTimes(1);
    });
});

describe('H-1 / H-2 — the two products are peers', () => {
    it('CASUALTY H-1: both CTAs carry the identical signature treatment, and no outlined button exists', () => {
        const { container } = renderHome();
        const freeform = screen.getByTestId('practice-card-freeform');
        const objective = screen.getByTestId('practice-card-objective');
        expect(freeform.className).toBe(objective.className);
        for (const cta of [freeform, objective]) {
            expect(cta.className).toContain('ss-home-cta-solid');
            expect(cta.className).not.toContain('outline');
        }
        // The outlined variant is gone from the page entirely — it is what made Focus Points read as
        // secondary or unavailable.
        expect(container.querySelector('.ss-home-cta-outline')).toBeNull();
    });

    it('CASUALTY H-2: the cards differ in exactly two colours — the top rule and the eyebrow', () => {
        renderHome();
        const [openMic, focus] = cards();
        // Same component, same classes: any layout/surface divergence would be a second difference.
        expect(openMic.className).toBe(focus.className);
        expect(openMic).toHaveAttribute('data-identity', 'open-mic');
        expect(focus).toHaveAttribute('data-identity', 'focus-points');

        // Difference 1 — the 3px top rule, from the shared theme roles (never a literal).
        expect(openMic.getAttribute('style')).toMatch(/border-top:\s*3px solid var\(--brand-ink\)/);
        expect(focus.getAttribute('style')).toMatch(/border-top:\s*3px solid var\(--brand-focus-strong\)/);

        // Difference 2 — the eyebrow, in that same colour.
        expect(screen.getByTestId('practice-card-freeform-eyebrow').getAttribute('style')).toContain('var(--brand-ink)');
        expect(screen.getByTestId('practice-card-objective-eyebrow').getAttribute('style')).toContain('var(--brand-focus-strong)');

        // And nothing else: no saturated header band survives on either card (the purple flood).
        for (const card of cards()) {
            expect(card.querySelector('.ss-home-band-teal, .ss-home-band-violet')).toBeNull();
            expect(card.className).not.toMatch(/ss-home-card--(teal|violet)/);
        }
    });

    it('CASUALTY H-5: yellow is spent only on the CTAs — two card CTAs plus the resume CTA', () => {
        const { container } = renderHome();
        const solid = Array.from(container.querySelectorAll('.ss-home-cta-solid'));
        expect(solid).toHaveLength(3);
        expect(solid.map((el) => el.getAttribute('data-testid')).sort())
            .toEqual(['home-resume-cta', 'practice-card-freeform', 'practice-card-objective']);
        // The streak chip is the signature FAMILY (ground + text), not a signature fill competing
        // with an action, so it does not spend the budget.
        expect(screen.getByTestId('home-streak-chip').getAttribute('style')).toContain('var(--brand-signature-ground)');
    });
});

describe('H-3 — slot C promises no data', () => {
    it('CASUALTY: the WHAT TO EXPECT row, its tiles and its captions are gone', () => {
        renderHome();
        expect(screen.queryByText(/what to expect/i)).toBeNull();
        expect(screen.queryByText('in ~5 min')).toBeNull();
        expect(screen.queryByText('every session')).toBeNull();
        expect(screen.queryByTestId('practice-card-freeform-tiles')).toBeNull();
        expect(screen.queryByTestId('practice-card-objective-tiles')).toBeNull();
        expect(screen.queryByTestId('practice-card-freeform-tile-0')).toBeNull();
        // The labels that promised numbers this page cannot source.
        expect(screen.queryByText(/filler words/i)).toBeNull();
        expect(screen.queryByText(/vs\. previous session/i)).toBeNull();
    });

    it('CASUALTY: no number and no placeholder anywhere in the cards', () => {
        renderHome();
        for (const card of cards()) {
            const text = card.textContent ?? '';
            expect(text).not.toMatch(/\d/);        // no digits at all: nothing reads as "8/10" or "0"
            expect(text).not.toContain('—');       // no em-dash placeholder
            expect(text).not.toMatch(/\+\d+%/);
            expect(text).not.toMatch(/not enough data/i);
        }
    });

    it('Focus Points is activated — no "SOON" pill', () => {
        renderHome();
        expect(screen.queryByTestId('objective-soon-badge')).toBeNull();
        expect(within(screen.getByTestId('practice-card-objective-card')).queryByText('SOON')).toBeNull();
    });
});

describe('H-4 — the resume band is slot B', () => {
    it('renders above the cards, full width, on the flat ink ground', () => {
        renderHome();
        const band = screen.getByTestId('home-resume-band');
        expect(band.className).toContain('bg-ink');
        // G2: a ground is a flat fill — no gradient, opacity or overlay.
        expect(band.className).not.toMatch(/gradient|opacity|bg-opacity|\/\d{2}\b/);
        expect(within(band).getByTestId('home-resume-eyebrow')).toHaveTextContent(/from your last session/i);
        expect(within(band).getByTestId('home-resume-eyebrow').className).toContain('text-signature');
        // DOM order is the layout order: the band precedes the card grid.
        const grid = screen.getByTestId('practice-card-freeform-card').closest('.ss-home-grid')!;
        expect(band.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('quotes the fix VERBATIM from the last review — the same sentence the session page showed', () => {
        const fix = "Pause instead of filling the gap. You used 'um' 11 times.";
        renderHome({ lastSession: { ...SESSION, fix } });
        const headline = screen.getByTestId('home-resume-headline');
        expect(headline).toHaveTextContent(fix);
        expect(headline).toHaveAttribute('data-source', 'review-fix');
        // It is the lesson, not a restatement of it.
        expect(headline.textContent).not.toMatch(/ready to pick up/i);
    });

    it('CASUALTY: with no contract-valid review, the band falls back to the run and never apologises', () => {
        // fix null covers all three real causes: the review failed, is still being made, or the row is a
        // partial write. None of them may produce a band that announces an unavailable review.
        renderHome({ lastSession: { ...SESSION, fix: null } });
        const headline = screen.getByTestId('home-resume-headline');
        expect(headline).toHaveAttribute('data-source', 'run-facts');
        expect(headline).toHaveTextContent('Your last run is ready to pick up.');
        expect(screen.getByTestId('home-resume-cta')).toBeEnabled();
        expect(screen.getByTestId('home-resume-band').textContent ?? '').not.toMatch(/unavailable|couldn.t|failed/i);
    });

    it('states the run it can describe, and offers the review plus progress', () => {
        const { props } = renderHome();
        const band = screen.getByTestId('home-resume-band');
        expect(within(band).getByTestId('home-resume-headline')).toHaveTextContent('Your last run is ready to pick up.');
        // The meta line is the persisted date · duration — earned facts, never invented ones.
        expect(within(band).getByTestId('home-resume-meta')).toHaveTextContent('5:05');
        fireEvent.click(within(band).getByTestId('home-resume-cta'));
        expect(props.onReviewLastSession).toHaveBeenCalledTimes(1);
        fireEvent.click(within(band).getByTestId('home-resume-progress'));
        expect(props.onViewAnalytics).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: it never announces that a review is unavailable', () => {
        renderHome();
        const band = screen.getByTestId('home-resume-band');
        expect(band.textContent ?? '').not.toMatch(/unavailable|couldn.t|no review|not enough data/i);
    });

    it('CASUALTY: absent from the DOM on a first session — not empty, not disabled', () => {
        renderHome({ lastSession: null });
        expect(screen.queryByTestId('home-resume-band')).toBeNull();
        // The first-session page is a greeting and two cards, and that is a complete page.
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/pick how you want to practise/i);
        expect(screen.getByTestId('practice-card-freeform')).toBeInTheDocument();
        expect(screen.getByTestId('home-first-run')).toHaveTextContent('Your audio never leaves this browser.');
    });

    it('CASUALTY: absent while the read is in flight and after it failed — neither knows if anything can be resumed', () => {
        const { unmount } = renderHome({ recentLoading: true, lastSession: null });
        expect(screen.queryByTestId('home-resume-band')).toBeNull();
        unmount();
        renderHome({ recentFailed: true, lastSession: null });
        expect(screen.queryByTestId('home-resume-band')).toBeNull();
    });

    it('a session that cannot describe itself still gets a band, with no meta line and no dash', () => {
        renderHome({ lastSession: { id: 'x', created_at: 'nope', duration: null } as unknown as RecentSession });
        const band = screen.getByTestId('home-resume-band');
        expect(within(band).queryByTestId('home-resume-meta')).toBeNull();
        expect(band.textContent ?? '').not.toContain('—');
        expect(within(band).getByTestId('home-resume-cta')).toBeEnabled();
    });
});

describe('AuthenticatedHome — evidence, never fabrication', () => {
    /*
     * The streak is server-authoritative (get_practice_streak, #1098). The chip appears ONLY for an
     * active streak of >=2 qualifying days; every other value renders NO chip (no skeleton, no
     * placeholder). Never `0-day`, `1-day`, `Start your streak`, or `Streak unavailable`.
     */
    it('streakLabel: shows text only at count>=2, otherwise null', () => {
        const mk = (state: PracticeStreak['state'], count: number): PracticeStreak =>
            ({ state, count, lastQualifyingDate: null, timezone: 'UTC' });
        expect(streakLabel(mk('active', 2))).toBe('2-day streak');
        expect(streakLabel(mk('active', 9))).toBe('9-day streak');
        expect(streakLabel(mk('active', 1))).toBeNull();
        expect(streakLabel(mk('active', 0))).toBeNull();
        expect(streakLabel(mk('none', 0))).toBeNull();
        expect(streakLabel(mk('unavailable', 0))).toBeNull();
        expect(streakLabel(null)).toBeNull();
        expect(streakLabel(undefined)).toBeNull();
        expect(streakLabel(mk('active', 2.5))).toBeNull();
    });

    it('streak chip: rendered for an active >=2-day streak, hidden for every other state', () => {
        renderHome({ streak: { state: 'active', count: 2, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak });
        expect(screen.getByTestId('home-streak-chip')).toHaveTextContent('2-day streak');
        cleanup();
        renderHome({ streak: { state: 'active', count: 12, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak });
        expect(screen.getByTestId('home-streak-chip')).toHaveTextContent('12-day streak');

        const hidden: Array<Partial<React.ComponentProps<typeof AuthenticatedHome>>> = [
            { streak: null, streakLoading: true },
            { streak: null, streakLoading: false },
            { streak: { state: 'unavailable', count: 0, lastQualifyingDate: null, timezone: null } as PracticeStreak },
            { streak: { state: 'none', count: 0, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak },
            { streak: { state: 'active', count: 1, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak },
        ];
        for (const override of hidden) {
            cleanup();
            renderHome(override);
            expect(screen.queryByTestId('home-streak-chip')).toBeNull();
            expect(screen.queryByText(/Streak unavailable|Start your streak|0-day|1-day/)).toBeNull();
            // The cluster still leads somewhere. With a session to resume the band owns that action, so the
            // legacy corner control is deliberately absent (H-4: one action per destination).
            expect(screen.getByTestId('home-analytics')).toBeInTheDocument();
            expect(screen.queryByTestId('home-last-session')).toBeNull();
            expect(screen.getByTestId('home-resume-cta')).toBeInTheDocument();
        }
    });

    it('streak chip: when shown, exact visual contract — fill, 1px border, text, waveform colors', () => {
        renderHome({ streak: { state: 'active', count: 2, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak });
        const chip = screen.getByTestId('home-streak-chip');
        expect(chip).toHaveAttribute('data-streak-state', 'active');
        const style = chip.getAttribute('style') ?? '';
        expect(style).toContain('var(--brand-signature-ground)');
        expect(style).toMatch(/1px solid var\(--brand-signature-border\)/);
        expect(style).toContain('var(--brand-signature-text)');
        const bar = chip.querySelector('span[style*="var(--brand-signature)"]');
        expect(bar).not.toBeNull();
    });

    it('last session: composed from persisted columns only; a null duration never becomes 0:00', () => {
        const ok = lastSessionView(SESSION, { loading: false, failed: false });
        expect(ok.state).toBe('present');
        expect(ok.text).toMatch(/5:05$/);

        const noDuration = lastSessionView({ ...SESSION, duration: null } as unknown as RecentSession, { loading: false, failed: false });
        expect(noDuration.text).not.toMatch(/0:00/);
        expect(noDuration.text).not.toMatch(/\b0\b/);

        const undescribable = lastSessionView({ id: 'x', created_at: 'nope', duration: null } as unknown as RecentSession, { loading: false, failed: false });
        expect(undescribable).toMatchObject({ state: 'present', text: '—', compact: true, canReview: true });
    });

    it('loading / failed / empty / present are four distinct renderings', () => {
        // Still four mutually distinguishable states — but `present` is now distinguished by the resume
        // band OWNING the action, while the other three keep the corner control with their own wording.
        // That is the point of H-4: a session to resume is not a chip, and the three states that cannot be
        // resumed must never be mistaken for one another.
        const read = () => ({
            text: screen.getByTestId('home-last-session-secondary').textContent,
            state: screen.getByTestId('home-last-session').getAttribute('data-state'),
        });

        const { unmount: u1 } = renderHome({ recentLoading: true, lastSession: null });
        const loading = read();
        expect(screen.queryByTestId('home-resume-band'), 'mid-flight: nothing to resume yet').toBeNull();
        u1();
        const { unmount: u2 } = renderHome({ recentFailed: true, lastSession: null });
        const failed = read();
        expect(screen.queryByTestId('home-resume-band'), 'failed: we cannot know').toBeNull();
        u2();
        const { unmount: u3 } = renderHome({ lastSession: null });
        const empty = read();
        expect(screen.queryByTestId('home-resume-band'), 'first session: absent, not empty').toBeNull();
        u3();

        const seen = [loading, failed, empty];
        expect(new Set(seen.map((s) => s.state)).size).toBe(3);
        expect(new Set(seen.map((s) => s.text)).size).toBe(3);
        for (const s of seen) expect(s.text).not.toContain('—');

        // `present` is the fourth, and it reads differently from all three: the band, not the chip.
        renderHome();
        expect(screen.getByTestId('home-resume-band')).toBeInTheDocument();
        expect(screen.queryByTestId('home-last-session'), 'no duplicate action beside the band').toBeNull();
    });

    it('a FAILED read gets its own honest region and never masquerades as "no sessions"', () => {
        const { props, unmount } = renderHome({ recentFailed: true, lastSession: null });
        const err = screen.getByTestId('home-history-error');
        expect(err).toHaveTextContent(/couldn.t load your recent practice/i);
        expect(err).toHaveAttribute('role', 'status');
        expect(screen.queryByTestId('home-first-run')).toBeNull();
        expect(screen.getByTestId('home-last-session')).toBeDisabled();
        fireEvent.click(screen.getByTestId('home-last-session'));
        expect(props.onReviewLastSession).not.toHaveBeenCalled();
        unmount();

        renderHome({ lastSession: null });
        expect(screen.getByTestId('home-first-run')).toBeInTheDocument();
        expect(screen.queryByTestId('home-history-error')).toBeNull();
    });

    it('while the read is in flight, nothing claims an absence', () => {
        renderHome({ recentLoading: true, lastSession: null });
        expect(screen.getByTestId('home-last-session')).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByTestId('home-first-run')).toBeNull();
        expect(screen.queryByTestId('home-history-error')).toBeNull();
    });
});

describe('AuthenticatedHome — accessibility', () => {
    it('decorative graphics are hidden from assistive tech', () => {
        const { container } = renderHome();
        for (const icon of Array.from(container.querySelectorAll('svg'))) {
            expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('a session that cannot describe itself shows no dash at all once the band owns the action', () => {
        // The compact em-dash existed because a corner chip had to say SOMETHING. The band drops its meta
        // line instead, so there is no dash to announce — which is better than announcing one.
        renderHome({ lastSession: { id: 'x', created_at: 'nope', duration: null } as unknown as RecentSession });
        expect(screen.queryByTestId('home-last-session')).toBeNull();
        const band = screen.getByTestId('home-resume-band');
        expect(within(band).queryByTestId('home-resume-meta')).toBeNull();
        expect(band.textContent ?? '').not.toContain('—');
    });

    it('the states the band does not cover keep the corner control, each saying what it knows', () => {
        const { unmount } = renderHome({ recentFailed: true, lastSession: null });
        // Failure says so in words; it never degrades to a dash, which would claim we had looked.
        expect(screen.getByTestId('home-last-session-secondary').textContent).not.toContain('—');
        unmount();
        renderHome({ lastSession: null });
        expect(screen.getByTestId('home-last-session-secondary').textContent).toBe('No sessions yet');
    });
});

/*
 * jsdom applies no stylesheet, so asserting "the grid is single-column" against the DOM proves
 * nothing. The rules live in ONE central file, so read that file and assert the declarations.
 */
describe('AuthenticatedHome — the layout rules actually exist in practice.css', () => {
    const css = readFileSync(resolve(__dirname, '../../../styles/practice.css'), 'utf8');

    it('the card grid is single-column by default and splits only at a wide breakpoint', () => {
        expect(css).toMatch(/\.ss-home-grid\s*\{[^}]*grid-template-columns:\s*1fr;/);
        expect(css).toMatch(/@media \(min-width: 900px\)\s*\{[\s\S]{0,200}?\.ss-home-grid\s*\{\s*grid-template-columns:\s*1fr 1fr;/);
    });

    it('CTAs bottom-align via margin-top:auto on the shared class', () => {
        expect(css).toMatch(/\.ss-home-cta\s*\{[^}]*margin-top:\s*auto;/);
    });

    it('the surface clears the FIXED header from the shared --header-height token, not a magic number', () => {
        expect(css).toMatch(/\.ss-home-surface\s*\{[^}]*padding-top:\s*calc\(var\(--header-height/);
        expect(css).toMatch(/\.ss-home-anchor\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--header-height/);
    });

    it('CASUALTY: the flood-era rules are gone, not merely unused', () => {
        // Header-band gradients, per-card border colours and the outlined CTA are what H-1/H-2 removed.
        // Leaving them in the sheet invites the next card to pick them up again.
        for (const dead of [
            '--ss-home-teal-band', '--ss-home-violet-band', '--ss-home-teal-border', '--ss-home-violet-border',
            'ss-home-card--teal', 'ss-home-card--violet', 'ss-home-band-teal', 'ss-home-band-violet',
            'ss-home-cta-outline',
        ]) {
            expect(css).not.toContain(dead);
        }
    });

    it('the practice palette holds no colour values of its own', () => {
        expect(css).not.toMatch(/#(?:[0-9a-f]{3}){1,2}\b/i);
    });
});
