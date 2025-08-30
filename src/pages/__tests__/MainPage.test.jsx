import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MainPage } from '../MainPage';
import { describe, it, expect, vi } from 'vitest';

// Mock the useBrowserSupport hook
vi.mock('../../hooks/useBrowserSupport', () => ({
  useBrowserSupport: () => ({
    isSupported: true,
    error: null,
  }),
}));

describe('MainPage', () => {
  it('renders the main heading without crashing', () => {
    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    );

    const heading = screen.getByRole('heading', {
      level: 1,
      name: /Private Practice. Public Impact!/i,
    });
    expect(heading).toBeInTheDocument();
  });
});
