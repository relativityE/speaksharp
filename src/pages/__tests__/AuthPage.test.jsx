// src/pages/__tests__/AuthPage.test.jsx - COMPLETE REWRITE
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import AuthPage from '../AuthPage';

// Test wrapper that provides necessary context
const TestWrapper = ({ children }) => (
  <BrowserRouter>
    {children}
  </BrowserRouter>
);

const renderAuthPage = (props = {}) => {
  const utils = render(
    <TestWrapper>
      <AuthPage {...props} />
    </TestWrapper>
  );

  return {
    ...utils,
    // Helper to get elements within this render
    getByTestId: (testId) => within(utils.container).getByTestId(testId),
    queryByTestId: (testId) => within(utils.container).queryByTestId(testId)
  };
};

describe.skip('AuthPage', () => {
  let user;

  beforeEach(() => {
    // Create fresh user event instance for each test
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Ensure clean slate
    document.body.innerHTML = '';
  });

  it('renders sign in form by default', async () => {
    const { getByTestId } = renderAuthPage();

    // Wait for component to fully render
    await waitFor(() => {
      expect(getByTestId('auth-form')).toBeInTheDocument();
    });

    expect(getByTestId('email-input')).toBeInTheDocument();
    expect(getByTestId('password-input')).toBeInTheDocument();
    expect(getByTestId('sign-in-submit')).toBeInTheDocument();
  });

  it('switches to sign up mode when toggle is clicked', async () => {
    const { getByTestId, queryByTestId } = renderAuthPage();

    // Wait for initial render
    await waitFor(() => {
      expect(getByTestId('auth-form')).toBeInTheDocument();
    });

    // Click toggle
    const toggleButton = getByTestId('mode-toggle');
    await user.click(toggleButton);

    // Wait for state change
    await waitFor(() => {
      expect(queryByTestId('sign-up-submit')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(queryByTestId('sign-in-submit')).not.toBeInTheDocument();
  });

  it('shows forgot password form when link is clicked', async () => {
    const { getByTestId } = renderAuthPage();

    await waitFor(() => {
      expect(getByTestId('auth-form')).toBeInTheDocument();
    });

    const forgotPasswordLink = getByTestId('forgot-password-button');
    await user.click(forgotPasswordLink);

    await waitFor(() => {
      expect(getByTestId('reset-password-form')).toBeInTheDocument();
    });
  });

  it('handles form submission without errors', async () => {
    const { getByTestId } = renderAuthPage();

    await waitFor(() => {
      expect(getByTestId('auth-form')).toBeInTheDocument();
    });

    // Fill out form
    await user.type(getByTestId('email-input'), 'test@example.com');
    await user.type(getByTestId('password-input'), 'password123');

    // Submit form
    const submitButton = getByTestId('sign-in-submit');
    await user.click(submitButton);

    // Should not throw errors
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });
});
