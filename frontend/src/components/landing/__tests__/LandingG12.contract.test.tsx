import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, within, fireEvent } from '../../../../tests/support/test-utils';
import PracticePage from '@/pages/PracticePage';

// #1475 — the approved G12 unauthenticated homepage. Signed-out `/` renders PracticePage's anonymous state
// (App.tsx), so that is the page under test. These are the Product Owner contract points a DOM can prove: copy,
// removals, the complete offer at every signup decision point, routing, governed conversion telemetry, and both
// payment variants. Layout and visual proof is browser evidence, not this file.

const paymentsEnabled = vi.fn(() => false);
vi.mock('@/config/appRuntimeConfig', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/config/appRuntimeConfig')>();
    return { ...actual, arePaymentsEnabled: () => paymentsEnabled() };
});

const funnel = vi.hoisted(() => ({
    viewed: vi.fn(),
    clicked: vi.fn(),
    checkout: vi.fn(),
    preview: vi.fn(),
}));
vi.mock('@/services/conversionFunnel', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/conversionFunnel')>();
    return {
        ...actual,
        trackConversionCtaViewed: funnel.viewed,
        trackConversionCtaClicked: funnel.clicked,
        trackCheckoutStarted: funnel.checkout,
        trackLandingPreviewClicked: funnel.preview,
    };
});

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => {
    const actual = await orig<typeof import('react-router-dom')>();
    return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('@/services/practiceTelemetry', () => ({
    trackPracticeEntryViewed: vi.fn(),
    trackPracticeModeSelected: vi.fn(),
    trackFreeformPracticeStarted: vi.fn(),
}));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    return { ...actual, useAuthProvider: () => ({ user: null }) };
});
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: undefined }) }));
vi.mock('@/hooks/useRecentPracticeSummary', () => ({ useRecentPracticeSummary: () => ({ data: [], isLoading: false }) }));

beforeAll(() => {
    // jsdom has neither observer; the page must still render (the waveform re-measures on resize).
    class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    Object.assign(globalThis, { IntersectionObserver: NoopObserver, ResizeObserver: NoopObserver });
});

beforeEach(() => {
    vi.clearAllMocks();
    paymentsEnabled.mockReturnValue(false);
});

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
/** Every control that takes a signed-out visitor to signup: links to the signup route, and product actions. */
const signupControls = () => [
    ...screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').startsWith('/auth/signup')),
    ...Array.from(document.querySelectorAll<HTMLElement>('[data-signup-action]')),
];

describe('#1475 G12 homepage — copy and removals', () => {
    it('hero states the approved headline, instruction and primary CTA', () => {
        render(<PracticePage />);
        expect(screen.getByRole('heading', { level: 1 }).textContent?.replace(/\s+/g, ' ').trim()).toBe('Private Practice. Public Impact!');
        expect(text()).toContain('Speak. See what to fix. Say it again.');
        const hero = screen.getByRole('region', { name: /hero/i });
        expect(within(hero).getByRole('link', { name: 'Try it out!' }).getAttribute('href')).toMatch(/^\/auth\/signup/);
    });

    it('shows the complete offer above the fold, at reading size, inside the hero', () => {
        render(<PracticePage />);
        const hero = screen.getByRole('region', { name: /hero/i });
        expect(hero.textContent?.replace(/\s+/g, ' ')).toContain('30 days free, no card. Then $10/month. Cancel any time.');
    });

    it('removes the sample-feedback CTA, its anchor, the stats dashboard, the Benefits section and the hero illustration', () => {
        render(<PracticePage />);
        expect(screen.queryByText(/see sample feedback/i)).toBeNull();
        expect(document.getElementById('see-feedback')).toBeNull();
        expect(screen.queryByTestId('hero-stats-dashboard')).toBeNull();
        expect(screen.queryByRole('region', { name: /benefit/i })).toBeNull();
        expect(screen.queryByTestId('freeform-trial-strip')).toBeNull();
    });

    it('advertises no transcript-retention count', () => {
        render(<PracticePage />);
        expect(text()).not.toMatch(/last run only|last \d+ (runs|sessions|transcripts)|newest[- ](one|two)|\b(one|two|\d+) (saved )?transcripts? (kept|retained)/i);
    });

    it('keeps Open Mic and Focus Points as the two product entries and presents the Practice Loop', () => {
        render(<PracticePage />);
        const products = screen.getByRole('region', { name: /products/i });
        expect(within(products).getByRole('heading', { name: 'Open Mic' })).toBeTruthy();
        expect(within(products).getByRole('heading', { name: 'Focus Points' })).toBeTruthy();
        const loop = screen.getByRole('region', { name: /practice loop/i });
        expect(loop.textContent?.replace(/\s+/g, ' ')).toMatch(/Speak.*Feedback.*Practice again/);
    });
});

describe('#1475 G12 homepage — every signup decision point carries the complete offer', () => {
    it.each([false, true])('payments enabled=%s: each signup control sits in a unit stating the trial and the monthly price after it', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const controls = signupControls();
        expect(controls.length).toBeGreaterThanOrEqual(5); // hero, two product entries, pricing trial card, closing CTA
        for (const control of controls) {
            const unit = control.closest('[data-signup-decision]');
            expect(unit, `signup control "${control.textContent}" has no decision unit`).not.toBeNull();
            const unitText = unit!.textContent?.replace(/\s+/g, ' ') ?? '';
            expect(unitText).toMatch(/30 days free/i);
            expect(unitText).toMatch(/then \$10\/month/i);
        }
    });

    it('the closing CTA repeats the complete offer (the #1470 defect)', () => {
        render(<PracticePage />);
        const closing = screen.getByRole('region', { name: /call to action/i });
        expect(closing.textContent?.replace(/\s+/g, ' ')).toMatch(/30 days free.*then \$10\/month/i);
        expect(within(closing).getByRole('link', { name: 'Try it out!' })).toBeTruthy();
    });
});

describe('#1475 G12 homepage — routing and governed telemetry', () => {
    it('emits governed CTA views for the hero, closing CTA and trial card, and never the retired preview click', () => {
        render(<PracticePage />);
        const sources = funnel.viewed.mock.calls.map(([ctx]) => (ctx as { source: string }).source);
        expect(sources).toEqual(expect.arrayContaining(['hero_primary', 'landing_cta', 'pricing_free_card']));
        expect(funnel.preview).not.toHaveBeenCalled();
    });

    it('a hero CTA click is attributed to hero_primary and a closing CTA click to landing_cta', () => {
        render(<PracticePage />);
        fireEvent.click(within(screen.getByRole('region', { name: /hero/i })).getByRole('link', { name: 'Try it out!' }));
        fireEvent.click(within(screen.getByRole('region', { name: /call to action/i })).getByRole('link', { name: 'Try it out!' }));
        const clickSources = funnel.clicked.mock.calls.map(([ctx]) => (ctx as { source: string }).source);
        expect(clickSources).toEqual(expect.arrayContaining(['hero_primary', 'landing_cta']));
    });

    it('product entries keep their account-access routing that preserves the product intent', () => {
        render(<PracticePage />);
        fireEvent.click(screen.getByTestId('practice-card-freeform'));
        expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session' } } });
        fireEvent.click(screen.getByTestId('practice-card-objective'));
        expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/practice' } } });
    });
});

describe('#1475 G12 homepage — pricing variants', () => {
    it('payments DISABLED: free signup stays actionable; paid continuation is a non-clickable notice with no paid-offer events', () => {
        paymentsEnabled.mockReturnValue(false);
        render(<PracticePage />);
        const pricing = screen.getByRole('region', { name: /pricing/i });
        expect(within(pricing).getByText(/paid continuation isn.t open yet/i)).toBeTruthy();
        expect(within(pricing).queryByRole('button', { name: /\$10/ })).toBeNull();
        expect(within(pricing).queryAllByRole('link').filter((a) => /\$10/.test(a.textContent ?? ''))).toHaveLength(0);
        expect(funnel.viewed.mock.calls.some(([ctx]) => (ctx as { source: string }).source === 'pricing_pro_card')).toBe(false);
        expect(funnel.checkout).not.toHaveBeenCalled();
        expect(within(pricing).queryByText(/most popular/i)).toBeNull();
    });

    it('payments ENABLED: the Pro continuation control is live and its view is governed; still no Most popular badge', () => {
        paymentsEnabled.mockReturnValue(true);
        render(<PracticePage />);
        const pricing = screen.getByRole('region', { name: /pricing/i });
        expect(within(pricing).getByRole('button', { name: /continue for \$10\/month/i })).toBeTruthy();
        expect(funnel.viewed.mock.calls.some(([ctx]) => (ctx as { source: string }).source === 'pricing_pro_card')).toBe(true);
        expect(within(pricing).queryByText(/most popular/i)).toBeNull();
    });

    it.each([false, true])('payments enabled=%s: exactly three disclosure chips, the third state-specific', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        const { unmount } = render(<PracticePage />);
        const chips = screen.getAllByTestId('offer-disclosure-chip');
        expect(chips).toHaveLength(3);
        const third = chips[2].textContent ?? '';
        unmount();
        paymentsEnabled.mockReturnValue(!enabled);
        render(<PracticePage />);
        expect(screen.getAllByTestId('offer-disclosure-chip')[2].textContent ?? '').not.toBe(third);
    });
});
