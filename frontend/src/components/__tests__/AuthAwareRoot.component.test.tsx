import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthAwareRoot } from '../AuthAwareRoot';

// Mock the auth provider the root route reads (never PostHog).
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: vi.fn() }));
import { useAuthProvider } from '../../contexts/AuthProvider';
const mockAuth = vi.mocked(useAuthProvider);

const renderRoot = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AuthAwareRoot><div data-testid="public-index">PUBLIC INDEX</div></AuthAwareRoot>} />
        <Route path="/practice" element={<div data-testid="practice-page">PRACTICE</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('AuthAwareRoot — auth-aware home at /', () => {
  beforeEach(() => vi.clearAllMocks());

  it('anonymous visitor sees the public Index (not redirected)', () => {
    mockAuth.mockReturnValue({ user: null, loading: false } as unknown as ReturnType<typeof useAuthProvider>);
    renderRoot();
    expect(screen.getByTestId('public-index')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-page')).not.toBeInTheDocument();
  });

  it('authenticated visitor is redirected to /practice (refresh-equivalent root entry)', () => {
    mockAuth.mockReturnValue({ user: { id: 'u1' }, loading: false } as unknown as ReturnType<typeof useAuthProvider>);
    renderRoot();
    expect(screen.getByTestId('practice-page')).toBeInTheDocument();
    expect(screen.queryByTestId('public-index')).not.toBeInTheDocument();
  });

  it('while auth is resolving, shows the loader and does NOT redirect or flash Index (no loop)', () => {
    mockAuth.mockReturnValue({ user: null, loading: true } as unknown as ReturnType<typeof useAuthProvider>);
    renderRoot();
    expect(screen.getByTestId('root-auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('public-index')).not.toBeInTheDocument();
    expect(screen.queryByTestId('practice-page')).not.toBeInTheDocument();
  });

  it('a still-loading session with a user present also waits (loader), never a premature redirect', () => {
    // Guards against a redirect loop: the decision is deferred until loading resolves.
    mockAuth.mockReturnValue({ user: { id: 'u1' }, loading: true } as unknown as ReturnType<typeof useAuthProvider>);
    renderRoot();
    expect(screen.getByTestId('root-auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-page')).not.toBeInTheDocument();
  });
});
