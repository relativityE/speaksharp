import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render as rtlRender } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, within, fireEvent } from '../../../../tests/support/test-utils';
import PracticePage from '@/pages/PracticePage';
import { LandingPricingSection } from '../LandingPricingSection';

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

const proCheckout = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/services/proCheckout', () => ({ startProCheckout: proCheckout.start }));

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

    it('payments ENABLED: the paid control is a signup link, not a checkout button, and its view is governed', () => {
        paymentsEnabled.mockReturnValue(true);
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        // This page is signed-out only. A checkout button here would invoke an authenticated Edge Function as an
        // anonymous visitor, which is the #1487 P1: an error where the visitor expected checkout.
        expect(within(pricing).queryByRole('button', { name: 'Continue for $10/month' })).toBeNull();
        const cta = within(pricing).getByRole('link', { name: 'Continue for $10/month' });
        expect(cta.getAttribute('href')).toBe('/auth/signup');
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

/**
 * #1487 P1 casualty. The landing page is signed-out only, but its paid control called `startProCheckout`, which
 * emits `checkout_started` and invokes the AUTHENTICATED `stripe-checkout` Edge Function. An anonymous visitor
 * therefore got an error where they expected checkout. These assertions fail if that path is ever restored.
 *
 * Rendered with a real router rather than the shared helper, because the point is the navigation OUTCOME: the
 * post-auth return destination travels in `location.state`, which no `href` assertion can observe.
 */
describe('#1487 P1 casualty — the signed-out paid CTA reaches signup and makes no Stripe request', () => {
    const StateEcho = () => {
        const location = useLocation();
        return <pre data-testid="signup-state">{JSON.stringify(location.state)}</pre>;
    };

    const clickPaidCta = () => {
        paymentsEnabled.mockReturnValue(true);
        rtlRender(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<LandingPricingSection />} />
                    <Route path="/auth/signup" element={<StateEcho />} />
                </Routes>
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByTestId('landing-pro-continue'));
    };

    it('lands on signup carrying /pricing as the post-auth return destination', () => {
        clickPaidCta();
        // Actually navigated: the signup route rendered.
        const echoed = screen.getByTestId('signup-state').textContent ?? '';
        expect(JSON.parse(echoed)).toEqual({ from: { pathname: '/pricing' } });
    });

    it('makes no Stripe request and emits no checkout_started while signed out', () => {
        clickPaidCta();
        expect(proCheckout.start).not.toHaveBeenCalled();
        expect(funnel.checkout).not.toHaveBeenCalled();
    });

    it('still attributes the click to pricing_pro_card', () => {
        clickPaidCta();
        expect(funnel.clicked).toHaveBeenCalledWith({ source: 'pricing_pro_card', plan: 'pro' });
    });
});

/**
 * #1487 P2 casualty — heading hierarchy on the signed-out landing page.
 *
 * The Products section is drawn without a visible title, and its product cards are `h3`s. With no level-two
 * heading the document jumped h1 -> h3, so assistive technology could not place the cards in the outline. The
 * fix is a visually hidden `h2`, which is why these assertions check the heading TREE and not the pixels.
 */
describe('#1487 P2 casualty — signed-out landing heading hierarchy', () => {
    const outline = () =>
        Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
            level: Number(h.tagName.slice(1)),
            text: (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        }));

    it('has exactly one h1 and it is the first heading', () => {
        render(<PracticePage />);
        const headings = outline();
        expect(headings.filter((h) => h.level === 1)).toHaveLength(1);
        expect(headings[0].level, `first heading was h${headings[0]?.level}: ${JSON.stringify(headings)}`).toBe(1);
    });

    it('skips no heading level anywhere on the page', () => {
        render(<PracticePage />);
        const headings = outline();
        const skips = headings
            .map((h, i) => ({ from: headings[i - 1]?.level ?? h.level, to: h.level, text: h.text }))
            .filter((step) => step.to > step.from + 1);
        expect(skips, `heading levels skip a level\noutline: ${JSON.stringify(headings, null, 2)}`).toEqual([]);
    });

    it('gives the Products section a level-two heading before its product h3s', () => {
        render(<PracticePage />);
        const products = region(/^products$/i);
        const headings = Array.from(products.querySelectorAll('h1,h2,h3,h4,h5,h6'));
        expect(headings.length).toBeGreaterThan(0);
        // The section's own heading comes first, and it is h2 — not an h3 sitting directly under the page h1.
        expect(headings[0].tagName).toBe('H2');
        expect(within(products).getAllByRole('heading', { level: 3 }).length).toBe(2);
    });

    it('keeps that heading out of the visual design while leaving it in the accessibility tree', () => {
        render(<PracticePage />);
        const h2 = region(/^products$/i).querySelector('h2');
        expect(h2).not.toBeNull();
        // Visually hidden, NOT display:none or aria-hidden: those would remove it from the outline it exists to fix.
        expect(h2!.className).toContain('sr-only');
        expect(h2!.getAttribute('aria-hidden')).toBeNull();
        expect(h2!.textContent).toBe('Products');
    });
});
