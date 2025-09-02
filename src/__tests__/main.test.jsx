import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the App component, which is the main dependency.
vi.mock('../App.jsx', () => ({
  default: () => <div>Mock App</div>,
}));

// Mock other service/provider dependencies to prevent side effects in the test environment.
vi.mock('../contexts/AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => <div>{children}</div>,
}));
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }) => <div>{children}</div>,
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
}));
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(),
  replayIntegration: vi.fn(),
  ErrorBoundary: ({ children }) => <div>{children}</div>,
}));

describe('main.jsx conditional rendering', () => {
  beforeEach(() => {
    // Set up a clean DOM with the #root element for each test
    document.body.innerHTML = '<div id="root"></div>';
    // Reset modules to ensure main.jsx runs fresh for each test case
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment variables and reset all mocks
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    // Clean up the DOM
    document.body.innerHTML = '';
  });

  test('renders ConfigurationNeededPage when required env vars are missing', async () => {
    // Ensure the required env vars are missing for this test
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '');

    // Dynamically import main.jsx to trigger its execution
    await import('../main.jsx');

    // Assert that the configuration needed page is rendered
    await waitFor(() => {
      expect(screen.getByText('Configuration Needed')).toBeInTheDocument();
      expect(screen.queryByText('Mock App')).not.toBeInTheDocument();
    });
  });

  test('renders the main App when required env vars are present', async () => {
    // Set the required env vars to valid values
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test_anon_key');
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_stripe123');

    // Dynamically import main.jsx to trigger its execution
    await import('../main.jsx');

    // Assert that the main App component is rendered
    await waitFor(() => {
      expect(screen.getByText('Mock App')).toBeInTheDocument();
      expect(screen.queryByText('Configuration Needed')).not.toBeInTheDocument();
    });
  });
});
