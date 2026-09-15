import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, within, fireEvent } from '../../../../tests/support/test-utils';
import PracticePage from '@/pages/PracticePage';

// #1475 — the approved G12 Rev 2 unauthenticated homepage (issue comment 5685070470). Signed-out `/` renders
// PracticePage's anonymous state (App.tsx), so that is the page under test. These are the Rev 2 acceptance checks a
// DOM can prove, plus the provisional defaults for rulings A–F posted on the issue. Layout, contrast, overflow and
// pixel-baseline proof is browser evidence, not this file.

const paymentsEnabled = vi.fn(() => false);
vi.mock('@/config/appRuntimeConfig', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/config/appRuntimeConfig')>();
    return { ...actual, arePaymentsEnabled: () => paymentsEnabled() };
});

const funnel = vi.hoisted(() => ({ viewed: vi.fn(), clicked: vi.fn(), checkout: vi.fn(), preview: vi.fn() }));
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

const browserSupport = vi.fn(() => ({ isSupported: true, error: null as string | null }));
vi.mock('@/hooks/useBrowserSupport', () => ({ useBrowserSupport: () => browserSupport() }));

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
    class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    Object.assign(globalThis, { IntersectionObserver: NoopObserver, ResizeObserver: NoopObserver });
});

beforeEach(() => {
    vi.clearAllMocks();
    paymentsEnabled.mockReturnValue(false);
    browserSupport.mockReturnValue({ isSupported: true, error: null });
});

const norm = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const region = (name: RegExp) => screen.getByRole('region', { name });
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
const signupLinks = () => screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').startsWith('/auth/signup'));
const viewedSources = () => funnel.viewed.mock.calls.map(([ctx]) => (ctx as { source: string }).source);

describe('#1475 G12 Rev 2 — hero', () => {
    it('states the repository badge, tagline, Rev 2 hero line and a real Try it out! link to signup', () => {
        render(<PracticePage />);
        const hero = region(/^hero$/i);
        expect(norm(screen.getByRole('heading', { level: 1 }))).toBe('Private Practice. Public Impact!');
        expect(norm(hero)).toContain('Complete product free for 30 days');
        expect(norm(hero)).toContain('Speak. See what to fix. Say it again. Your audio never leaves the browser.');
        const cta = within(hero).getByRole('link', { name: 'Try it out!' });
        expect(cta.getAttribute('href')).toBe('/auth/signup');
    });

    it('states both terms lines directly under the CTA', () => {
        render(<PracticePage />);
        const terms = within(region(/^hero$/i)).getByText('30 days free, no card.');
        expect(terms.nextElementSibling?.textContent).toBe('Then $10/month. Cancel any time.');
    });

    it('is a single column: no grid cell reserved where the sample dashboard used to sit', () => {
        render(<PracticePage />);
        expect(region(/^hero$/i).querySelectorAll('[class*="grid-cols"]')).toHaveLength(0);
    });
});

describe('#1475 G12 Rev 2 — removals and honesty', () => {
    it('removes the sample-feedback CTA and anchor, the stats dashboard, Benefits, the trial strip and Most popular', () => {
        render(<PracticePage />);
        expect(screen.queryByText(/see sample feedback/i)).toBeNull();
        expect(document.getElementById('see-feedback')).toBeNull();
        expect(screen.queryByTestId('hero-stats-dashboard')).toBeNull();
        expect(screen.queryByRole('region', { name: /benefit/i })).toBeNull();
        expect(screen.queryByTestId('freeform-trial-strip')).toBeNull();
        expect(document.body.textContent).not.toMatch(/most popular/i);
    });

    it('ruling C default: advertises no transcript-retention count ("Last run only" omitted)', () => {
        render(<PracticePage />);
        expect(norm(document.body)).not.toMatch(/last run only|two most recent|one transcript is kept|last \d+ (runs|sessions|transcripts)|newest[- ](one|two)/i);
    });

    it('ruling B default: the price is stated in the hero and the closing band only, never in the product or privacy sections', () => {
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        const outside = norm(document.body).replace(norm(pricing), '');
        expect(occurrences(norm(region(/^hero$/i)), 'Then $10/month')).toBe(1);
        expect(occurrences(norm(region(/call to action/i)), 'Then $10/month')).toBe(1);
        expect(occurrences(outside, 'Then $10/month')).toBe(2);
        expect(norm(region(/^products$/i))).not.toContain('$10');
        expect(norm(region(/private, and built to repeat/i))).not.toContain('$10');
    });
});

describe('#1475 G12 Rev 2 — products and the Practice Loop', () => {
    it('keeps Open Mic and Focus Points; each entry control\'s visible label is its accessible name', () => {
        render(<PracticePage />);
        const products = region(/^products$/i);
        expect(within(products).getByRole('heading', { name: 'Open Mic' })).toBeTruthy();
        expect(within(products).getByRole('heading', { name: 'Focus Points' })).toBeTruthy();
        for (const [testid, label] of [['practice-card-freeform', 'Start Open Mic'], ['practice-card-objective', 'Start Focus Points']]) {
            const control = screen.getByTestId(testid);
            expect(control.tagName).toBe('BUTTON');
            expect(control.textContent).toBe(label);
            expect(control).toHaveAccessibleName(label);
            expect(control.hasAttribute('aria-label')).toBe(false);
        }
    });

    it('ruling A1 default: product entries keep the account-access routing that preserves the product intent', () => {
        render(<PracticePage />);
        fireEvent.click(screen.getByTestId('practice-card-freeform'));
        expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session' } } });
        fireEvent.click(screen.getByTestId('practice-card-objective'));
        expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/practice' } } });
    });

    it('presents "Private, and built to repeat" with Never uploaded and the ink Practice Loop', () => {
        render(<PracticePage />);
        const section = region(/private, and built to repeat/i);
        expect(within(section).getByRole('heading', { name: 'Never uploaded' })).toBeTruthy();
        const loop = within(section).getByRole('region', { name: 'The Practice Loop' });
        expect(norm(loop)).toMatch(/Same loop in Open Mic and Focus Points\..*Speak.*Feedback.*Practice again/);
    });
});

describe('#1475 G12 Rev 2 — signup decision points, routing and telemetry', () => {
    it.each([false, true])('payments enabled=%s: every signup link sits in a unit that states the trial and the price', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const links = signupLinks();
        expect(links.length).toBeGreaterThanOrEqual(3); // hero, pricing trial card, closing band
        for (const link of links) {
            const unit = link.closest('[data-signup-decision]');
            expect(unit, `signup link "${link.textContent}" has no decision unit`).not.toBeNull();
            expect(norm(unit)).toMatch(/30 days/i);
            expect(norm(unit)).toMatch(/\$10\/month/);
        }
    });

    it('emits the governed views for hero, closing band and trial card, and never the retired preview click', () => {
        render(<PracticePage />);
        expect(viewedSources()).toEqual(expect.arrayContaining(['hero_primary', 'landing_cta', 'pricing_free_card']));
        expect(funnel.preview).not.toHaveBeenCalled();
    });

    it('hero and closing clicks keep their conversion sources', () => {
        render(<PracticePage />);
        fireEvent.click(within(region(/^hero$/i)).getByRole('link', { name: 'Try it out!' }));
        fireEvent.click(within(region(/call to action/i)).getByRole('link', { name: 'Try it out!' }));
        const sources = funnel.clicked.mock.calls.map(([ctx]) => (ctx as { source: string }).source);
        expect(sources).toEqual(expect.arrayContaining(['hero_primary', 'landing_cta']));
    });
});

describe('#1475 G12 Rev 2 — pricing (both payment states)', () => {
    it('renders the repository tier copy, heading and intro verbatim, with no badge', () => {
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        expect(within(pricing).getByRole('heading', { name: 'One product. Free for 30 days.' })).toBeTruthy();
        expect(within(pricing).getByRole('heading', { name: 'Free trial' })).toBeTruthy();
        expect(within(pricing).getByRole('heading', { name: 'Pro' })).toBeTruthy();
        expect(norm(pricing)).toContain('first 30 days · no card required');
        expect(norm(pricing)).toContain('Open Mic and Focus Points, with saved review and comparable Progress');
        expect(within(pricing).getByRole('link', { name: 'Start free' }).getAttribute('href')).toMatch(/^\/auth\/signup\?/);
    });

    it('payments DISABLED: price still shown; trial stays actionable; paid slot is a non-focusable notice; zero paid events', () => {
        paymentsEnabled.mockReturnValue(false);
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        expect(norm(pricing)).toContain('$10');
        expect(within(pricing).getByRole('link', { name: 'Start free' })).toBeTruthy();
        const notice = within(pricing).getByTestId('landing-pro-unavailable');
        expect(notice.textContent).toMatch(/paid continuation isn.t open yet/i);
        expect(['BUTTON', 'A'].includes(notice.tagName)).toBe(false);
        expect(notice.hasAttribute('tabindex')).toBe(false);
        expect(notice.hasAttribute('role')).toBe(false);
        expect(within(pricing).queryByRole('button')).toBeNull();
        expect(viewedSources()).not.toContain('pricing_pro_card');
        expect(funnel.checkout).not.toHaveBeenCalled();
    });

    it('payments ENABLED: the paid control is an enabled button and its view is governed', () => {
        paymentsEnabled.mockReturnValue(true);
        render(<PracticePage />);
        const button = within(region(/^pricing$/i)).getByRole('button', { name: 'Continue for $10/month' });
        expect(button).toBeEnabled();
        expect(viewedSources()).toContain('pricing_pro_card');
    });

    it.each([false, true])('payments enabled=%s: three chips, the first two fixed, the third state-specific', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        const { unmount } = render(<PracticePage />);
        const chips = screen.getAllByTestId('offer-disclosure-chip').map((c) => c.textContent);
        expect(chips).toHaveLength(3);
        expect(chips.slice(0, 2)).toEqual(['Private transcription keeps audio local', 'Transcript data supports SpeakSharp features']);
        unmount();
        paymentsEnabled.mockReturnValue(!enabled);
        render(<PracticePage />);
        expect(screen.getAllByTestId('offer-disclosure-chip')[2].textContent).not.toBe(chips[2]);
    });
});

describe('#1475 G12 Rev 2 — shell preserved (ruling A1 default)', () => {
    it('renders exactly one footer and no second page header', () => {
        render(<PracticePage />);
        expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
        expect(screen.queryByRole('banner')).toBeNull();
    });

    it('renders the BrowserWarning when the browser lacks a required capability', () => {
        browserSupport.mockReturnValue({ isSupported: false, error: 'Microphone access is not available in this browser.' });
        render(<PracticePage />);
        expect(norm(screen.getByTestId('practice-root'))).toContain('Microphone access is not available in this browser.');
    });
});
