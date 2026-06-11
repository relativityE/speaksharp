import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
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
vi.mock('@/components/landing/BenefitsSection', () => ({
    BenefitsSection: () => <div data-testid="benefits-section">BenefitsSection</div>,
}));
vi.mock('@/components/landing/CTASection', () => ({
    CTASection: () => <div data-testid="cta-section">CTASection</div>,
}));
vi.mock('@/components/BrowserWarning', () => ({
    BrowserWarning: ({ supportError }: { supportError?: string }) => (
        <div data-testid="browser-warning">{supportError || 'Not Supported'}</div>
    )
}));

const mockUseBrowserSupport = vi.fn<() => { isSupported: boolean; error: string | null }>(
    () => ({ isSupported: true, error: null })
);
vi.mock('@/hooks/useBrowserSupport', () => ({
    useBrowserSupport: () => mockUseBrowserSupport()
}));

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

describe('Index', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseBrowserSupport.mockReturnValue({ isSupported: true, error: null });
    });

    describe('Loading State', () => {
        it('should render landing page immediately even when loading (public page)', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                loading: true,
                setSession: vi.fn(),
                user: null,
                signOut: vi.fn(),
            });

            render(<Index />);

            // Landing page should render immediately for unauthenticated users
            // This is by design - public pages don't wait for auth state
            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
        });
    });

    describe('Authenticated State', () => {
        it('should render the landing page when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } } as AuthProvider.AuthContextType['session'],
                loading: false,
                setSession: vi.fn(),
                user: { id: 'test-user' } as AuthProvider.AuthContextType['user'],
                signOut: vi.fn(),
            });

            render(<Index />, { route: '/' });

            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
            expect(screen.getByTestId('features-section')).toBeInTheDocument();
        });
    });

    describe('Unauthenticated State', () => {
        beforeEach(() => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                loading: false,
                setSession: vi.fn(),
                user: null,
                signOut: vi.fn(),
            });
        });

        it('should render the landing page when not authenticated', () => {
            render(<Index />);

            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
            expect(screen.getByTestId('features-section')).toBeInTheDocument();
            expect(screen.getByTestId('landing-footer')).toBeInTheDocument();
        });

        it('shows a browser compatibility warning without blocking landing content', () => {
            mockUseBrowserSupport.mockReturnValue({
                isSupported: false,
                error: 'Speech recognition not supported in this browser.'
            });

            render(<Index />);

            expect(screen.getByTestId('browser-warning')).toHaveTextContent('Speech recognition not supported');
            expect(screen.getByTestId('hero-section')).toBeInTheDocument();
            expect(screen.getByTestId('cta-section')).toBeInTheDocument();
        });

        it('should have correct page structure', () => {
            const { container } = render(<Index />);

            // Check main container has min-h-screen
            const mainDiv = container.firstChild as HTMLElement;
            expect(mainDiv).toHaveClass('min-h-screen');
            expect(mainDiv).toHaveClass('bg-background');
            expect(mainDiv).toHaveClass('flex');
            expect(mainDiv).toHaveClass('flex-col');
        });

        it('should render main element with flex-1 class', () => {
            render(<Index />);

            const mainElement = screen.getByRole('main');
            expect(mainElement).toHaveClass('flex-1');
        });
    });
});
