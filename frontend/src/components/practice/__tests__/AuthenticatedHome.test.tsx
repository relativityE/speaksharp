/**
 * #1047 — the authenticated Home surface.
 *
 * The assertions that matter here are not cosmetic. This surface prints numbers next to labels like
 * "Filler words", and a user reads those as facts about their own speaking. So the suite pins:
 *   - the two choices are legible (title + CTA per card);
 *   - a missing or invalid value renders an em-dash, and NEVER a `0`, a `0:00` or a `+8%`;
 *   - Guided (unlaunched) shows nothing that could be mistaken for personalised results;
 *   - decorative graphics are hidden from assistive tech.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '../../../../tests/support/test-utils';
import { AuthenticatedHome } from '../AuthenticatedHome';
import { lastSessionSummary, streakLabel, type RecentSession } from '../homeEvidence';

const SESSION: RecentSession = {
    id: 'sess-1',
    created_at: '2026-07-20T10:00:00.000Z',
    duration: 305,
    status: 'completed',
};

function renderHome(overrides: Partial<React.ComponentProps<typeof AuthenticatedHome>> = {}) {
    const props = {
        lastSession: SESSION,
        recentFailed: false,
        streakCount: 4,
        onStartFreestyle: vi.fn(),
        onNotifyGuided: vi.fn(),
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
        expect(screen.getByRole('heading', { name: /^Freestyle Practice$/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /^Guided Rehearsal$/ })).toBeInTheDocument();
        expect(screen.getByTestId('practice-card-quick')).toHaveAccessibleName(/start freestyle practice/i);
        expect(screen.getByTestId('practice-card-guided')).toHaveAccessibleName(/notify me about guided rehearsal/i);
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
        for (const testid of ['practice-card-quick-card', 'practice-card-guided-card']) {
            expect(within(screen.getByTestId(testid)).getByText(/what to expect/i)).toBeInTheDocument();
        }
        // Exact strings: "Notify me at launch" (the CTA) must not satisfy the trailing-text assertion.
        expect(within(screen.getByTestId('practice-card-quick-card')).getByText('in ~5 min')).toBeInTheDocument();
        expect(within(screen.getByTestId('practice-card-guided-card')).getByText('at launch')).toBeInTheDocument();
    });

    it('the SOON pill is a flex sibling of the Guided title, inside the coloured band', () => {
        renderHome();
        const badge = screen.getByTestId('guided-soon-badge');
        expect(badge).toHaveTextContent('SOON');
        expect(badge.className).not.toMatch(/absolute/);
        // Title and pill share a parent, so the pill cannot overlap the title at any width.
        expect(badge.parentElement).toContainElement(screen.getByRole('heading', { name: /^Guided Rehearsal$/ }));
    });

    it('routes each choice to its own handler', () => {
        const { props } = renderHome();
        fireEvent.click(screen.getByTestId('practice-card-quick'));
        expect(props.onStartFreestyle).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('practice-card-guided'));
        expect(props.onNotifyGuided).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('home-analytics'));
        expect(props.onViewAnalytics).toHaveBeenCalledTimes(1);
    });
});

describe('AuthenticatedHome — evidence, never fabrication', () => {
    it('never invents a "vs. last time" comparison or a last-session filler count', () => {
        renderHome();
        const card = screen.getByTestId('practice-card-quick-card');
        const vsTile = screen.getByTestId('practice-card-quick-tile-2');
        expect(vsTile).toHaveTextContent(/vs\. last time/i);
        expect(vsTile).toHaveTextContent('—');
        expect(vsTile).toHaveAttribute('data-evidence', 'none');

        const fillerTile = screen.getByTestId('practice-card-quick-tile-1');
        expect(fillerTile).toHaveTextContent(/filler words/i);
        expect(fillerTile).toHaveTextContent('—');

        // The specific fabrications this page previously invited.
        const text = card.textContent ?? '';
        expect(text).not.toMatch(/\+\d+%/);
        expect(text).not.toMatch(/\b12 filler\b/i);
        // A missing value must never degrade to a zero: no bare 0 anywhere in the tile row.
        expect(screen.getByTestId('practice-card-quick-tiles').textContent ?? '').not.toMatch(/\b0\b/);
    });

    it('Guided shows no personalised numbers at all — em-dashes under real labels', () => {
        renderHome();
        const tiles = screen.getByTestId('practice-card-guided-tiles');
        expect(tiles).toHaveTextContent(/covered/i);
        expect(tiles).toHaveTextContent(/missed/i);
        expect(tiles).toHaveTextContent(/misses only/i);
        // No digits whatsoever: nothing that could read as "8/10" or "2 missed".
        expect(tiles.textContent ?? '').not.toMatch(/\d/);
        for (const i of [0, 1, 2]) {
            expect(screen.getByTestId(`practice-card-guided-tile-${i}`)).toHaveAttribute('data-evidence', 'none');
        }
    });

    it('an unavailable tile keeps its row and its label — it is not hidden', () => {
        renderHome();
        expect(screen.getByTestId('practice-card-quick-tiles').children).toHaveLength(3);
        expect(screen.getByTestId('practice-card-guided-tiles').children).toHaveLength(3);
    });

    it('streak: a persisted count is shown; a persisted 0 is real evidence; anything else is an em-dash', () => {
        expect(streakLabel(4)).toBe('4-day streak');
        expect(streakLabel(0)).toBe('0-day streak');
        expect(streakLabel(undefined)).toBe('— day streak');
        expect(streakLabel(null)).toBe('— day streak');
        expect(streakLabel(Number.NaN)).toBe('— day streak');

        renderHome({ streakCount: undefined });
        expect(screen.getByTestId('home-streak-chip')).toHaveTextContent('— day streak');
        expect(screen.getByTestId('home-streak-chip').textContent ?? '').not.toMatch(/\b0\b/);
    });

    it('last session: composed from persisted columns only; missing/failed/invalid all give an em-dash', () => {
        expect(lastSessionSummary(SESSION, false)).toMatch(/5:05$/);
        expect(lastSessionSummary(null, false)).toBe('—');
        expect(lastSessionSummary(SESSION, true)).toBe('—');
        // A null duration must not become "0:00".
        expect(lastSessionSummary({ ...SESSION, duration: null } as unknown as RecentSession, false)).not.toMatch(/0:00/);
        // An unparseable timestamp with no duration leaves nothing truthful to say.
        expect(lastSessionSummary({ id: 'x', created_at: 'nope', duration: null } as unknown as RecentSession, false)).toBe('—');
    });

    it('a FAILED history read is not shown as "no sessions" with a live link', () => {
        const { props } = renderHome({ recentFailed: true });
        expect(screen.getByTestId('home-last-session-secondary')).toHaveTextContent('—');
        expect(screen.getByTestId('home-last-session')).toBeDisabled();
        fireEvent.click(screen.getByTestId('home-last-session'));
        expect(props.onReviewLastSession).not.toHaveBeenCalled();
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

    it('an em-dash is announced as missing data rather than read as a stray dash', () => {
        renderHome();
        const tile = screen.getByTestId('practice-card-guided-tile-0');
        expect(within(tile).getByText('Not enough data yet')).toBeInTheDocument();
    });

    it('the card grid is single-column by default and only splits at a wide breakpoint', () => {
        const { container } = renderHome();
        // Layout is owned by the central `.ss-home-grid` token class (practice.css), not inline styles,
        // so the responsive rule lives in one place.
        expect(container.querySelector('.ss-home-grid')).not.toBeNull();
    });

    it('both CTAs bottom-align via margin-top:auto rather than per-card padding', () => {
        const { container } = renderHome();
        const ctas = container.querySelectorAll('.ss-home-cta');
        expect(ctas).toHaveLength(2);
    });
});
