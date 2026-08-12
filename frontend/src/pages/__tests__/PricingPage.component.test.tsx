import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { PricingPage } from '../PricingPage';
import * as supabaseClient from '@/lib/supabaseClient';
import * as UserProfileHook from '@/hooks/useUserProfile';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { trackConversionCtaViewed } from '@/services/conversionFunnel';

// Mock modules
vi.mock('@/lib/supabaseClient');
// Control the payments-enabled gate; default true preserves the existing enabled-state tests.
vi.mock('@/config/appRuntimeConfig', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/config/appRuntimeConfig')>()),
    arePaymentsEnabled: vi.fn(() => true),
}));
// Spy on the conversion-funnel emitters; keep buildCheckoutBody real so checkout still works.
vi.mock('@/services/conversionFunnel', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/conversionFunnel')>()),
    trackConversionCtaViewed: vi.fn(),
    trackConversionCtaClicked: vi.fn(),
    trackCheckoutStarted: vi.fn(),
}));

const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);
const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);
const mockArePaymentsEnabled = vi.mocked(arePaymentsEnabled);
const mockCtaViewed = vi.mocked(trackConversionCtaViewed);

describe('PricingPage', () => {
    const mockInvoke = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockArePaymentsEnabled.mockReturnValue(true); // enabled by default; disabled cases opt in

        // Default Supabase client mock
        mockGetSupabaseClient.mockReturnValue({
            functions: {
                invoke: mockInvoke,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
        mockUseUserProfile.mockReturnValue({
            data: {
                id: 'mock-user-id',
                subscription_status: 'free',
            },
        } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);
    });

    const renderPricingPage = () => {
        return render(<PricingPage />);
    };

    // #1266 — a PAID-OFFER view must not be recorded when enrollment is unavailable.
    describe('paid-offer view telemetry gating', () => {
        it('records the Pro (paid) offer view when enrollment is ENABLED', () => {
            mockArePaymentsEnabled.mockReturnValue(true);
            renderPricingPage();
            expect(mockCtaViewed).toHaveBeenCalledWith({ source: 'pricing_pro_card', plan: 'pro' });
            // The free-trial CTA is always a real offer, so its view fires too.
            expect(mockCtaViewed).toHaveBeenCalledWith({ source: 'pricing_free_card', plan: 'free' });
        });

        it('does NOT record a Pro (paid) offer view when enrollment is DISABLED', () => {
            mockArePaymentsEnabled.mockReturnValue(false);
            renderPricingPage();
            expect(mockCtaViewed).not.toHaveBeenCalledWith({ source: 'pricing_pro_card', plan: 'pro' });
            // The free-trial offer is real regardless of checkout state, so its view still fires.
            expect(mockCtaViewed).toHaveBeenCalledWith({ source: 'pricing_free_card', plan: 'free' });
        });
    });

    describe('Rendering', () => {
        it('should render the pricing page header', () => {
            renderPricingPage();

            expect(screen.getByText('One product. Free for 30 days.')).toBeInTheDocument();
            expect(screen.getByText(/The complete Private Practice product is free for your first 30 days/)).toBeInTheDocument();
            expect(screen.getByText('Private on-device transcription after one-time model setup')).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: 'After your 30-day trial' })).toBeInTheDocument();
        });

        it('should render Free trial tier', () => {
            renderPricingPage();

            expect(screen.getByText('Free trial')).toBeInTheDocument();
            expect(screen.getByText('$0')).toBeInTheDocument();
            expect(screen.getByText(/first 30 days · no card required/)).toBeInTheDocument();
        });

        it('should render Pro tier', () => {
            renderPricingPage();

            expect(screen.getByText('Pro')).toBeInTheDocument();
            expect(screen.getByText('$10')).toBeInTheDocument();
            expect(screen.getByText(/per month, after your 30-day trial/)).toBeInTheDocument();
        });

        it('should render Free-trial features (the complete product, 30 days)', () => {
            renderPricingPage();

            expect(screen.getByText('The complete Private Practice product, free for 30 days')).toBeInTheDocument();
            expect(screen.getByText('Open Mic and Focus Points, with saved review and comparable Progress')).toBeInTheDocument();
            expect(screen.getByText('History and PDF export')).toBeInTheDocument();
            expect(screen.getByText('No card required to start')).toBeInTheDocument();
        });

        it('should render Pro features as the same product, continued for $10/month', () => {
            renderPricingPage();

            expect(screen.getByText('Everything in the trial — the same complete product')).toBeInTheDocument();
            expect(screen.getByText('Keep practicing after your first 30 days')).toBeInTheDocument();
            expect(screen.getByText('Open Mic, Focus Points, saved review, Progress, History, and PDF')).toBeInTheDocument();
            expect(screen.getByText('Private on-device transcription stays the foundation')).toBeInTheDocument();
        });

        it('should render CTA buttons', () => {
            renderPricingPage();

            expect(screen.getByText('Start free')).toBeInTheDocument();
            expect(screen.getByText('Continue for $10/month')).toBeInTheDocument();
        });

        it('should render paid early-access cancellation and refund support copy', () => {
            renderPricingPage();

            expect(screen.getByText(/Continue the same complete product for \$10\/month/i)).toBeInTheDocument();
            expect(screen.getByText(/cancel from billing management/i)).toBeInTheDocument();
            expect(screen.getByText(/Refund or cancellation questions/i)).toBeInTheDocument();
            expect(screen.getAllByText(/Pro continues only after Stripe confirmation/i)).not.toHaveLength(0);
        });
    });

    describe('Button States', () => {
        it('should enable Free tier button', () => {
            renderPricingPage();

            const freeButton = screen.getByText('Start free');
            expect(freeButton).not.toBeDisabled();
        });

        it('should enable Pro tier button', () => {
            renderPricingPage();

            const proButton = screen.getByText('Continue for $10/month');
            expect(proButton).not.toBeDisabled();
        });
    });

    describe('Payments disabled (Wave-1 non-payment beta)', () => {
        beforeEach(() => {
            mockArePaymentsEnabled.mockReturnValue(false);
        });

        it('shows a visible beta-unavailable notice instead of a checkout CTA, and keeps the Pro plan visible', () => {
            renderPricingPage();

            // Pro plan still visible for transparency.
            expect(screen.getByText('Pro')).toBeInTheDocument();
            expect(screen.getByText('$10')).toBeInTheDocument();

            // Informational, non-clickable state replaces the missing checkout CTA.
            const notice = screen.getByTestId('pricing-pro-beta-unavailable');
            expect(notice).toBeInTheDocument();
            expect(screen.getByText(/Paid continuation isn't open yet/i)).toBeInTheDocument();
            expect(screen.getByText(/The complete product is free for your first 30 days — no card required/i)).toBeInTheDocument();

            // No clickable Pro checkout action; the Free CTA remains.
            expect(screen.queryByText('Continue for $10/month')).not.toBeInTheDocument();
            expect(screen.queryByText('Starting checkout...')).not.toBeInTheDocument();
            expect(screen.getByText('Start free')).toBeInTheDocument();
        });

        it('does not invoke stripe-checkout from the beta-unavailable state', async () => {
            const user = userEvent.setup();
            renderPricingPage();

            // The notice is not a button; there is nothing to click that starts checkout.
            const notice = screen.getByTestId('pricing-pro-beta-unavailable');
            await user.click(notice);
            expect(mockInvoke).not.toHaveBeenCalled();
        });
    });

    describe('Stripe Checkout', () => {
        it('should call stripe-checkout function when clicking Upgrade to Pro', async () => {
            const user = userEvent.setup();
            mockInvoke.mockResolvedValue({
                data: { checkoutUrl: 'https://checkout.stripe.com/test' },
                error: null,
            });

            // Mock window.location.href
            const originalLocation = window.location;
            Object.defineProperty(window, 'location', {
                value: { href: '', origin: 'http://localhost' },
                writable: true,
            });

            renderPricingPage();

            const proButton = screen.getByText('Continue for $10/month');
            await user.click(proButton);

            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout', expect.objectContaining({
                    body: expect.objectContaining({
                        plan: 'pro',
                        returnUrlOrigin: expect.any(String)
                    })
                }));
            });

            // Restore original location
            Object.defineProperty(window, 'location', {
                value: originalLocation,
                writable: true,
            });
        });

        it('should not call stripe-checkout when starting Free', async () => {
            const user = userEvent.setup();

            renderPricingPage();

            await user.click(screen.getByText('Start free'));

            await waitFor(() => {
                expect(mockInvoke).not.toHaveBeenCalled();
            });
        });

        it('should handle Supabase client not available', async () => {
            const user = userEvent.setup();
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockGetSupabaseClient.mockReturnValue(null as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);

            renderPricingPage();

            const proButton = screen.getByText('Continue for $10/month');
            await user.click(proButton);

            // Should not throw, error is logged
            await waitFor(() => {
                expect(mockInvoke).not.toHaveBeenCalled();
            });

            consoleSpy.mockRestore();
        });

        it('should handle checkout error gracefully', async () => {
            const user = userEvent.setup();
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockInvoke.mockResolvedValue({
                data: null,
                error: new Error('Checkout failed'),
            });

            renderPricingPage();

            const proButton = screen.getByText('Continue for $10/month');
            await user.click(proButton);

            // Should not throw, error is logged
            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalled();
            });

            consoleSpy.mockRestore();
        });

        it('should open Stripe billing portal for paid Pro accounts', async () => {
            const user = userEvent.setup();
            mockUseUserProfile.mockReturnValue({
                data: {
                    id: 'mock-user-id',
                    subscription_status: 'pro',
                    stripe_subscription_id: 'sub_123',
                    stripe_customer_id: 'cus_123',
                },
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);
            mockInvoke.mockResolvedValue({
                data: { portalUrl: 'https://billing.stripe.com/session/test' },
                error: null,
            });

            const originalLocation = window.location;
            Object.defineProperty(window, 'location', {
                value: { href: '', origin: 'http://localhost' },
                writable: true,
            });

            renderPricingPage();

            await user.click(screen.getByText('Manage billing'));

            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalledWith('stripe-billing-portal');
                expect(window.location.href).toBe('https://billing.stripe.com/session/test');
            });

            Object.defineProperty(window, 'location', {
                value: originalLocation,
                writable: true,
            });
        });
    });

    describe('Layout', () => {
        it('should render pricing cards in a grid', () => {
            renderPricingPage();

            // Find the grid container
            const gridContainer = screen.getByText('Free trial').closest('.grid');
            expect(gridContainer).toHaveClass('grid-cols-1');
            expect(gridContainer).toHaveClass('md:grid-cols-2');
        });
    });
});
