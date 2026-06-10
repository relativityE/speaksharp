import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { PricingPage } from '../PricingPage';
import * as supabaseClient from '@/lib/supabaseClient';
import * as UserProfileHook from '@/hooks/useUserProfile';

// Mock modules
vi.mock('@/lib/supabaseClient');

const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);
const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);

describe('PricingPage', () => {
    const mockInvoke = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

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

    describe('Rendering', () => {
        it('should render the pricing page header', () => {
            renderPricingPage();

            expect(screen.getByText('Choose your SpeakSharp plan')).toBeInTheDocument();
            expect(screen.getByText(/Start free with instant Browser transcription/)).toBeInTheDocument();
            expect(screen.getByText(/accuracy varies by browser and environment/)).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: 'Paid early access' })).toBeInTheDocument();
        });

        it('should render Free tier', () => {
            renderPricingPage();

            expect(screen.getByText('Free')).toBeInTheDocument();
            expect(screen.getByText('$0')).toBeInTheDocument();
            expect(screen.getByText('no card required')).toBeInTheDocument();
        });

        it('should render Pro tier', () => {
            renderPricingPage();

            expect(screen.getByText('Pro')).toBeInTheDocument();
            expect(screen.getByText('$9.99')).toBeInTheDocument();
            expect(screen.getByText('per month')).toBeInTheDocument();
        });

        it('should render Free tier features', () => {
            renderPricingPage();

            expect(screen.getByText(/mins of practice per month/)).toBeInTheDocument();
            expect(screen.getByText('Starter analytics')).toBeInTheDocument();
            expect(screen.getByText('Save last 5 sessions')).toBeInTheDocument();
            expect(screen.getByText('AI-assisted feedback')).toBeInTheDocument();
            expect(screen.getByText('Watermarked PDF exports')).toBeInTheDocument();
            // Sponsor/ad copy is gated behind ADS_CONFIG.ENABLE_FREE_PLAN_SUPPORT (off by
            // default), so it must NOT appear unless the sponsor surface is actually enabled.
            expect(screen.queryByText('Free may include privacy-respecting sponsor messages outside practice')).not.toBeInTheDocument();
        });

        it('should render Pro tier features', () => {
            renderPricingPage();

            expect(screen.getByText('Up to 2 hours/day and 50 hours/month')).toBeInTheDocument();
            expect(screen.getByText('Practice analytics and trends')).toBeInTheDocument();
            expect(screen.getByText('Save all sessions')).toBeInTheDocument();
            expect(screen.getByText('Private transcription after one-time local model setup')).toBeInTheDocument();
            expect(screen.getByText('Cloud transcription when enabled for Pro workflows')).toBeInTheDocument();
            expect(screen.getByText('More semantic AI coaching and PDF export capacity')).toBeInTheDocument();
        });

        it('should render CTA buttons', () => {
            renderPricingPage();

            expect(screen.getByText('Start Free')).toBeInTheDocument();
            expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
        });

        it('should render paid early-access cancellation and refund support copy', () => {
            renderPricingPage();

            expect(screen.getByText(/Pro is offered as paid early access/i)).toBeInTheDocument();
            expect(screen.getByText(/cancel from billing management/i)).toBeInTheDocument();
            expect(screen.getByText(/Refund or cancellation questions/i)).toBeInTheDocument();
            expect(screen.getByText(/Pro unlocks only after Stripe confirmation/i)).toBeInTheDocument();
        });
    });

    describe('Button States', () => {
        it('should enable Free tier button', () => {
            renderPricingPage();

            const freeButton = screen.getByText('Start Free');
            expect(freeButton).not.toBeDisabled();
        });

        it('should enable Pro tier button', () => {
            renderPricingPage();

            const proButton = screen.getByText('Upgrade to Pro');
            expect(proButton).not.toBeDisabled();
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

            const proButton = screen.getByText('Upgrade to Pro');
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

            await user.click(screen.getByText('Start Free'));

            await waitFor(() => {
                expect(mockInvoke).not.toHaveBeenCalled();
            });
        });

        it('should handle Supabase client not available', async () => {
            const user = userEvent.setup();
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockGetSupabaseClient.mockReturnValue(null as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);

            renderPricingPage();

            const proButton = screen.getByText('Upgrade to Pro');
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

            const proButton = screen.getByText('Upgrade to Pro');
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
            const gridContainer = screen.getByText('Free').closest('.grid');
            expect(gridContainer).toHaveClass('grid-cols-1');
            expect(gridContainer).toHaveClass('md:grid-cols-2');
        });
    });
});
