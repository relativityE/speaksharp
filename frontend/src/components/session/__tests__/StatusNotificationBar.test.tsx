// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusNotificationBar } from '../StatusNotificationBar';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../../stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));

const mockStore = (overrides: Record<string, unknown> = {}) => {
    vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
        const state = { activeEngine: 'native', isListening: false, modelLoadingProgress: null, ...overrides };
        return typeof selector === 'function' ? selector(state) : state;
    });
};

const renderRouted = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('StatusNotificationBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('displays the padlock icon when active engine is private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'private',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        // Check for the padlock title or icon
        const padlock = screen.getByTitle(/Private transcription: on-device processing/i);
        expect(padlock).toBeDefined();
    });

    it('does NOT display the padlock icon when active engine is NOT private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        expect(screen.queryByTitle(/Private transcription: on-device processing/i)).toBeNull();
    });

    it('demotes the at-rest ready bar to a receding tint with no shadow, never a green alert band', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                isListening: false,
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'ready', message: 'Mic ready' }} />);

        const statusBar = screen.getByTestId('live-session-header');
        // #1047: ambient status recedes. It is a pale tinted wash with a hairline border and NO shadow —
        // it must never again share the recorder card's own white+shadow surface treatment, and it must
        // still never be the loud success alert band the original guard was written against.
        expect(statusBar).toHaveAttribute('data-quiet', 'true');
        expect(statusBar).toHaveClass('bg-[hsl(var(--session-green-soft))]');
        expect(statusBar).not.toHaveClass('surface-shadow');
        expect(statusBar).not.toHaveClass('bg-card');
        expect(statusBar).not.toHaveClass('bg-emerald-50', 'border-emerald-200');
    });

    it('keeps attention-worthy states prominent (only the at-rest states are demoted)', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = { activeEngine: 'native', isListening: false, modelLoadingProgress: null };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'error', message: 'Something went wrong' }} />);

        const statusBar = screen.getByTestId('live-session-header');
        expect(statusBar).toHaveAttribute('data-quiet', 'false');
        expect(statusBar).toHaveClass('surface-shadow');
    });

    it('replaces generic error copy with actionable recording recovery copy', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                isListening: false,
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'error', message: 'Error occurred' }} />);

        expect(screen.queryByText(/^Error occurred$/i)).toBeNull();
        expect(screen.getByText(/Recording could not start/i)).toBeDefined();
    });

    it('keeps Private download progress visible without overloading the status copy', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'downloading', message: 'Downloading private model... 35%', progress: 35 }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Downloading private model/i);
        expect(screen.queryByText(/choose Browser, or Cloud if included in your plan/i)).toBeNull();
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('Private Model');
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('35%');
    });

    it('keeps the status bar read-only for Private setup prompts', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'download-required', message: 'Private model setup required.' }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Private model required/i);
        expect(screen.getByText(/Set up the Private model in this browser/i)).toBeInTheDocument();
        expect(screen.getByText(/All audio processing remains local/i)).toBeInTheDocument();
        expect(screen.queryByTestId('status-download-model-button')).toBeNull();
    });

    it('hides the Private setup action once setup progress exists', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'download-required', message: 'Private model setup required.', progress: 100 }} />);

        expect(screen.queryByTestId('status-download-model-button')).toBeNull();
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('Complete');
    });

    it('shows Private initialized state and far-right complete progress without extra guidance copy', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'none',
                isListening: false,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'ready', message: 'Private ready. Audio stays on this device; your transcript is saved with the session.', progress: 100 }} />);

        expect(screen.getByTestId('status-message-text')).toHaveTextContent(/Private ready/i);
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('Complete');
        expect(screen.getByTestId('background-task-indicator')).toHaveTextContent('100%');
    });

    describe('post-save Analytics action (folded-in, single status bar)', () => {
        it('renders no action when analyticsAction is absent (default behaviour unchanged)', () => {
            mockStore();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved · Your transcript is ready.' }} />);
            expect(screen.queryByTestId('post-save-review-session-link')).toBeNull();
            // Still exactly one status bar.
            expect(screen.getAllByTestId('live-session-header')).toHaveLength(1);
        });

        it('labels the action exactly "Analytics" (not "Check out Analytics"/"View analytics") with an aria-hidden arrow', () => {
            mockStore();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved · Your transcript is ready.' }} analyticsAction={{}} />);
            const action = screen.getByTestId('post-save-review-session-link');
            // Accessible name is exactly "Analytics" — the arrow icon must not contribute text.
            expect(action).toHaveAccessibleName('Analytics');
            expect(action).toHaveTextContent(/^Analytics$/);
            expect(screen.queryByText(/Check out Analytics/i)).toBeNull();
            expect(screen.queryByText(/View analytics/i)).toBeNull();
            // Destination is the existing /analytics route, not a new button.
            expect(action.tagName).toBe('A');
            expect(action).toHaveAttribute('href', '/analytics');
            expect(action.querySelector('[aria-hidden="true"]')).not.toBeNull();
            // One bar only.
            expect(screen.getAllByTestId('live-session-header')).toHaveLength(1);
        });

        it('is bold + success-green, pulses (~6.5s), then settles to a PERSISTENT static green emphasis — never indefinite', () => {
            vi.useFakeTimers();
            try {
                mockStore();
                renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1' }} />);
                const action = screen.getByTestId('post-save-review-session-link');
                // Base emphasis is now font-BOLD + ACCESSIBLE success-green (was font-semibold / text-primary).
                // Text uses emerald-800 (light) / emerald-300 (dark) — both >=4.5:1 on the pale-green pill bg
                // (see the WCAG contrast test below). The subtle bg/ring stay bound to the --success var.
                expect(action.className).toMatch(/font-bold/);
                expect(action.className).toContain('text-emerald-800');
                expect(action.className).toContain('dark:text-emerald-300');
                expect(action.className).not.toMatch(/font-semibold/);
                expect(action.className).not.toContain('text-primary');
                // Phase 1: bounded pulse.
                expect(action).toHaveAttribute('data-cue-phase', 'pulsing');
                expect(action).toHaveAttribute('data-cue-active', 'true');
                expect(action.className).toMatch(/animate-pulse/);
                // After ~6.5s: pulse ENDS, but a PERSISTENT static green emphasis remains (no animation).
                act(() => { vi.advanceTimersByTime(6600); });
                expect(action).toHaveAttribute('data-cue-phase', 'persistent');
                expect(action).toHaveAttribute('data-cue-active', 'true'); // still emphasized/actionable
                expect(action.className).not.toMatch(/animate-pulse/);
                expect(action.className).toContain('bg-[hsl(var(--success)/0.1)]');
                expect(action.className).toContain('ring-[hsl(var(--success)/0.4)]');
                // It never repeats/animates again with more time.
                act(() => { vi.advanceTimersByTime(30000); });
                expect(action).toHaveAttribute('data-cue-phase', 'persistent');
                expect(action.className).not.toMatch(/animate-pulse/);
            } finally {
                vi.useRealTimers();
            }
        });

        it('cue is SESSION-SCOPED: a newly finalized session re-triggers the pulse via cueKey (no unmount)', () => {
            vi.useFakeTimers();
            try {
                mockStore();
                const { rerender } = renderRouted(
                    <StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1' }} />,
                );
                const action = () => screen.getByTestId('post-save-review-session-link');
                act(() => { vi.advanceTimersByTime(6600); });
                expect(action()).toHaveAttribute('data-cue-phase', 'persistent');
                // Second session finalized WITHOUT unmounting → cue RE-FIRES (pulses) on the new key.
                rerender(
                    <MemoryRouter>
                        <StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-2' }} />
                    </MemoryRouter>,
                );
                expect(action()).toHaveAttribute('data-cue-phase', 'pulsing');
                expect(action().className).toMatch(/animate-pulse/);
            } finally {
                vi.useRealTimers();
            }
        });

        it('reduced-motion: NEVER pulses — shows the persistent static green emphasis immediately', () => {
            const original = window.matchMedia;
            window.matchMedia = vi.fn().mockImplementation((q: string) => ({
                matches: q.includes('reduce'), media: q, onchange: null,
                addEventListener: vi.fn(), removeEventListener: vi.fn(),
                addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
            })) as unknown as typeof window.matchMedia;
            try {
                mockStore();
                renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1' }} />);
                const action = screen.getByTestId('post-save-review-session-link');
                expect(action).toHaveAttribute('data-cue-phase', 'persistent'); // immediate — no pulsing phase
                expect(action.className).not.toMatch(/animate-pulse/);
                expect(action.className).toContain('bg-[hsl(var(--success)/0.1)]');
                expect(action.className).toContain('ring-[hsl(var(--success)/0.4)]');
            } finally {
                window.matchMedia = original;
            }
        });

        it('preserves the exact label "Analytics" + aria-hidden arrow while cueing', () => {
            mockStore();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1' }} />);
            const action = screen.getByTestId('post-save-review-session-link');
            expect(action).toHaveAccessibleName('Analytics');
            expect(action.querySelector('[aria-hidden="true"]')).not.toBeNull();
        });

        it('clicking Analytics stops the cue immediately, clears the emphasis, and navigates to /analytics', () => {
            mockStore();
            const onSelect = vi.fn();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1', onSelect }} />);
            const action = screen.getByTestId('post-save-review-session-link');
            expect(action).toHaveAttribute('data-cue-active', 'true');
            expect(action).toHaveAttribute('href', '/analytics'); // navigates to the existing route
            fireEvent.click(action);
            expect(onSelect).toHaveBeenCalledTimes(1);
            expect(action).toHaveAttribute('data-cue-phase', 'idle');
            expect(action).toHaveAttribute('data-cue-active', 'false');
            expect(action.className).not.toMatch(/animate-pulse/);
            expect(action.className).not.toContain('bg-[hsl(var(--success)/0.1)]'); // emphasis cleared
        });

        // Timer-race guard: a click DURING the pulse must cancel the pending pulse→persistent timer so the
        // cue cannot resurrect itself ~6.5s later. Covers ordinary, cmd/ctrl (open-in-bg), and middle click.
        describe('dismissing during the pulse never reactivates the cue (stale-timer guard)', () => {
            const dismissers: Array<[string, (el: HTMLElement) => void]> = [
                ['ordinary click', (el) => fireEvent.click(el)],
                ['ctrl-click', (el) => fireEvent.click(el, { ctrlKey: true })],
                ['cmd-click', (el) => fireEvent.click(el, { metaKey: true })],
                ['middle-click', (el) => fireEvent(el, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))],
            ];
            for (const [name, dismiss] of dismissers) {
                it(`${name} while pulsing → stays idle even after the 6.5s timer would have fired`, () => {
                    vi.useFakeTimers();
                    try {
                        mockStore();
                        renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1' }} />);
                        const action = screen.getByTestId('post-save-review-session-link');
                        // Mid-pulse (before 6.5s).
                        act(() => { vi.advanceTimersByTime(1000); });
                        expect(action).toHaveAttribute('data-cue-phase', 'pulsing');
                        // Dismiss the cue.
                        act(() => { dismiss(action); });
                        expect(action).toHaveAttribute('data-cue-phase', 'idle');
                        // Let the ORIGINAL 6.5s timer's moment (and well beyond) pass — it must NOT resurrect it.
                        act(() => { vi.advanceTimersByTime(10000); });
                        expect(action).toHaveAttribute('data-cue-phase', 'idle');
                        expect(action).toHaveAttribute('data-cue-active', 'false');
                        expect(action.className).not.toMatch(/animate-pulse/);
                    } finally {
                        vi.useRealTimers();
                    }
                });
            }
        });
    });

    // Deterministic WCAG AA proof for the 13px Analytics label. The label text is emerald-800 (light) /
    // emerald-300 (dark); its pill background is the --success green at 10% composited over --card. Normal
    // text needs >=4.5:1. (The prior --success green measured ~3.7:1 on this bg and is intentionally gone.)
    describe('Analytics action colour contrast (WCAG AA, >=4.5:1)', () => {
        type RGB = [number, number, number];
        const srgb = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        const luminance = ([r, g, b]: RGB) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
        const contrast = (a: RGB, b: RGB) => {
            const la = luminance(a), lb = luminance(b);
            return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        };
        // fg over bg at the given alpha → resulting opaque colour.
        const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
            [0, 1, 2].map((i) => Math.round(alpha * fg[i] + (1 - alpha) * bg[i])) as RGB;

        const SUCCESS: RGB = [12, 141, 98]; // hsl(160 84% 30%) — the pill bg/ring tint (both themes)
        const CARD_LIGHT: RGB = [255, 255, 255]; // --card light (0 0% 100%)
        const CARD_DARK: RGB = [18, 24, 38]; // --card dark (222 35% 11%)
        const EMERALD_800: RGB = [6, 95, 70]; // light text
        const EMERALD_300: RGB = [110, 231, 183]; // dark text

        it('light theme: emerald-800 on the pale-green pill is >=4.5:1', () => {
            const bg = over(SUCCESS, 0.1, CARD_LIGHT); // bg-[hsl(var(--success)/0.1)] over the white card
            expect(contrast(EMERALD_800, bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(EMERALD_800, CARD_LIGHT)).toBeGreaterThanOrEqual(4.5); // also on plain card
        });

        it('dark theme: emerald-300 on the pale-green pill is >=4.5:1', () => {
            const bg = over(SUCCESS, 0.1, CARD_DARK);
            expect(contrast(EMERALD_300, bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(EMERALD_300, CARD_DARK)).toBeGreaterThanOrEqual(4.5);
        });

        it('the retired --success green (12,141,98) would have FAILED on this bg (regression guard)', () => {
            const bg = over(SUCCESS, 0.1, CARD_LIGHT);
            expect(contrast(SUCCESS, bg)).toBeLessThan(4.5); // ~3.7:1 — why we moved off it
        });
    });

    describe('quiet Private CTA (folded into the one bar)', () => {
        it('renders the exact existing copy and calls onSelect (setMode) on click', () => {
            mockStore();
            const onSelect = vi.fn();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} privateCta={{ onSelect }} />);
            const cta = screen.getByTestId('post-save-private-cta');
            expect(cta).toHaveTextContent('Try Private — the main beta experience');
            fireEvent.click(cta);
            expect(onSelect).toHaveBeenCalledTimes(1);
        });

        it('is absent when not provided (Private sessions / ineligible users)', () => {
            mockStore();
            renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 's1' }} />);
            expect(screen.queryByTestId('post-save-private-cta')).toBeNull();
        });

        it('keeps Analytics rightmost and renders exactly ONE Analytics action alongside the CTA', () => {
            mockStore();
            renderRouted(
                <StatusNotificationBar
                    status={{ type: 'ready', message: 'Session saved' }}
                    analyticsAction={{ cueKey: 's1' }}
                    privateCta={{ onSelect: vi.fn() }}
                />,
            );
            // Never two Analytics actions in a rendered state.
            const analytics = screen.getAllByTestId('post-save-review-session-link');
            expect(analytics).toHaveLength(1);
            const cta = screen.getByTestId('post-save-private-cta');
            // Analytics comes AFTER the Private CTA in DOM order (rightmost in the flex row).
            expect(cta.compareDocumentPosition(analytics[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });
    });
});
