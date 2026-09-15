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
        expect(statusBar).toHaveClass('bg-state-success-ground');
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

        it('is bold signature text (never a green link), pulses (~6.5s), then settles to a PERSISTENT static emphasis — never indefinite', () => {
            vi.useFakeTimers();
            try {
                mockStore();
                renderRouted(<StatusNotificationBar status={{ type: 'ready', message: 'Session saved' }} analyticsAction={{ cueKey: 'sess-1' }} />);
                const action = screen.getByTestId('post-save-review-session-link');
                // #1480: font-bold signature-text on the signature-ground pill (see the WCAG contrast test below).
                expect(action.className).toMatch(/font-bold/);
                expect(action.className).toContain('text-signature-text');
                expect(action.className).not.toMatch(/emerald|green|success/);
                expect(action.className).not.toMatch(/font-semibold/);
                expect(action.className).not.toContain('text-primary');
                // Phase 1: bounded pulse.
                expect(action).toHaveAttribute('data-cue-phase', 'pulsing');
                expect(action).toHaveAttribute('data-cue-active', 'true');
                expect(action.className).toMatch(/animate-pulse/);
                // After ~6.5s: pulse ENDS, but a PERSISTENT static emphasis remains (no animation).
                act(() => { vi.advanceTimersByTime(6600); });
                expect(action).toHaveAttribute('data-cue-phase', 'persistent');
                expect(action).toHaveAttribute('data-cue-active', 'true'); // still emphasized/actionable
                expect(action.className).not.toMatch(/animate-pulse/);
                expect(action.className).toContain('bg-signature-ground');
                expect(action.className).toContain('ring-signature-border');
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

        it('reduced-motion: NEVER pulses — shows the persistent static emphasis immediately', () => {
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
                expect(action.className).toContain('bg-signature-ground');
                expect(action.className).toContain('ring-signature-border');
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
            expect(action.className).not.toContain('bg-signature-ground'); // emphasis cleared
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

    // Deterministic WCAG AA proof for the 13px Analytics label. #1480: the label is signature-text on the
    // opaque signature-ground pill, and on the plain card when the cue is cleared. Normal
    // text needs >=4.5:1. The site renders light only (no dark theme is reachable).
    describe('Analytics action colour contrast (WCAG AA, >=4.5:1)', () => {
        type RGB = [number, number, number];
        const srgb = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        const luminance = ([r, g, b]: RGB) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
        const contrast = (a: RGB, b: RGB) => {
            const la = luminance(a), lb = luminance(b);
            return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        };

        const SIGNATURE_TEXT: RGB = [138, 85, 16]; // --brand-signature-text
        const SIGNATURE_GROUND: RGB = [253, 243, 226]; // --brand-signature-ground
        const CARD_LIGHT: RGB = [255, 255, 255]; // --card light (0 0% 100%)
        const RETIRED_SUCCESS: RGB = [12, 141, 98]; // hsl(160 84% 30%)

        it('signature-text on the signature-ground pill and on the plain card is >=4.5:1', () => {
            expect(contrast(SIGNATURE_TEXT, SIGNATURE_GROUND)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(SIGNATURE_TEXT, CARD_LIGHT)).toBeGreaterThanOrEqual(4.5);
        });

        it('the retired --success green would have FAILED as 13px text on white (regression guard)', () => {
            expect(contrast(RETIRED_SUCCESS, CARD_LIGHT)).toBeLessThan(4.5);
        });
    });

});
