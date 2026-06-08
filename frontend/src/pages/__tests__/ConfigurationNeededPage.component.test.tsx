import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import ConfigurationNeededPage from '../ConfigurationNeededPage';

/**
 * ConfigurationNeededPage Behavioral Tests
 * 
 * Primary Risk: Error fallback page not shown when env vars missing
 * Minimal Test Set: Verify page renders with expected content
 */

// Mock requestAnimationFrame for useEffect cleanup
vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { cb(); return 0; }));

describe('ConfigurationNeededPage', () => {
    beforeEach(() => {
        document.body.classList.remove('app-loaded');
    });

    it('renders the configuration needed message', () => {
        render(<ConfigurationNeededPage />);

        expect(screen.getByRole('heading', { name: /configuration required/i })).toBeInTheDocument();
    });

    it('displays required environment variables', () => {
        render(<ConfigurationNeededPage />);

        expect(screen.getByText('VITE_SUPABASE_URL')).toBeInTheDocument();
        expect(screen.getByText('VITE_SUPABASE_ANON_KEY')).toBeInTheDocument();
        expect(screen.queryByText('VITE_STRIPE_PUBLISHABLE_KEY')).not.toBeInTheDocument();
        expect(screen.queryByText('VITE_SENTRY_DSN')).not.toBeInTheDocument();
    });

    it('explains Stripe and Sentry are optional for startup', () => {
        render(<ConfigurationNeededPage />);

        expect(screen.getByText(/Stripe and Sentry settings are optional for app startup/i)).toBeInTheDocument();
        expect(screen.getByText(/Payment surfaces stay hidden unless a live Stripe publishable key is configured/i)).toBeInTheDocument();
    });

    it('renders reload button', () => {
        render(<ConfigurationNeededPage />);

        expect(screen.getByRole('button', { name: /reload application/i })).toBeInTheDocument();
    });

    it('adds app-loaded class to body on mount', () => {
        render(<ConfigurationNeededPage />);

        expect(document.body.classList.contains('app-loaded')).toBe(true);
    });
});
