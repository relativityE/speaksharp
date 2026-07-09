/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const { mockEnv, mockUseAuthProvider } = vi.hoisted(() => ({
  mockEnv: { isE2E: false },
  mockUseAuthProvider: vi.fn(),
}));
vi.mock('../../config/TestFlags', () => ({ ENV: mockEnv }));
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: mockUseAuthProvider }));
vi.mock('../../lib/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ProtectedRoute } from '../ProtectedRoute';

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={<ProtectedRoute><div data-testid="child">CHILD</div></ProtectedRoute>} />
        <Route path="/auth" element={<div data-testid="auth-page">AUTH</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProtectedRoute — beta access control', () => {
  beforeEach(() => {
    mockUseAuthProvider.mockReset();
    mockEnv.isE2E = false;
  });

  it('shows the loading spinner while auth is loading (not the child, not a redirect)', () => {
    mockUseAuthProvider.mockReturnValue({ user: null, loading: true });
    renderAt();
    expect(screen.getByTestId('protected-route-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated user to /auth', () => {
    mockUseAuthProvider.mockReturnValue({ user: null, loading: false });
    renderAt();
    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders the protected children for an authenticated user', () => {
    mockUseAuthProvider.mockReturnValue({ user: { id: 'u1' }, loading: false });
    renderAt();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  });

  it('E2E bypass: renders children with no user when ENV.isE2E is true', () => {
    mockUseAuthProvider.mockReturnValue({ user: null, loading: false });
    mockEnv.isE2E = true;
    renderAt();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  });
});
