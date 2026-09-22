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
    it('states the tagline, hero line and a real Start your session link to signup — and no badge (G17 L1)', () => {
        render(<PracticePage />);
        const hero = region(/^hero$/i);
        expect(norm(screen.getByRole('heading', { level: 1 }))).toBe('Private Practice. Public Impact!');
        expect(norm(hero)).not.toContain('Complete product free for 30 days');
        expect(norm(hero)).toContain('Speak. See what to fix. Say it again. Your audio never leaves the browser.');
        const cta = within(hero).getByRole('link', { name: 'Start your session' });
        expect(cta.getAttribute('href')).toBe('/auth/signup');
    });

    it('G17 L1: ONE terms line beside the CTA pairs "Free for 30 days" with "$10/month", the price in the money role', () => {
        render(<PracticePage />);
        const hero = region(/^hero$/i);
        const terms = within(hero).getByTestId('hero-terms');
        expect(norm(terms)).toBe('Free for 30 days, $10/month after.');
        const price = within(terms).getByText('$10/month');
        expect(price.className).toMatch(/text-money-on-ink/);
        expect(price.className).toMatch(/font-extrabold/);
        // Beside the CTA: the terms line and the CTA share one row container.
        expect(terms.parentElement).toContainElement(within(hero).getByRole('link', { name: 'Start your session' }));
        expect(occurrences(norm(hero), '30 days')).toBe(1);
        expect(occurrences(norm(hero), '$10')).toBe(1);
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

    // G17 L1 — supersedes ruling B / #1470's closing-band requirement (PO + PM accepted, 2026-09-19): the terms are
    // stated exactly twice — the hero line and the pricing block — and the closing band makes NO trial claim and
    // states NO price, so #1470's rule (no trial claim without its post-trial price) still holds everywhere.
    it.each([false, true])('payments enabled=%s: G17 L1 — terms only in the hero line and the pricing block; closing band has neither', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        const outside = norm(document.body).replace(norm(pricing), '');
        expect(occurrences(outside, '$10')).toBe(1);
        expect(outside.match(/30 day/gi) ?? []).toHaveLength(1);
        const closing = norm(region(/call to action/i));
        expect(closing).not.toMatch(/30 day/i);
        expect(closing).not.toContain('$10');
        expect(closing).not.toMatch(/\bfree\b|trial/i);
        expect(norm(region(/^products$/i))).not.toContain('$10');
        expect(norm(region(/private, and built to repeat/i))).not.toContain('$10');
    });

    it.each([false, true])('payments enabled=%s: G17 L2 — "no card" appears nowhere on the route', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        expect(norm(document.body)).not.toMatch(/no card/i);
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
    // #1470's rule, in its G17 shape: a decision unit that makes a trial claim states the post-trial price with it;
    // the closing band's unit makes no claim at all.
    it.each([false, true])('payments enabled=%s: no signup unit claims the trial without the price; the closing unit claims neither', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const links = signupLinks();
        expect(links.length).toBeGreaterThanOrEqual(3); // hero, pricing trial card, closing band
        const units = links.map((link) => link.closest('[data-signup-decision]'));
        expect(units.every(Boolean), 'every signup link sits in a decision unit').toBe(true);
        const claimsTrialWithoutPrice = units
            .map((unit) => norm(unit))
            .filter((text) => /30 day/i.test(text) && !/\$10\/month/.test(text));
        expect(claimsTrialWithoutPrice).toEqual([]);
        expect(norm(within(region(/^hero$/i)).getByTestId('hero-terms'))).toMatch(/30 days.*\$10\/month/);
        expect(norm(region(/call to action/i))).not.toMatch(/30 day|\$10/i);
    });

    it.each([false, true])('payments enabled=%s: G17 L5 — ONE trial-CTA label across the route', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const trialLinks = signupLinks().filter((a) => a.getAttribute('data-testid') !== 'landing-pro-continue');
        expect(trialLinks).toHaveLength(3); // hero, pricing trial card, closing band
        for (const link of trialLinks) expect(link).toHaveAccessibleName('Start your session');
        expect(norm(document.body)).not.toMatch(/Try it out!|Start free\b/);
    });

    it('emits the governed views for hero, closing band and trial card, and never the retired preview click', () => {
        render(<PracticePage />);
        expect(viewedSources()).toEqual(expect.arrayContaining(['hero_primary', 'landing_cta', 'pricing_free_card']));
        expect(funnel.preview).not.toHaveBeenCalled();
    });

    it('hero and closing clicks keep their conversion sources', () => {
        render(<PracticePage />);
        fireEvent.click(within(region(/^hero$/i)).getByRole('link', { name: 'Start your session' }));
        fireEvent.click(within(region(/call to action/i)).getByRole('link', { name: 'Start your session' }));
        const sources = funnel.clicked.mock.calls.map(([ctx]) => (ctx as { source: string }).source);
        expect(sources).toEqual(expect.arrayContaining(['hero_primary', 'landing_cta']));
    });
});

describe('#1475 G12 Rev 2 — pricing (both payment states)', () => {
    it('G17 L4: the landing pricing copy — heading Pricing, the one-product sub-line, card labels — with no badge', () => {
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        const heading = within(pricing).getByRole('heading', { level: 2 });
        expect(norm(heading)).toBe('Pricing');
        expect(norm(heading)).not.toMatch(/[0-9$]/); // L4 check: the heading restates no offer
        expect(norm(pricing)).toContain('The trial is the complete product. Nothing is held back.');
        expect(norm(pricing)).not.toContain('One product. Free for 30 days.');
        const trial = within(pricing).getByRole('heading', { name: 'Free trial' }).closest('article') as HTMLElement;
        const pro = within(pricing).getByRole('heading', { name: 'Pro' }).closest('article') as HTMLElement;
        expect(norm(trial)).toContain('First 30 days');
        expect(norm(trial)).toContain('$0');
        expect(norm(pro)).toContain('Per month, after trial');
        expect(norm(pro)).toContain('$10/month');
        expect(norm(pro)).toContain('Cancel any time'); // moved here from the hero
        expect(within(trial).getByRole('link', { name: 'Start your session' }).getAttribute('href')).toMatch(/^\/auth\/signup\?/);
        expect(norm(pricing)).not.toMatch(/most popular/i);
    });

    it.each([false, true])('payments enabled=%s: G17 equal borders — both cards 1px neutral-border, no signature border', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const cards = Array.from(region(/^pricing$/i).querySelectorAll('article'));
        expect(cards).toHaveLength(2);
        const borderClasses = cards.map((card) => card.className.split(/\s+/).filter((c) => c.startsWith('border')).sort());
        expect(borderClasses).toEqual([['border', 'border-neutral-border'], ['border', 'border-neutral-border']]);
    });

    it.each([false, true])('payments enabled=%s: G17 equal marks — every list mark in both cards is the one neutral mark', (enabled) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const marks = Array.from(region(/^pricing$/i).querySelectorAll('article li svg'));
        expect(marks.length).toBeGreaterThanOrEqual(6); // 3 per card
        const colours = new Set(marks.map((mark) => mark.getAttribute('class')?.split(/\s+/).filter((c) => c.startsWith('text-')).join(' ')));
        expect([...colours]).toEqual(['text-neutral-muted']);
    });

    it('payments DISABLED (G17 L3): price shown; the trial CTA is the ONLY control; the paid slot is a plain line; zero paid events', () => {
        paymentsEnabled.mockReturnValue(false);
        render(<PracticePage />);
        const pricing = region(/^pricing$/i);
        expect(norm(pricing)).toContain('$10');
        const controls = pricing.querySelectorAll('a, button, [role="button"], [tabindex]');
        expect(controls).toHaveLength(1);
        expect(controls[0]).toHaveAccessibleName('Start your session');
        const notice = within(pricing).getByTestId('landing-pro-unavailable');
        expect(notice.textContent).toBe('Available at the end of your trial.');
        expect(notice.textContent).not.toMatch(/isn.t open|not yet|paid continuation/i); // forward-looking, never an apology
        expect(['BUTTON', 'A'].includes(notice.tagName)).toBe(false);
        expect(notice.hasAttribute('tabindex')).toBe(false);
        expect(notice.hasAttribute('role')).toBe(false);
        // No ground, no border (`box-border` is box-sizing, not a border).
        expect(notice.className.split(/\s+/).filter((c) => /^(border|bg-|rounded)/.test(c))).toEqual([]);
        const pro = within(pricing).getByRole('heading', { name: 'Pro' }).closest('article') as HTMLElement;
        expect(pro.querySelectorAll('a, button, [role="button"], [tabindex]')).toHaveLength(0);
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

    const FACTUAL_CHIPS = ['Private transcription keeps audio local', 'Transcript data supports SpeakSharp features'];

    it.each([
        [false, FACTUAL_CHIPS],
        [true, [...FACTUAL_CHIPS, 'Pro continues only after Stripe confirmation']],
    ])('payments enabled=%s: the two factual chips, and a payment chip only when there is a payment', (enabled, expected) => {
        paymentsEnabled.mockReturnValue(enabled);
        render(<PracticePage />);
        const chips = screen.getAllByTestId('offer-disclosure-chip').map((c) => c.textContent);
        expect(chips).toEqual(expected);
    });

    it('CASUALTY: the removed continuation sentence cannot reappear in the disabled state', () => {
        /*
         * #1522 — the sentence is gone, and no reworded promise takes its slot.
         *
         * Asserted on the RENDERED page rather than the chip array, because the chip list is not the only
         * place copy can reappear: the paid card's slot, the closing band and the section body all render
         * here too. The negative is paired with a positive assertion, so a render that produced nothing at
         * all could not pass this as "absent".
         */
        paymentsEnabled.mockReturnValue(false);
        render(<PracticePage />);

        expect(screen.getAllByTestId('offer-disclosure-chip').map((c) => c.textContent)).toEqual(FACTUAL_CHIPS);
        const rendered = document.body.textContent ?? '';
        expect(rendered).toContain(FACTUAL_CHIPS[0]);                       // the page really rendered
        expect(rendered).not.toContain('Paid continuation opens later');
        expect(rendered).not.toContain('nothing is charged');
        expect(rendered).not.toMatch(/nothing (is|will be) charged/i);
        expect(rendered).not.toContain('Pro continues only after Stripe confirmation');
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

    /**
     * #1487 P2 casualty — the unsupported-browser branch must not corrupt the heading outline.
     *
     * The warning block is inserted BEFORE `LandingHero`, and `BrowserWarning` used to title itself with an
     * `h5`. The outline therefore began at level 5 and then jumped backwards to the hero's `h1`. The earlier
     * heading-hierarchy casualty missed it because it only ever rendered the supported-browser branch, so
     * this one renders the failing branch explicitly and asserts the ORDER, not just the warning text.
     */
    it('P2 CASUALTY: the unsupported-browser branch still starts at h1 and skips no level', () => {
        browserSupport.mockReturnValue({ isSupported: false, error: 'Microphone access is not available in this browser.' });
        render(<PracticePage />);

        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
            level: Number(h.tagName.slice(1)),
            text: (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        }));

        expect(headings.length).toBeGreaterThan(0);
        expect(headings[0].level, `outline must open at h1: ${JSON.stringify(headings)}`).toBe(1);
        expect(headings.filter((h) => h.level === 1)).toHaveLength(1);

        const skips = headings
            .map((h, i) => ({ from: headings[i - 1]?.level ?? h.level, to: h.level, text: h.text }))
            .filter((step) => step.to > step.from + 1);
        expect(skips, `unsupported-browser outline skips a level\n${JSON.stringify(headings, null, 2)}`).toEqual([]);
    });

    it('P2 CASUALTY: the browser warning contributes no heading at all, and stays announced', () => {
        browserSupport.mockReturnValue({ isSupported: false, error: 'Microphone access is not available in this browser.' });
        render(<PracticePage />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Browser Compatibility');
        // No heading inside the alert at any level: it is a notice, not a section of the document.
        expect(alert.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
        // Removing the heading must not cost the announcement — role="alert" is what carries it.
        expect(alert).toHaveTextContent('Microphone access is not available in this browser.');
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
