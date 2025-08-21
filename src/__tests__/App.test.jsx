import React from 'react'; // <-- FIX: Added this import
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';

// Mock the useAuth hook
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

// Mock the Header component to simplify App tests
vi.mock('../components/Header', () => ({
  Header: () => <header>Mock Header</header>,
}));

describe('App Routing', () => {
  it('renders the main page for the root route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    // After the redesign, the text "Speak with" is gone.
    // Let's check for the new content.
    expect(screen.getByText(/Full Stack Developer/i)).toBeInTheDocument();
  });

  it('renders the session page for the /session route', () => {
    render(
      <MemoryRouter initialEntries={['/session']}>
        <App />
      </MemoryRouter>
    );
    // Check for a unique element on the session page
    expect(screen.getByText(/Session Controls/i)).toBeInTheDocument();
  });

  it('renders the analytics page for the /analytics route', () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <App />
      </MemoryRouter>
    );
    // Check for a unique element on the analytics page
    expect(screen.getByText(/Analytics/i)).toBeInTheDocument();
  });

  it('renders the auth page for the /auth route', () => {
    render(
      <MemoryRouter initialEntries={['/auth']}>
        <App />
      </MemoryRouter>
    );
    // Check for a unique element on the auth page
    expect(screen.getByText(/Sign in/i)).toBeInTheDocument();
  });

  it('always renders the sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    // The sidebar has a unique title
    expect(screen.getByText(/DevFolio/i)).toBeInTheDocument();
  });
});
