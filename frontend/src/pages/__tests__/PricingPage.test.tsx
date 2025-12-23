import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { PricingPage } from '../PricingPage';
import * as supabaseClient from '@/lib/supabaseClient';

// Mock modules
vi.mock('@/lib/supabaseClient');

const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

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
    });

    const renderPricingPage = () => {
        return render(
            <BrowserRouter>
                <PricingPage />
            </BrowserRouter>
        );
    };

    describe('Rendering', () => {
        it('should render the pricing page header', () => {
            renderPricingPage();

            expect(screen.getByText("Find the plan that's right for you")).toBeInTheDocument();
            expect(screen.getByText(/Whether you're just starting out/)).toBeInTheDocument();
        });

        it('should render Free tier', () => {
            renderPricingPage();

            expect(screen.getByText('Free')).toBeInTheDocument();
            expect(screen.getByText('$0')).toBeInTheDocument();
            expect(screen.getByText('For basic use')).toBeInTheDocument();
        });

        it('should render Pro tier', () => {
            renderPricingPage();

            expect(screen.getByText('Pro')).toBeInTheDocument();
            expect(screen.getByText('$10')).toBeInTheDocument();
            expect(screen.getByText('per month')).toBeInTheDocument();
        });

        it('should render Free tier features', () => {
            renderPricingPage();

            expect(screen.getByText(/mins of practice per month/)).toBeInTheDocument();
            expect(screen.getByText('Basic analytics')).toBeInTheDocument();
            expect(screen.getByText('Save last 5 sessions')).toBeInTheDocument();
        });

        it('should render Pro tier features', () => {
            renderPricingPage();

            expect(screen.getByText('Unlimited practice time')).toBeInTheDocument();
            expect(screen.getByText('Advanced analytics')).toBeInTheDocument();
            expect(screen.getByText('Save all sessions')).toBeInTheDocument();
            expect(screen.getByText('Export data as PDF')).toBeInTheDocument();
            expect(screen.getByText('On-device transcription for privacy')).toBeInTheDocument();
            expect(screen.getByText('AI-powered feedback (coming soon)')).toBeInTheDocument();
        });

        it('should render CTA buttons', () => {
            renderPricingPage();

            expect(screen.getByText('Continue with Free')).toBeInTheDocument();
            expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
        });
    });

    describe('Button States', () => {
        it('should disable Free tier button', () => {
            renderPricingPage();

            const freeButton = screen.getByText('Continue with Free');
            expect(freeButton).toBeDisabled();
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
                value: { href: '' },
                writable: true,
            });

            renderPricingPage();

            const proButton = screen.getByText('Upgrade to Pro');
            await user.click(proButton);

            await waitFor(() => {
                // Backend now uses STRIPE_PRO_PRICE_ID env var, no body needed
                expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout');
            });

            // Restore original location
            Object.defineProperty(window, 'location', {
                value: originalLocation,
                writable: true,
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
    });

    describe('Layout', () => {
        it('should render pricing cards in a grid', () => {
            renderPricingPage();

            // Find the grid container
            const gridContainer = screen.getByText('Free').closest('.grid');
            expect(gridContainer).toHaveClass('grid-cols-1');
            expect(gridContainer).toHaveClass('md:grid-cols-3');
        });
    });
});
