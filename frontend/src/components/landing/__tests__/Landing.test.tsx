import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BenefitsSection } from '../BenefitsSection';
import { CTASection } from '../CTASection';
import { FeaturesSection } from '../FeaturesSection';
import { HeroSection } from '../HeroSection';
import { HeroStatsDashboard } from '../HeroStatsDashboard';
import { LandingFooter } from '../LandingFooter';
import { ProductDiscoverySection } from '../ProductDiscoverySection';
import { TestimonialsSection } from '../TestimonialsSection';

const HERE = dirname(fileURLToPath(import.meta.url));

// Mock the internal Link component if it exists or relies on react-router-dom
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        Link: ({ children, to }: { children: React.ReactNode, to: string }) => <a href={to}>{children}</a>,
        useNavigate: () => vi.fn()
    };
});

// Since some components might use framer-motion, mock it to prevent weird async loops
vi.mock('framer-motion', async () => {
    const actual = await vi.importActual('framer-motion');
    return {
        ...actual,
        motion: {
            // Provide simple DOM elements instead of animated ones
            div: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <div {...(props as Record<string, unknown>)}>{children}</div>,
            span: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <span {...(props as Record<string, unknown>)}>{children}</span>,
            p: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <p {...(props as Record<string, unknown>)}>{children}</p>,
            h1: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <h1 {...(props as Record<string, unknown>)}>{children}</h1>,
            h2: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <h2 {...(props as Record<string, unknown>)}>{children}</h2>,
            ul: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <ul {...(props as Record<string, unknown>)}>{children}</ul>,
            li: ({ children, ...props }: { children?: React.ReactNode;[key: string]: unknown }) => <li {...(props as Record<string, unknown>)}>{children}</li>,
        },
        AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>
    };
});

// Mock Lucide Icons to prevent missing module errors
vi.mock('lucide-react', () => ({
    CheckCircle: () => <div data-testid="icon-check" />,
    ArrowRight: () => <div data-testid="icon-arrow" />,
    Mic: () => <div data-testid="icon-mic" />,
    Zap: () => <div data-testid="icon-zap" />,
    Shield: () => <div data-testid="icon-shield" />,
    ShieldCheck: () => <div data-testid="icon-shield-check" />,
    BarChart3: () => <div data-testid="icon-chart" />,
    Star: () => <div data-testid="icon-star" />,
    Quote: () => <div data-testid="icon-quote" />,
    Target: () => <div data-testid="icon-target" />,
    CheckCircle2: () => <div data-testid="icon-check-2" />,
    Sparkles: () => <div data-testid="icon-sparkles" />,
    Clock: () => <div data-testid="icon-clock" />
}));

describe('Landing Page Components', () => {

    it('renders BenefitsSection without crashing', () => {
        render(<BenefitsSection />);
        // Usually contains section headers or specific benefit text
        expect(screen.getByRole('heading', { level: 2 })).toBeDefined();
    });

    it('renders CTASection without crashing', () => {
        render(<CTASection />);
        // Checking for standard CTA button
        const links = screen.getAllByRole('link');
        expect(links.length).toBeGreaterThan(0);
    });

    it('renders FeaturesSection without crashing', () => {
        render(<FeaturesSection />);
        expect(screen.getByRole('heading', { level: 2 })).toBeDefined();
    });

    it('renders HeroSection without crashing', () => {
        render(<HeroSection />);
        // Hero usually has an H1
        expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    });

    it('renders HeroStatsDashboard without crashing', () => {
        render(<HeroStatsDashboard />);
        // Usually renders some mock stats or visual elements
        const root = document.querySelector('div');
        expect(root).toBeTruthy();
    });

    it('renders LandingFooter without crashing', () => {
        render(<LandingFooter />);
        // Usually renders a copyright signature or links
        expect(screen.getByText(/SpeakSharp|Copyright/i)).toBeDefined();
    });

    // Smoke: both products render with text-bearing availability (not color alone) and Guided has no
    // actionable control. Detailed CTA/intent/conversion assertions live in
    // ProductDiscoverySection.component.test.tsx (real router, full props).
    it('renders ProductDiscoverySection with both products and truthful availability', () => {
        render(<ProductDiscoverySection />);
        expect(screen.getByRole('heading', { level: 2, name: /choose how you want to practice/i })).toBeDefined();
        expect(screen.getByTestId('product-discovery-freestyle-status')).toHaveTextContent(/available now/i);
        expect(screen.getByTestId('product-discovery-guided-status')).toHaveTextContent(/planned — not available yet/i);
        // Guided is not an actionable control.
        expect(screen.getByTestId('product-discovery-guided').querySelector('button')).toBeNull();
    });

    // Active absence contract (replaces the prior it.todo): while the PO testimonials-hidden policy is
    // active, TestimonialsSection must be inert AND must not be composed into the public landing.
    it('keeps testimonials absent from the landing while the PO policy is active', () => {
        const { container } = render(<TestimonialsSection />);
        expect(container).toBeEmptyDOMElement(); // component renders nothing
        // The landing page (Index) must not actively compose it (commented usage is allowed).
        const indexSrc = readFileSync(resolve(HERE, '../../../pages/Index.tsx'), 'utf8');
        expect(indexSrc).not.toMatch(/^\s*<TestimonialsSection\s*\/>/m);
    });
});
