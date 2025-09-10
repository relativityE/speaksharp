import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MainPage } from '../MainPage';
import { useBrowserSupport } from '../../hooks/useBrowserSupport';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../hooks/useBrowserSupport');

// Mock child components
vi.mock('../../components/BrowserWarning', () => ({
  BrowserWarning: ({ isSupported, supportError }) => (
    <div data-testid="browser-warning">
      Browser not supported: {supportError}
    </div>
  ),
}));
vi.mock('../../components/landing/HeroSection', () => ({
  HeroSection: () => <div data-testid="hero-section" />,
}));
vi.mock('../../components/landing/FeaturesSection', () => ({
  FeaturesSection: () => <div data-testid="features-section" />,
}));
vi.mock('../../components/landing/TestimonialsSection', () => ({
  TestimonialsSection: () => <div data-testid="testimonials-section" />,
}));
vi.mock('../../components/landing/LandingFooter', () => ({
  LandingFooter: () => <div data-testid="landing-footer" />,
}));


describe('MainPage', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderInRouter = () => {
    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    );
  };

  it('renders the main landing page sections when browser is supported', () => {
    useBrowserSupport.mockReturnValue({ isSupported: true, error: null });
    renderInRouter();

    expect(screen.getByTestId('hero-section')).toBeInTheDocument();
    expect(screen.getByTestId('features-section')).toBeInTheDocument();
    expect(screen.getByTestId('testimonials-section')).toBeInTheDocument();
    expect(screen.getByTestId('landing-footer')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-warning')).not.toBeInTheDocument();
  });

  it('renders the BrowserWarning component when browser is not supported', () => {
    const errorMsg = 'Speech recognition not available.';
    useBrowserSupport.mockReturnValue({ isSupported: false, error: errorMsg });
    renderInRouter();

    const warning = screen.getByTestId('browser-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent(errorMsg);

    expect(screen.queryByTestId('hero-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('features-section')).not.toBeInTheDocument();
  });
});
