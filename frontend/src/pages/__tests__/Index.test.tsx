import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import Index from '../Index';
import * as AuthProvider from '@/contexts/AuthProvider';

// Mock modules
vi.mock('@/contexts/AuthProvider');
vi.mock('@/components/landing/HeroSection', () => ({
    HeroSection: () => <div data-testid="hero-section">HeroSection</div>,
}));
vi.mock('@/components/landing/FeaturesSection', () => ({
    FeaturesSection: () => <div data-testid="features-section">FeaturesSection</div>,
}));
vi.mock('@/components/landing/LandingFooter', () => ({
    LandingFooter: () => <footer data-testid="landing-footer">LandingFooter</footer>,
}));

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

describe('Index', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Loading State', () => {
        it('should render landing page immediately even when loading (public page)', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                loading: true,
                setSession: vi.fn(),
                user: null,
                profile: null,
                signOut: vi.fn(),
            });

            render(
                <BrowserRouter>
                    <Index />
                </BrowserRouter>
            );

            // Landing page should render immediately for unauthenticated users
            // This is by design - public pages don't wait for auth state
            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
        });
    });

    describe('Authenticated State', () => {
        it('should redirect to /session when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } } as AuthProvider.AuthContextType['session'],
                loading: false,
                setSession: vi.fn(),
                user: { id: 'test-user' } as AuthProvider.AuthContextType['user'],
                profile: { id: 'test-user', subscription_status: 'free' } as AuthProvider.AuthContextType['profile'],
                signOut: vi.fn(),
            });

            render(
                <MemoryRouter initialEntries={['/']}>
                    <Index />
                </MemoryRouter>
            );

            // Should not render landing page components when redirecting
            expect(screen.queryByTestId('hero-section')).not.toBeInTheDocument();
            expect(screen.queryByTestId('features-section')).not.toBeInTheDocument();
        });
    });

    describe('Unauthenticated State', () => {
        beforeEach(() => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                loading: false,
                setSession: vi.fn(),
                user: null,
                profile: null,
                signOut: vi.fn(),
            });
        });

        it('should render the landing page when not authenticated', () => {
            render(
                <BrowserRouter>
                    <Index />
                </BrowserRouter>
            );

            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
            expect(screen.getByTestId('features-section')).toBeInTheDocument();
            expect(screen.getByTestId('landing-footer')).toBeInTheDocument();
        });

        it('should have correct page structure', () => {
            const { container } = render(
                <BrowserRouter>
                    <Index />
                </BrowserRouter>
            );

            // Check main container has min-h-screen
            const mainDiv = container.firstChild as HTMLElement;
            expect(mainDiv).toHaveClass('min-h-screen');
            expect(mainDiv).toHaveClass('bg-gradient-subtle');
            expect(mainDiv).toHaveClass('flex');
            expect(mainDiv).toHaveClass('flex-col');
        });

        it('should render main element with flex-1 class', () => {
            render(
                <BrowserRouter>
                    <Index />
                </BrowserRouter>
            );

            const mainElement = screen.getByRole('main');
            expect(mainElement).toHaveClass('flex-1');
        });
    });
});
