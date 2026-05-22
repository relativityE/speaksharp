import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
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
        return render(<PricingPage />);
    };

    describe('Rendering', () => {
        it('should render the pricing page header', () => {
            renderPricingPage();

            expect(screen.getByText('Choose your SpeakSharp plan')).toBeInTheDocument();
            expect(screen.getByText(/Start with browser transcription/)).toBeInTheDocument();
        });

        it('should render Basic tier', () => {
            renderPricingPage();

            expect(screen.getByText('Basic')).toBeInTheDocument();
            expect(screen.getByText('$2.99')).toBeInTheDocument();
            expect(screen.getAllByText('per month').length).toBeGreaterThanOrEqual(2);
        });

        it('should render Pro tier', () => {
            renderPricingPage();

            expect(screen.getByText('Pro')).toBeInTheDocument();
            expect(screen.getByText('$7.99')).toBeInTheDocument();
            expect(screen.getAllByText('per month').length).toBeGreaterThanOrEqual(2);
        });

        it('should render Basic tier features', () => {
            renderPricingPage();

            expect(screen.getByText(/mins of practice per month/)).toBeInTheDocument();
            expect(screen.getByText('Basic analytics')).toBeInTheDocument();
            expect(screen.getByText('Save last 5 sessions')).toBeInTheDocument();
            expect(screen.getByText('AI-assisted feedback')).toBeInTheDocument();
            expect(screen.getByText('Watermarked PDF exports')).toBeInTheDocument();
        });

        it('should render Pro tier features', () => {
            renderPricingPage();

            expect(screen.getByText('Up to 2 hours/day and 50 hours/month')).toBeInTheDocument();
            expect(screen.getByText('Practice analytics and trends')).toBeInTheDocument();
            expect(screen.getByText('Save all sessions')).toBeInTheDocument();
            expect(screen.getByText('Private transcription')).toBeInTheDocument();
            expect(screen.getByText('Cloud transcription')).toBeInTheDocument();
            expect(screen.getByText('More AI feedback and PDF export capacity')).toBeInTheDocument();
        });

        it('should render CTA buttons', () => {
            renderPricingPage();

            expect(screen.getByText('Choose Basic')).toBeInTheDocument();
            expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
        });
    });

    describe('Button States', () => {
        it('should enable Basic tier button', () => {
            renderPricingPage();

            const basicButton = screen.getByText('Choose Basic');
            expect(basicButton).not.toBeDisabled();
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

        it('should call stripe-checkout with basic plan when choosing Basic', async () => {
            const user = userEvent.setup();
            mockInvoke.mockResolvedValue({
                data: { checkoutUrl: 'https://checkout.stripe.com/basic-test' },
                error: null,
            });

            const originalLocation = window.location;
            Object.defineProperty(window, 'location', {
                value: { href: '', origin: 'http://localhost' },
                writable: true,
            });

            renderPricingPage();

            await user.click(screen.getByText('Choose Basic'));

            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout', expect.objectContaining({
                    body: expect.objectContaining({
                        plan: 'basic',
                        returnUrlOrigin: expect.any(String)
                    })
                }));
            });

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
            const gridContainer = screen.getByText('Basic').closest('.grid');
            expect(gridContainer).toHaveClass('grid-cols-1');
            expect(gridContainer).toHaveClass('md:grid-cols-2');
        });
    });
});
