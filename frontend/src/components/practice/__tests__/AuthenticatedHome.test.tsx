/**
 * #1047 — the authenticated Home surface.
 *
 * The assertions that matter here are not cosmetic. This surface prints numbers next to labels like
 * "Filler words", and a user reads those as facts about their own speaking. So the suite pins:
 *   - the two choices are legible (title + CTA per card);
 *   - a missing or invalid value renders an em-dash, and NEVER a `0`, a `0:00` or a `+8%`;
 *   - Objective (unlaunched) shows nothing that could be mistaken for personalised results;
 *   - decorative graphics are hidden from assistive tech.
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
        onNotifyObjective: vi.fn(),
        onReviewLastSession: vi.fn(),
        onViewAnalytics: vi.fn(),
        ...overrides,
    };
    // The tokens live under `.practice-root`; the wrapper mirrors the real mount point.
    const utils = render(<div className="practice-root"><AuthenticatedHome {...props} /></div>);
    return { ...utils, props };
}

const surface = () => screen.getByTestId('practice-welcome-authed');

describe('AuthenticatedHome — the page asks two questions (#1047)', () => {
    it('asks "what would you like to do?" and offers exactly two answers', () => {
        renderHome();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/what would you like to do\?/i);
        expect(screen.getByRole('heading', { name: new RegExp(`^${PRODUCT_NAMES.freeform}$`) })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /^Focus Points$/ })).toBeInTheDocument();
        expect(screen.getByTestId('practice-card-freeform')).toHaveAccessibleName(/start your session/i);
        expect(screen.getByTestId('practice-card-objective')).toHaveAccessibleName(/notify me about focus points/i);
    });

    it('carries NO marketing copy — no tagline, no peach hero, no bullet pitch', () => {
        renderHome();
        const text = surface().textContent ?? '';
        expect(text).not.toMatch(/Public Impact/i);
        expect(text).not.toMatch(/Private Practice\./);
        expect(text).not.toMatch(/Ready for your next practice/i);
        expect(screen.queryByTestId('practice-support-heading')).not.toBeInTheDocument();
    });

    it('the WHAT TO EXPECT eyebrow is the shared connective tissue — present on BOTH cards', () => {
        renderHome();
        for (const testid of ['practice-card-freeform-card', 'practice-card-objective-card']) {
            expect(within(screen.getByTestId(testid)).getByText(/what to expect/i)).toBeInTheDocument();
        }
        // Exact strings: "Notify me at launch" (the CTA) must not satisfy the trailing-text assertion.
        expect(within(screen.getByTestId('practice-card-freeform-card')).getByText('in ~5 min')).toBeInTheDocument();
        expect(within(screen.getByTestId('practice-card-objective-card')).getByText('at launch')).toBeInTheDocument();
    });

    it('the SOON pill is a flex sibling of the Objective title, inside the coloured band', () => {
        renderHome();
        const badge = screen.getByTestId('objective-soon-badge');
        expect(badge).toHaveTextContent('SOON');
        expect(badge.className).not.toMatch(/absolute/);
        // Title and pill share a parent, so the pill cannot overlap the title at any width.
        expect(badge.parentElement).toContainElement(screen.getByRole('heading', { name: /^Focus Points$/ }));
    });

    it('routes each choice to its own handler', () => {
        const { props } = renderHome();
        fireEvent.click(screen.getByTestId('practice-card-freeform'));
        expect(props.onStartFreeform).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('practice-card-objective'));
        expect(props.onNotifyObjective).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('home-analytics'));
        expect(props.onViewAnalytics).toHaveBeenCalledTimes(1);
    });
});

describe('AuthenticatedHome — evidence, never fabrication', () => {
    it('never invents a "vs. last time" comparison or a last-session filler count', () => {
        renderHome();
        const card = screen.getByTestId('practice-card-freeform-card');
        const vsTile = screen.getByTestId('practice-card-freeform-tile-2');
        expect(vsTile).toHaveTextContent(/vs\. last time/i);
        expect(vsTile).toHaveTextContent('—');
        expect(vsTile).toHaveAttribute('data-evidence', 'none');

        const fillerTile = screen.getByTestId('practice-card-freeform-tile-1');
        expect(fillerTile).toHaveTextContent(/filler words/i);
        expect(fillerTile).toHaveTextContent('—');

        // The specific fabrications this page previously invited.
        const text = card.textContent ?? '';
        expect(text).not.toMatch(/\+\d+%/);
        expect(text).not.toMatch(/\b12 filler\b/i);
        // A missing value must never degrade to a zero: no bare 0 anywhere in the tile row.
        expect(screen.getByTestId('practice-card-freeform-tiles').textContent ?? '').not.toMatch(/\b0\b/);
    });

    it('Objective shows no personalised numbers at all — em-dashes under real labels', () => {
        renderHome();
        const tiles = screen.getByTestId('practice-card-objective-tiles');
        expect(tiles).toHaveTextContent(/covered/i);
        expect(tiles).toHaveTextContent(/missed/i);
        expect(tiles).toHaveTextContent(/misses only/i);
        // No digits whatsoever: nothing that could read as "8/10" or "2 missed".
        expect(tiles.textContent ?? '').not.toMatch(/\d/);
        for (const i of [0, 1, 2]) {
            expect(screen.getByTestId(`practice-card-objective-tile-${i}`)).toHaveAttribute('data-evidence', 'none');
        }
    });

    it('an unavailable tile keeps its row and its label — it is not hidden', () => {
        renderHome();
        expect(screen.getByTestId('practice-card-freeform-tiles').children).toHaveLength(3);
        expect(screen.getByTestId('practice-card-objective-tiles').children).toHaveLength(3);
    });

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
        // everything below the threshold — and every non-active state — is null (chip hidden)
        expect(streakLabel(mk('active', 1))).toBeNull();
        expect(streakLabel(mk('active', 0))).toBeNull();
        expect(streakLabel(mk('none', 0))).toBeNull();
        expect(streakLabel(mk('unavailable', 0))).toBeNull();
        expect(streakLabel(null)).toBeNull();
        expect(streakLabel(undefined)).toBeNull();
        // never a fabricated fractional/non-integer count
        expect(streakLabel(mk('active', 2.5))).toBeNull();
    });

    it('streak chip: rendered for an active >=2-day streak, hidden for every other state', () => {
        // count 2 and count N both render exact text
        renderHome({ streak: { state: 'active', count: 2, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak });
        expect(screen.getByTestId('home-streak-chip')).toHaveTextContent('2-day streak');
        cleanup();
        renderHome({ streak: { state: 'active', count: 12, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak });
        expect(screen.getByTestId('home-streak-chip')).toHaveTextContent('12-day streak');

        // every hidden state — chip is ABSENT (not empty, not a placeholder)
        const hidden: Array<Partial<React.ComponentProps<typeof AuthenticatedHome>>> = [
            { streak: null, streakLoading: true },                                                                              // loading
            { streak: null, streakLoading: false },                                                                            // null/unavailable read
            { streak: { state: 'unavailable', count: 0, lastQualifyingDate: null, timezone: null } as PracticeStreak },        // unavailable
            { streak: { state: 'none', count: 0, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak },              // none/zero
            { streak: { state: 'active', count: 1, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak },            // one-day (below threshold)
        ];
        for (const override of hidden) {
            cleanup();
            renderHome(override);
            expect(screen.queryByTestId('home-streak-chip')).toBeNull();
            // nothing anywhere claims a lapsed/absent streak
            expect(screen.queryByText(/Streak unavailable|Start your streak|0-day|1-day/)).toBeNull();
            // and the continuity cluster still leads with Last session → Analytics
            expect(screen.getByTestId('home-last-session')).toBeInTheDocument();
        }
    });

    it('streak chip: when shown, exact visual contract — fill, 1px border, text, waveform colors', () => {
        renderHome({ streak: { state: 'active', count: 2, lastQualifyingDate: null, timezone: 'UTC' } as PracticeStreak });
        const chip = screen.getByTestId('home-streak-chip');
        expect(chip).toHaveAttribute('data-streak-state', 'active');
        // jsdom serialises the inline-style hexes to rgb(); assert the exact resolved colours.
        const style = chip.getAttribute('style') ?? '';
        expect(style).toContain('rgb(253, 243, 226)');           // #fdf3e2 fill
        expect(style).toMatch(/1px solid rgb\(240, 220, 184\)/); // #f0dcb8 actual 1px border
        expect(style).toContain('rgb(138, 85, 16)');             // #8a5510 text
        // waveform bars use the dedicated amber #d98a1f
        const bar = chip.querySelector('span[style*="rgb(217, 138, 31)"]');
        expect(bar).not.toBeNull();
    });

    it('"Live" blends in: categorical STATUS typography, not the 27px metric value class', () => {
        renderHome();
        const live = screen.getByText('Live');
        // the value carries the status kind, at the quiet 14px weight — NOT the large metric type
        expect(live).toHaveAttribute('data-value-kind', 'status');
        expect(live.className).toContain('text-[14px]');
        expect(live.className).not.toContain('text-[27px]');
        // a genuinely-missing value keeps the large metric slot (so an absent number reads as blank)
        const missing = screen.getAllByText('—')[0];
        expect(missing).toHaveAttribute('data-value-kind', 'missing');
        expect(missing.className).toContain('text-[27px]');
    });

    it('last session: composed from persisted columns only; a null duration never becomes 0:00', () => {
        const ok = lastSessionView(SESSION, { loading: false, failed: false });
        expect(ok.state).toBe('present');
        expect(ok.text).toMatch(/5:05$/);

        const noDuration = lastSessionView({ ...SESSION, duration: null } as unknown as RecentSession, { loading: false, failed: false });
        expect(noDuration.text).not.toMatch(/0:00/);
        expect(noDuration.text).not.toMatch(/\b0\b/);

        // A corrupt timestamp with no duration: the session exists and is reviewable, but cannot
        // describe itself — the ONLY case that legitimately renders the compact em-dash.
        const undescribable = lastSessionView({ id: 'x', created_at: 'nope', duration: null } as unknown as RecentSession, { loading: false, failed: false });
        expect(undescribable).toMatchObject({ state: 'present', text: '—', compact: true, canReview: true });
    });

    /*
     * The regression this replaces: failure and emptiness both returned an em-dash with a disabled
     * button, so `recentFailed` was behaviourally dead and the old test would have passed with the
     * prop deleted. These assert the four states are mutually DISTINGUISHABLE.
     */
    it('loading / failed / empty / present are four distinct renderings', () => {
        const read = () => ({
            text: screen.getByTestId('home-last-session-secondary').textContent,
            state: screen.getByTestId('home-last-session').getAttribute('data-state'),
        });

        const { unmount: u1 } = renderHome({ recentLoading: true, lastSession: null });
        const loading = read();
        u1();
        const { unmount: u2 } = renderHome({ recentFailed: true, lastSession: null });
        const failed = read();
        u2();
        const { unmount: u3 } = renderHome({ lastSession: null });
        const empty = read();
        u3();
        renderHome();
        const present = read();

        const seen = [loading, failed, empty, present];
        expect(new Set(seen.map((s) => s.state)).size).toBe(4);
        expect(new Set(seen.map((s) => s.text)).size).toBe(4);
        // Specifically: mid-flight and failure must not claim an absence.
        expect(loading.text).not.toContain('—');
        expect(failed.text).not.toContain('—');
        expect(empty.text).not.toContain('—');
    });

    it('a FAILED read gets its own honest region and never masquerades as "no sessions"', () => {
        const { props, unmount } = renderHome({ recentFailed: true, lastSession: null });
        const err = screen.getByTestId('home-history-error');
        expect(err).toHaveTextContent(/couldn.t load your recent practice/i);
        expect(err).toHaveAttribute('role', 'status');
        // The first-run guidance must NOT appear: we do not know that they have no sessions.
        expect(screen.queryByTestId('home-first-run')).not.toBeInTheDocument();
        expect(screen.getByTestId('home-last-session')).toBeDisabled();
        fireEvent.click(screen.getByTestId('home-last-session'));
        expect(props.onReviewLastSession).not.toHaveBeenCalled();
        unmount();

        // And the converse: a genuine empty result explains itself and shows no error.
        renderHome({ lastSession: null });
        expect(screen.getByTestId('home-first-run')).toHaveTextContent(/start your first practice/i);
        expect(screen.queryByTestId('home-history-error')).not.toBeInTheDocument();
    });

    it('while the read is in flight, nothing claims an absence', () => {
        renderHome({ recentLoading: true, lastSession: null });
        expect(screen.getByTestId('home-last-session')).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByTestId('home-first-run')).not.toBeInTheDocument();
        expect(screen.queryByTestId('home-history-error')).not.toBeInTheDocument();
    });
});

describe('AuthenticatedHome — accessibility & layout', () => {
    it('decorative graphics are hidden from assistive tech', () => {
        const { container } = renderHome();
        const motif = screen.getByTestId('home-band-motif');
        expect(motif).toHaveAttribute('aria-hidden', 'true');
        // Every SVG-ish glyph square is aria-hidden; no decorative node is exposed.
        for (const icon of Array.from(container.querySelectorAll('svg'))) {
            const hiddenAncestor = icon.closest('[aria-hidden="true"]');
            expect(hiddenAncestor).not.toBeNull();
        }
    });

    it('every em-dash is announced as missing data rather than read as a stray dash', () => {
        const { unmount } = renderHome();
        expect(within(screen.getByTestId('practice-card-objective-tile-0')).getByText('Not enough data')).toBeInTheDocument();
        unmount();

        // The one last-session case that legitimately shows a dash carries the same sentence, so a
        // screen reader never hears "Last session, dash".
        renderHome({ lastSession: { id: 'x', created_at: 'nope', duration: null } as unknown as RecentSession });
        expect(within(screen.getByTestId('home-last-session-secondary')).getByText('Not enough data')).toBeInTheDocument();
    });

    /*
     * Tile labels are the only meaning-carrier when the value is an em-dash, so a clipped
     * "Vs. last t…" over a dash is unreadable. jsdom applies no CSS, so this asserts the class
     * CONTRACT rather than measured geometry; the rendered narrow-viewport proof is the e2e spec.
     */
    it('outcome-tile labels are allowed to wrap — never truncated', () => {
        const { container } = renderHome();
        const labels = Array.from(container.querySelectorAll('[data-testid$="-tiles"] > div > span:last-child'));
        expect(labels.length).toBe(6);
        for (const label of labels) {
            expect(label.className).not.toMatch(/truncate/);
            expect(label.className).not.toMatch(/whitespace-nowrap/);
        }
    });
});

/*
 * jsdom applies no stylesheet, so asserting "the grid is single-column" against the DOM proves
 * nothing — the previous versions of these two tests passed whether or not the rules existed. The
 * rules live in ONE central file, so read that file and assert the declarations themselves.
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

    it('both band gradients use stops that clear AA against white eyebrow text', () => {
        // The bands carry 11px bold WHITE eyebrows, so BOTH stops must clear 4.5:1 against white.
        // The rejected light stops were #17a99b (2.89:1) and #9d7cf0 (3.19:1); the shipped ramps end
        // on #0d7d74 (4.99:1) and #7b5ce0 (4.71:1). Assert the declarations, not the whole file —
        // the rejected values still appear in the explanatory comment and in the ANONYMOUS card vars.
        const teal = css.match(/--ss-home-teal-band:\s*([^;]+);/);
        const violet = css.match(/--ss-home-violet-band:\s*([^;]+);/);
        expect(teal?.[1]).toBe('linear-gradient(135deg, #0a5f58 0%, #0d7d74 100%)');
        expect(violet?.[1]).toBe('linear-gradient(135deg, #5c3fc4 0%, #7b5ce0 100%)');
    });

    it('the amber eyebrow uses the AA-corrected token, not the decorative amber', () => {
        // #C96608 is 3.88:1 on white and stays for non-text use (rule, waveform bar); text uses
        // #B25A05 at 4.82:1.
        expect(css).toMatch(/--ss-home-amber-eyebrow:\s*#B25A05;/i);
    });
});
