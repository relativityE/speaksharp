import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProductDiscoverySection } from '../ProductDiscoverySection';

// Spy on the conversion funnel to prove the stable source is used (correction 6).
const viewed = vi.fn();
const clicked = vi.fn();
vi.mock('@/services/conversionFunnel', () => ({
  trackConversionCtaViewed: (c: unknown) => viewed(c),
  trackConversionCtaClicked: (c: unknown) => clicked(c),
}));

// Renders whatever location the CTA navigated to, so we can assert destination + preserved intent state.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="dest" data-path={loc.pathname} data-state={JSON.stringify(loc.state)} />;
}

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ProductDiscoverySection />} />
        <Route path="/auth/signup" element={<LocationProbe />} />
        <Route path="/auth/signin" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProductDiscoverySection (#1061 public product discovery)', () => {
  beforeEach(() => {
    viewed.mockClear();
    clicked.mockClear();
  });

  it('tracks the discovery view with the stable product_discovery_freestyle source', () => {
    renderAt();
    expect(viewed).toHaveBeenCalledWith({ source: 'product_discovery_freestyle' });
  });

  it('Freestyle CTA tracks the funnel source and routes to signup preserving /session intent', () => {
    renderAt();
    fireEvent.click(screen.getByTestId('product-discovery-freestyle-cta'));
    expect(clicked).toHaveBeenCalledWith({ source: 'product_discovery_freestyle' });
    const dest = screen.getByTestId('dest');
    expect(dest.getAttribute('data-path')).toBe('/auth/signup');
    // Intent is preserved through account access via location.state.from → /session.
    expect(dest.getAttribute('data-state')).toContain('"pathname":"/session"');
  });

  it('Guided is a truthful planned state with no actionable control, navigation, or CTA', () => {
    renderAt();
    expect(screen.getByTestId('product-discovery-guided-status')).toHaveTextContent(/planned — not available yet/i);
    const guided = screen.getByTestId('product-discovery-guided');
    expect(guided.querySelector('a')).toBeNull();
    expect(guided.querySelector('button')).toBeNull();
    // No email capture / input in the increment.
    expect(guided.querySelector('input')).toBeNull();
  });

  it('conveys availability by text (not color alone) for accessibility', () => {
    renderAt();
    // Each status carries a readable label independent of color.
    expect(screen.getByText(/available now/i)).toBeInTheDocument();
    expect(screen.getByText(/planned — not available yet/i)).toBeInTheDocument();
  });
});
