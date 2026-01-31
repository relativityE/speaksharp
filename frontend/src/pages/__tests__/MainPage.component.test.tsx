import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MainPage } from '../MainPage';

/**
 * MainPage Behavioral Tests
 * 
 * Primary Risk: Entry point fails to render, blocking all user access
 * Minimal Test Set: Verify page renders without crash in supported/unsupported states
 */

// Mock child components to isolate MainPage behavior
vi.mock('@/components/landing/HeroSection', () => ({
    HeroSection: () => <div data-testid="hero-section">Hero Section</div>
}));

vi.mock('@/components/landing/FeaturesSection', () => ({
    FeaturesSection: () => <div data-testid="features-section">Features Section</div>
}));

vi.mock('@/components/landing/LandingFooter', () => ({
    LandingFooter: () => <footer data-testid="landing-footer">Footer</footer>
}));

vi.mock('@/components/BrowserWarning', () => ({
    BrowserWarning: ({ supportError }: { supportError?: string }) => (
        <div data-testid="browser-warning">{supportError || 'Not Supported'}</div>
    )
}));

// Mock useBrowserSupport hook
const mockUseBrowserSupport = vi.fn();
vi.mock('@/hooks/useBrowserSupport', () => ({
    useBrowserSupport: () => mockUseBrowserSupport()
}));

const renderWithProviders = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                {ui}
            </MemoryRouter>
        </QueryClientProvider>
    );
};

describe('MainPage', () => {
    it('renders landing page sections when browser is supported', () => {
        mockUseBrowserSupport.mockReturnValue({ isSupported: true, error: null });

        renderWithProviders(<MainPage />);

        expect(screen.getByTestId('hero-section')).toBeInTheDocument();
        expect(screen.getByTestId('features-section')).toBeInTheDocument();
        expect(screen.getByTestId('landing-footer')).toBeInTheDocument();
    });

    it('renders BrowserWarning when browser is not supported', () => {
        mockUseBrowserSupport.mockReturnValue({
            isSupported: false,
            error: 'WebSpeech API not available'
        });

        renderWithProviders(<MainPage />);

        expect(screen.getByTestId('browser-warning')).toBeInTheDocument();
        expect(screen.queryByTestId('hero-section')).not.toBeInTheDocument();
    });
});
